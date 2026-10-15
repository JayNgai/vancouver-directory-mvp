"""PHASE 3 - BC liquor licences (Open Government Licence - British Columbia).

Downloads are cached; this script reads the workbook from the cache, matches Vancouver rows to
Directory venues by normalized name plus address, and stores the licence type and the
Hours of Service.

IMPORTANT: these are SERVING hours (when alcohol may be served), NOT opening hours. They are
stored in `liquorServiceHours` only and are never written to `hours`. Unmatched venues get
nothing. Existing non-empty values are never overwritten; disagreements go to a conflicts CSV.
Dry run unless --apply.
"""
import csv
import json
import re
import shutil
import sqlite3
import sys
import tempfile
import unicodedata
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
PRISMA = ROOT / "prisma"
DB = PRISMA / "dev.db"
DATA = ROOT / "data"
CACHE = Path(tempfile.gettempdir()) / "vancouver-directory-source-cache"
APPLY = "--apply" in sys.argv
stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
SHORT = {"Sunday": "Sun", "Monday": "Mon", "Tuesday": "Tue", "Wednesday": "Wed",
         "Thursday": "Thu", "Friday": "Fri", "Saturday": "Sat"}
STREET_ABBR = {"st": "street", "ave": "avenue", "av": "avenue", "rd": "road", "blvd": "boulevard",
               "dr": "drive", "hwy": "highway", "cres": "crescent", "pl": "place", "ct": "court",
               "e": "east", "w": "west", "n": "north", "s": "south"}
GENERIC = {"restaurant", "cafe", "coffee", "bar", "pub", "kitchen", "bistro", "grill", "lounge",
           "the", "and", "vancouver", "inc", "ltd", "shop", "house", "market", "bakery",
           "deli", "eatery", "tavern", "express", "of", "co"}


def norm_text(value):
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(c for c in value if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def norm_name(value):
    value = re.sub(r"\(\s*\d+\s*\)", " ", value or "")
    tokens = [t for t in norm_text(value).split() if t and t not in GENERIC]
    return " ".join(tokens) if tokens else norm_text(value)


def norm_street(value):
    return " ".join(STREET_ABBR.get(t, t) for t in norm_text(value).split())


def split_address(value):
    text = norm_text(value)
    match = re.match(r"(\d+[a-z]?)\s+(.*)", text)
    if not match:
        return None, None
    street = re.sub(r"\b(vancouver|bc|canada)\b", " ", match.group(2))
    return match.group(1), norm_street(street)


def similarity(a, b):
    a_name, b_name = norm_name(a), norm_name(b)
    if not a_name or not b_name:
        return 0.0
    return SequenceMatcher(None, a_name, b_name).ratio()


def clock(value):
    """'07:00 PM' -> '19:00'; '12:00 AM' -> '00:00'; '12:00 PM' -> '12:00'."""
    if not value:
        return None
    match = re.match(r"(\d{1,2}):(\d{2})\s*([AP]M)?", str(value).strip().upper())
    if not match:
        return None
    hour, minute, meridiem = int(match.group(1)), match.group(2), match.group(3)
    if meridiem == "PM" and hour != 12:
        hour += 12
    if meridiem == "AM" and hour == 12:
        hour = 0
    return f"{hour:02d}:{minute}"


workbook = CACHE / "bc-licensed-establishments.xlsx"
wb = openpyxl.load_workbook(workbook, read_only=True, data_only=True)

main = wb["Liquor Web Stats Active Lic..."]
rows = list(main.iter_rows(values_only=True))
header = [str(h) for h in rows[0]]
idx = {name: i for i, name in enumerate(header)}
vancouver = []
for row in rows[1:]:
    if str(row[idx["Establishment Address City"]] or "").strip().lower() != "vancouver":
        continue
    establishment = re.sub(r"\s*\(\s*\d+\s*\)\s*$", "", str(row[idx["Establishment"]] or "")).strip()
    house, street = split_address(f"{row[idx['Establishment Address Street']] or ''}")
    vancouver.append({
        "number": str(row[idx["Licence Number"]] or "").strip(),
        "type": str(row[idx["Licence Type"]] or "").strip(),
        "name": establishment,
        "house": house, "street": street,
        "street_raw": str(row[idx["Establishment Address Street"]] or "").strip(),
        "expiry": str(row[idx["Expiry Date"]] or "").strip(),
    })
print(f"BC Vancouver licensed establishments={len(vancouver)}")

hours_sheet = wb["Hours of Service"]
hrows = list(hours_sheet.iter_rows(values_only=True))
hheader = [str(h) for h in hrows[0]]
hindex = {name: i for i, name in enumerate(hheader)}
service = {}
for row in hrows[1:]:
    number = str(row[0] or "").strip()
    windows = {}
    for day in DAYS:
        open_value = clock(row[hindex[f"{day} Open"]]) if f"{day} Open" in hindex else None
        close_value = clock(row[hindex[f"{day} Close"]]) if f"{day} Close" in hindex else None
        if open_value and close_value:
            windows[SHORT[day]] = f"{open_value}-{close_value}"
    if windows:
        service[number] = windows
print(f"licences with serving hours={len(service)}")

index = {}
for licence in vancouver:
    if licence["house"] and licence["street"]:
        index.setdefault((licence["house"], licence["street"]), []).append(licence)

con = sqlite3.connect(str(DB))
con.row_factory = sqlite3.Row
rows = [dict(r) for r in con.execute(
    "SELECT id, name, address, liquorLicenceType, liquorServiceHours, dataSources FROM businesses")]

matches, unmatched, conflicts = [], [], []
for row in rows:
    house, street = split_address(row["address"])
    candidates = index.get((house, street), []) if (house and street) else []
    best, best_score = None, 0.0
    for licence in candidates:
        score = similarity(row["name"], licence["name"])
        if score > best_score:
            best, best_score = licence, score
    if not best or best_score < 0.80:
        unmatched.append(row["name"])
        continue
    windows = service.get(best["number"])
    if not windows:
        unmatched.append(row["name"])
        continue
    if row["liquorLicenceType"] and row["liquorLicenceType"] != best["type"]:
        conflicts.append({"id": row["id"], "name": row["name"], "field": "liquorLicenceType",
                          "kept": row["liquorLicenceType"], "incoming": best["type"], "source": "bc-liquor"})
        continue
    matches.append((best["type"], json.dumps(windows, sort_keys=True), best["number"], best["name"],
                    best_score, row["id"]))

print(f"matched venues with serving hours={len(matches)} unmatched={len(unmatched)} conflicts={len(conflicts)}")
for item in matches[:8]:
    print(f"   {item[0]:<18} {item[3][:32]:32} sim={item[4]:.2f} {item[1]}")

match_path = DATA / f"phase3-bc-liquor-matches-{stamp}.csv"
with match_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(["business_id", "bc_establishment", "licence_number", "licence_type",
                     "serving_hours_json", "name_similarity"])
    for item in matches:
        writer.writerow([item[5], item[3], item[2], item[0], item[1], round(item[4], 3)])
print(f"MATCHES {match_path.name}")
(CACHE / "bc-vancouver-licences.json").write_text(json.dumps({"count": len(vancouver),
                                                              "with_hours": len(service)}), encoding="utf-8")

if not APPLY:
    print("DRY RUN: no writes (pass --apply)")
    raise SystemExit(0)

backup = PRISMA / f"dev.db.backup-phase3-bc-liquor-{stamp}.db"
shutil.copy2(DB, backup)
print(f"BACKUP {backup.name}")

conflict_path = DATA / f"phase3-conflicts-{stamp}.csv"
with conflict_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.DictWriter(fh, fieldnames=["id", "name", "field", "kept", "incoming", "source"])
    writer.writeheader()
    writer.writerows(conflicts)

con.execute("BEGIN")
try:
    for licence_type, hours_json, _number, _name, _sim, row_id in matches:
        sources = json.loads((con.execute("SELECT dataSources FROM businesses WHERE id = ?",
                                          (row_id,)).fetchone()[0]) or "[]")
        if "bc-liquor-licensed-establishments" not in sources:
            sources.append("bc-liquor-licensed-establishments")
        con.execute(
            "UPDATE businesses SET liquorLicenceType = coalesce(liquorLicenceType, ?), "
            "liquorServiceHours = coalesce(liquorServiceHours, ?), dataSources = ? WHERE id = ?",
            (licence_type, hours_json, json.dumps(sources), row_id))
    con.commit()
except Exception:
    con.rollback()
    raise
print(f"APPLIED: serving hours stored on {len(matches)} venues")
print(json.dumps({
    "businesses": con.execute("SELECT COUNT(*) FROM businesses").fetchone()[0],
    "with_liquor_service_hours": con.execute("SELECT COUNT(*) FROM businesses WHERE liquorServiceHours IS NOT NULL").fetchone()[0],
    "hours_opening_field_untouched": con.execute("SELECT COUNT(*) FROM businesses WHERE hours IS NOT NULL").fetchone()[0],
}, indent=2))
