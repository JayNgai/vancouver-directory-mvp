"""Phase A step 2: check the 111 previously-flagged rows against OSM (Nominatim) and each
business's own public website.

Reads the Phase A archive for flagged ids. Writes a report CSV, then (with --apply):
 - NULLs phone / website that could not be confirmed by the business's own page
 - fills phone / website / hours from OSM where the venue matches and the field was empty
Never sets isVerified.
"""
import csv
import html
import json
import os
import re
import sqlite3
import ssl
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "prisma" / "dev.db"
DATA = ROOT / "data"
CACHE = Path(os.environ.get("TEMP", str(Path.home()))) / "vancouver-directory-osm-cache"
CACHE.mkdir(parents=True, exist_ok=True)
stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
UA = "VancouverDirectoryMVP/1.0 (local listing data check; contact: local development)"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
APPLY = "--apply" in os.sys.argv
CACHE_TTL = 30 * 24 * 3600


def norm(value):
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(c for c in value if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def digits(value):
    return re.sub(r"\D", "", value or "")


def fetch(url, timeout=25, headers=None):
    request = urllib.request.Request(url, headers=headers or {"User-Agent": UA, "Accept": "text/html,*/*"})
    context = ssl.create_default_context()
    with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
        return response.read(800000).decode("utf-8", "replace")


def nominatim_lookup(name, cache):
    key = norm(name)
    cached = cache.get(key)
    if cached is not None:
        return cached
    query = urllib.parse.urlencode({
        "q": f"{name}, Vancouver, British Columbia, Canada",
        "format": "jsonv2",
        "addressdetails": "1",
        "extratags": "1",
        "limit": "5",
        "countrycodes": "ca",
    })
    try:
        payload = json.loads(fetch(f"{NOMINATIM}?{query}"))
    except urllib.error.HTTPError as error:
        payload = {"error": f"http-{error.code}"}
    except Exception as error:
        payload = {"error": type(error).__name__}
    cache[key] = payload
    time.sleep(1.2)  # Nominatim usage policy: max one request per second.
    return payload


def metres(a_lat, a_lon, b_lat, b_lon):
    import math
    if None in (a_lat, a_lon, b_lat, b_lon):
        return None
    mean = math.radians((a_lat + b_lat) / 2)
    return math.hypot((a_lon - b_lon) * 111320 * math.cos(mean), (a_lat - b_lat) * 111320)


def street_number(value):
    match = re.match(r"\s*(\d+[a-z]?)\s+(.*)", norm(value))
    return (match.group(1), match.group(2)) if match else (None, None)


archive = sorted(DATA.glob("phaseA-archived-unverifiable-fields-*.csv"))[-1]
flagged_ids = [r["id"] for r in csv.DictReader(archive.open(encoding="utf-8")) if r["old_isVerified"] == "1"]
print(f"archive={archive.name} flagged={len(flagged_ids)}")

con = sqlite3.connect(str(DB))
con.row_factory = sqlite3.Row
rows = [dict(r) for r in con.execute(
    "SELECT id, name, address, phone, website, hours, latitude, longitude FROM businesses "
    f"WHERE id IN ({','.join('?' * len(flagged_ids))}) ORDER BY name", flagged_ids)]

cache_file = CACHE / "nominatim-flagged-verification.json"
cache = json.loads(cache_file.read_text(encoding="utf-8")) if cache_file.exists() else {}

report = []
updates = []
for index, row in enumerate(rows, 1):
    payload = nominatim_lookup(row["name"], cache)
    best = None
    best_distance = None
    if isinstance(payload, list):
        scored = []
        for entry in payload:
            try:
                lat = float(entry.get("lat"))
                lon = float(entry.get("lon"))
            except (TypeError, ValueError):
                continue
            distance = metres(row["latitude"], row["longitude"], lat, lon)
            entry_name = norm(entry.get("name") or "")
            target = norm(row["name"])
            name_hit = entry_name == target or target in norm(entry.get("display_name") or "")
            scored.append((0 if name_hit else 1, distance if distance is not None else 10 ** 9, entry))
        scored.sort(key=lambda s: (s[0], s[1]))
        if scored:
            best = scored[0][2]
            best_distance = scored[0][1]

    osm_match = "no"
    if best is not None:
        if best_distance is None or best_distance <= 60:
            osm_match = "yes"
        elif best_distance <= 250:
            osm_match = "probable"

    extratags = (best or {}).get("extratags") or {}
    osm_name = (best or {}).get("name")
    addr = (best or {}).get("address") or {}
    osm_addr = " ".join(x for x in [addr.get("house_number"), addr.get("road")] if x) or None
    osm_phone = extratags.get("phone") or extratags.get("contact:phone")
    osm_site = extratags.get("website") or extratags.get("contact:website")
    osm_hours = extratags.get("opening_hours")

    address_confirmed = "no"
    if osm_match != "no":
        if osm_addr and street_number(osm_addr)[0] and street_number(osm_addr)[0] == street_number(row["address"])[0]:
            address_confirmed = "yes"
        elif osm_addr:
            address_confirmed = "street-name-only"
        else:
            address_confirmed = "coordinates-only"

    website_confirmed = "not-checked"
    phone_confirmed = "not-checked"
    if row["website"]:
        try:
            page = fetch(row["website"], timeout=25)
            text = norm(re.sub(r"<[^>]+>", " ", html.unescape(page)))
            tokens = [t for t in norm(row["name"]).split() if len(t) > 3]
            hit = sum(1 for t in tokens if t in text)
            website_confirmed = "yes" if tokens and hit >= max(1, len(tokens) // 2) else "no"
            if row["phone"]:
                tail = digits(row["phone"])[-7:]
                phone_confirmed = "yes" if tail and tail in digits(page) else "no"
        except urllib.error.HTTPError as error:
            website_confirmed = f"fetch-failed-http-{error.code}"
        except Exception as error:
            website_confirmed = f"fetch-failed-{type(error).__name__}"
        time.sleep(1.2)

    new_phone, new_site, new_hours = row["phone"], row["website"], row["hours"]
    actions = []
    if row["phone"] and phone_confirmed != "yes":
        new_phone = None
        actions.append("phone-unconfirmed")
    if row["website"] and website_confirmed != "yes":
        new_site = None
        actions.append("website-unconfirmed")
    if not row["phone"] and osm_phone and osm_match in ("yes", "probable"):
        new_phone = osm_phone
        actions.append("phone-from-osm")
    if not row["website"] and osm_site and osm_match in ("yes", "probable"):
        new_site = osm_site
        actions.append("website-from-osm")
    if not row["hours"] and osm_hours and osm_match in ("yes", "probable"):
        new_hours = osm_hours
        actions.append("hours-from-osm")

    if (new_phone, new_site, new_hours) != (row["phone"], row["website"], row["hours"]):
        updates.append((new_phone, new_site, new_hours, row["id"]))

    report.append({
        "id": row["id"], "name": row["name"], "address": row["address"],
        "osm_match": osm_match, "osm_name": osm_name, "osm_address": osm_addr,
        "address_confirmed": address_confirmed, "osm_phone": osm_phone, "osm_website": osm_site,
        "osm_hours": osm_hours, "old_phone": row["phone"], "old_website": row["website"],
        "website_confirmed": website_confirmed, "phone_confirmed": phone_confirmed,
        "new_phone": new_phone, "new_website": new_site, "new_hours": new_hours,
        "actions": ",".join(actions),
    })
    if index % 20 == 0:
        print(f"  checked {index}/{len(rows)}")
        cache_file.write_text(json.dumps(cache), encoding="utf-8")

cache_file.write_text(json.dumps(cache), encoding="utf-8")

report_path = DATA / f"phaseA-flagged-verification-report-{stamp}.csv"
with report_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.DictWriter(fh, fieldnames=list(report[0].keys()))
    writer.writeheader()
    writer.writerows(report)
print(f"REPORT {report_path.name}")

unconfirmed = [r for r in report if "unconfirmed" in r["actions"]]
needs_path = DATA / f"phaseA-needs-verification-{stamp}.csv"
with needs_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.DictWriter(fh, fieldnames=list(report[0].keys()))
    writer.writeheader()
    writer.writerows(unconfirmed)
print(f"NEEDS-VERIFICATION {needs_path.name} rows={len(unconfirmed)}")

print(json.dumps({
    "flagged": len(report),
    "osm_matched_yes": sum(1 for r in report if r["osm_match"] == "yes"),
    "osm_matched_probable": sum(1 for r in report if r["osm_match"] == "probable"),
    "osm_no_match": sum(1 for r in report if r["osm_match"] == "no"),
    "address_confirmed_yes": sum(1 for r in report if r["address_confirmed"] == "yes"),
    "website_confirmed": sum(1 for r in report if r["website_confirmed"] == "yes"),
    "website_unconfirmed": sum(1 for r in report if "website-unconfirmed" in r["actions"]),
    "phone_confirmed": sum(1 for r in report if r["phone_confirmed"] == "yes"),
    "phone_unconfirmed": sum(1 for r in report if "phone-unconfirmed" in r["actions"]),
    "filled_from_osm": sum(1 for r in report if "-from-osm" in r["actions"]),
    "updates": len(updates),
}, indent=2))

if APPLY:
    con.executemany("UPDATE businesses SET phone = ?, website = ?, hours = ? WHERE id = ?", updates)
    con.commit()
    print(f"APPLIED {len(updates)} row updates")
else:
    print("DRY RUN: no database writes (pass --apply to write)")
con.close()
