"""PHASE 2 - two-source additions and enrichment.

A venue is ADDED only when BOTH sources show it:
  * Overture Maps Places (latest release, Vancouver bbox, food & drink taxonomy)
  * City of Vancouver business licences (status = Issued, food/drink licence types)
matched by strict normalized address plus fuzzy name.

Existing rows that match both sources get only MISSING phone/website filled from Overture,
plus the City licence status and the licence data date. Single-source venues are written to a
review CSV and are never inserted. Existing non-empty values are never overwritten; any
disagreement goes to a conflicts CSV. Dry run unless --apply.
"""
import csv
import json
import math
import re
import shutil
import sqlite3
import sys
import tempfile
import unicodedata
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PRISMA = ROOT / "prisma"
DB = PRISMA / "dev.db"
DATA = ROOT / "data"
CACHE = Path(tempfile.gettempdir()) / "vancouver-directory-source-cache"
APPLY = "--apply" in sys.argv
stamp = datetime.now().strftime("%Y%m%d-%H%M%S")

STREET_ABBR = {"st": "street", "ave": "avenue", "av": "avenue", "rd": "road", "blvd": "boulevard",
               "dr": "drive", "hwy": "highway", "cres": "crescent", "pl": "place", "ct": "court",
               "e": "east", "w": "west", "n": "north", "s": "south"}
GENERIC = {"restaurant", "cafe", "coffee", "bar", "pub", "kitchen", "bistro", "grill", "lounge",
           "the", "and", "vancouver", "inc", "ltd", "shop", "house", "market", "bakery",
           "deli", "eatery", "tavern", "express", "of", "co"}

CATEGORY_MAP = [
    (("cafe", "coffee_shop", "coffee", "tea_house", "bubble_tea", "juice", "smoothie"), "Cafe"),
    (("bar", "pub", "brewery", "brewpub", "cocktail", "wine_bar", "gastropub", "tavern",
      "sports_bar", "night_club", "liquor_store"), "Bar / Pub"),
    (("bakery", "patisserie", "pastry", "donut", "doughnut", "baker"), "Bakery"),
    (("dessert", "ice_cream", "gelato", "frozen_yogurt", "confectionery", "candy",
      "chocolate", "creamery"), "Dessert"),
    (("fast_food", "food_court", "food_truck", "pizza_delivery", "sandwich"), "Fast Food"),
    (("restaurant", "diner", "bistro", "eatery", "deli", "noodle", "ramen", "sushi",
      "steakhouse", "buffet", "canteen", "grill", "food"), "Restaurant"),
]


def controlled_category(*values):
    for value in values:
        text = (value or "").lower().replace(" ", "_")
        if not text:
            continue
        for tokens, label in CATEGORY_MAP:
            for token in tokens:
                if token in text:
                    return label
    return "Restaurant"


def norm_text(value):
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(c for c in value if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def norm_name(value):
    tokens = [t for t in norm_text(value).split() if t and t not in GENERIC]
    return " ".join(tokens) if tokens else norm_text(value)


def norm_street(value):
    tokens = [STREET_ABBR.get(t, t) for t in norm_text(value).split()]
    return " ".join(tokens)


def split_address(value):
    text = norm_text(value)
    match = re.match(r"(\d+[a-z]?)\s+(.*)", text)
    if not match:
        return None, None
    street = re.sub(r"\b(vancouver|bc|canada)\b", " ", match.group(2))
    return match.group(1), norm_street(street)


def name_similarity(a, b):
    a_name, b_name = norm_name(a), norm_name(b)
    if not a_name or not b_name:
        return 0.0
    return SequenceMatcher(None, a_name, b_name).ratio()


def metres(lat_a, lon_a, lat_b, lon_b):
    if None in (lat_a, lon_a, lat_b, lon_b):
        return None
    mean = math.radians((lat_a + lat_b) / 2)
    return math.hypot((lon_a - lon_b) * 111320 * math.cos(mean), (lat_a - lat_b) * 111320)


def slugify(value, suffix):
    base = re.sub(r"[^a-z0-9]+", "-", norm_text(value)).strip("-") or "venue"
    return f"{base}-{suffix}"


# ---------------------------------------------------------------- load sources
overture_file = sorted(DATA.glob("overture-food-drink-candidates-*.csv"))[-1]
overture = []
with overture_file.open(encoding="utf-8") as fh:
    for row in csv.DictReader(fh):
        if (row.get("operating_status") or "open").lower().startswith("closed"):
            continue
        try:
            row["lat"] = float(row["lat"]) if row["lat"] else None
            row["lon"] = float(row["lon"]) if row["lon"] else None
            row["confidence"] = float(row["confidence"]) if row["confidence"] else None
        except ValueError:
            continue
        overture.append(row)
print(f"overture file={overture_file.name} usable places={len(overture)}")

licence_file = CACHE / "city-business-licences-issued-food.csv"
# Only licence types that correspond to a food/drink venue we would list.
VENUE_LICENCE_TYPES = {
    "limited service food establishment",
    "restaurant",
    "liquor establishment",
    "liquor retail store",
}
licences = []
with licence_file.open(encoding="utf-8-sig") as fh:
    for row in csv.DictReader(fh):
        if (row.get("businesstype") or "").strip().lower() not in VENUE_LICENCE_TYPES:
            continue
        house, street = split_address(f"{row.get('house') or ''} {row.get('street') or ''}")
        if not house or not street:
            continue
        licences.append({
            "name": row.get("businesstradename") or row.get("businessname") or "",
            "legal_name": row.get("businessname") or "",
            "house": house, "street": street,
            "type": row.get("businesstype") or "", "subtype": row.get("businesssubtype") or "",
            "status": row.get("status") or "", "extractdate": (row.get("extractdate") or "")[:10],
            "localarea": row.get("localarea") or "",
        })
print(f"licence file={licence_file.name} issued food/drink licences={len(licences)}")

licence_index = {}
for licence in licences:
    licence_index.setdefault((licence["house"], licence["street"]), []).append(licence)

NAME_THRESHOLD = 0.80


def match_licence(name, house, street):
    if not house or not street:
        return None
    best, best_score = None, 0.0
    for licence in licence_index.get((house, street), []):
        score = max(name_similarity(name, licence["name"]), name_similarity(name, licence["legal_name"]))
        if score > best_score:
            best, best_score = licence, score
    return best if best and best_score >= NAME_THRESHOLD else None


# ---------------------------------------------------------------- existing rows
con = sqlite3.connect(str(DB))
con.row_factory = sqlite3.Row
rows = [dict(r) for r in con.execute(
    "SELECT id, name, slug, address, latitude, longitude, phone, website, neighborhoodId, "
    "cityLicenceStatus, cityLicenceDataDate, dataSources, overtureConfidence, tags FROM businesses")]
neighborhoods = [dict(r) for r in con.execute("SELECT id, name, slug, mapBounds FROM neighborhoods")]
centres = []
for hood in neighborhoods:
    try:
        bounds = json.loads(hood["mapBounds"] or "{}")
        centres.append((hood, bounds.get("lat"), bounds.get("lng")))
    except Exception:
        pass


def nearest_neighborhood(lat, lon, fallback_area):
    if lat is not None and lon is not None:
        best, best_distance = None, None
        for hood, hood_lat, hood_lon in centres:
            distance = metres(lat, lon, hood_lat, hood_lon)
            if distance is not None and (best_distance is None or distance < best_distance):
                best, best_distance = hood, distance
        if best:
            return best["id"]
    for hood, *_ in centres:
        if fallback_area and hood["name"].lower() in (fallback_area or "").lower():
            return hood["id"]
    return centres[0][0]["id"] if centres else None


# index existing rows by (house, street) and by name for matching
existing_by_address = {}
for row in rows:
    house, street = split_address(row["address"])
    if house and street:
        existing_by_address.setdefault((house, street), []).append(row)

city_matches = {}
for row in rows:
    house, street = split_address(row["address"])
    licence = match_licence(row["name"], house, street)
    if licence:
        city_matches[row["id"]] = licence
print(f"existing rows matched to an Issued City licence={len(city_matches)}")

overture_matches = {}
for place in overture:
    house, street = split_address(f"{place.get('address_freeform') or ''}")
    candidates = list(existing_by_address.get((house, street), [])) if house and street else []
    if not candidates:
        # fall back to a proximity match within 120 m
        candidates = [row for row in rows
                      if metres(row["latitude"], row["longitude"], place["lat"], place["lon"]) is not None
                      and metres(row["latitude"], row["longitude"], place["lat"], place["lon"]) <= 120]
    best, best_score = None, 0.0
    for row in candidates:
        score = name_similarity(row["name"], place["name"])
        if score > best_score:
            best, best_score = row, score
    if best and best_score >= 0.85:
        overture_matches.setdefault(best["id"], place)
print(f"existing rows matched to an Overture place={len(overture_matches)}")

# ---------------------------------------------------------------- plan the writes
licence_updates, enrichment, conflicts = [], [], []
for row_id, licence in city_matches.items():
    row = next(r for r in rows if r["id"] == row_id)
    if row["cityLicenceStatus"] and row["cityLicenceStatus"] != licence["status"]:
        conflicts.append({"id": row_id, "name": row["name"], "field": "cityLicenceStatus",
                          "kept": row["cityLicenceStatus"], "incoming": licence["status"], "source": "city"})
    elif not row["cityLicenceStatus"]:
        licence_updates.append((licence["status"], licence["extractdate"], row_id))

both_ids = [row_id for row_id in city_matches if row_id in overture_matches]
for row_id in both_ids:
    row = next(r for r in rows if r["id"] == row_id)
    place = overture_matches[row_id]
    values = {}
    for field, incoming in (("phone", place.get("phone")), ("website", place.get("website"))):
        if not incoming:
            continue
        if not row[field]:
            values[field] = incoming
        elif row[field] != incoming:
            conflicts.append({"id": row_id, "name": row["name"], "field": field,
                              "kept": row[field], "incoming": incoming, "source": "overture"})
    sources = json.loads(row["dataSources"] or "[]")
    for source in ("overture", "city-of-vancouver-business-licences"):
        if source not in sources:
            sources.append(source)
    enrichment.append((values.get("phone"), values.get("website"), json.dumps(sources),
                       place.get("confidence"), row_id))
print(f"rows matched by BOTH sources={len(both_ids)} fields_filled={sum(1 for e in enrichment if e[0] or e[1])} "
      f"conflicts={len(conflicts)}")

existing_ids = {row["id"] for row in rows}
existing_slugs = {row["slug"] for row in rows}
# Pre-index existing rows so the large Overture set is not compared against every row.
existing_names = {}
for row in rows:
    existing_names.setdefault(norm_name(row["name"]), []).append(row)
coarse_index = {}
for row in rows:
    if row["latitude"] is not None and row["longitude"] is not None:
        coarse_index.setdefault((round(row["latitude"], 3), round(row["longitude"], 3)), []).append(row)


def already_present(place, house, street):
    candidates = []
    if house and street:
        candidates.extend(existing_by_address.get((house, street), []))
    name_key = norm_name(place["name"])
    candidates.extend(existing_names.get(name_key, []))
    if place["lat"] is not None and place["lon"] is not None:
        key = (round(place["lat"], 3), round(place["lon"], 3))
        candidates.extend(coarse_index.get(key, []))
        for d_lat in (-0.001, 0, 0.001):
            for d_lon in (-0.001, 0, 0.001):
                candidates.extend(coarse_index.get((round(place["lat"] + d_lat, 3), round(place["lon"] + d_lon, 3)), []))
    for row in candidates:
        if name_similarity(row["name"], place["name"]) < 0.85:
            continue
        same = house and street and split_address(row["address"]) == (house, street)
        near = (metres(row["latitude"], row["longitude"], place["lat"], place["lon"]) or 10 ** 9) <= 120
        if same or near:
            return True
    return False


additions, single_source = [], []
for place in overture:
    house, street = split_address(place.get("address_freeform") or "")
    licence = match_licence(place["name"], house, street)
    if already_present(place, house, street):
        continue
    if not licence:
        single_source.append((place, "overture-only (no Issued City licence at that address)"))
        continue
    address = place.get("address_freeform") or f"{house} {street.title()}, Vancouver"
    if "vancouver" not in address.lower():
        address = f"{address}, Vancouver"
    additions.append((place, licence, address))
print(f"new venues shown by BOTH sources={len(additions)} overture-only candidates={len(single_source)}")

if not APPLY:
    with (DATA / f"phase2-plan-{stamp}.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["action", "name", "address", "category", "source_detail"])
        for place, licence, address in additions:
            writer.writerow(["add", place["name"], address, controlled_category(place["category"]),
                             f"overture:{place['confidence']} city:{licence['type']}"])
        for place, reason in single_source[:5000]:
            writer.writerow(["review-only", place["name"], place.get("address_freeform") or "",
                             controlled_category(place["category"]), reason])
    print("DRY RUN: no writes (pass --apply); plan written to data/")
    raise SystemExit(0)

backup = PRISMA / f"dev.db.backup-phase2-sources-{stamp}.db"
shutil.copy2(DB, backup)
print(f"BACKUP {backup.name}")

archive_path = DATA / f"phase2-additions-{stamp}.csv"
with archive_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(["name", "address", "category", "phone", "website", "lat", "lon",
                     "overture_confidence", "city_licence_type", "city_licence_status",
                     "city_licence_data_date"])
    for place, licence, address in additions:
        writer.writerow([place["name"], address, controlled_category(place["category"]),
                         place.get("phone"), place.get("website"), place["lat"], place["lon"],
                         place["confidence"], licence["type"], licence["status"], licence["extractdate"]])
print(f"ADDITIONS ARCHIVE {archive_path.name} rows={len(additions)}")

review_path = DATA / f"phase2-single-source-review-{stamp}.csv"
with review_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(["name", "address", "category", "lat", "lon", "overture_confidence", "reason"])
    for place, reason in single_source:
        writer.writerow([place["name"], place.get("address_freeform") or "",
                         controlled_category(place["category"]), place["lat"], place["lon"],
                         place["confidence"], reason])
print(f"SINGLE-SOURCE REVIEW {review_path.name} rows={len(single_source)}")

conflict_path = DATA / f"phase2-conflicts-{stamp}.csv"
with conflict_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.DictWriter(fh, fieldnames=["id", "name", "field", "kept", "incoming", "source"])
    writer.writeheader()
    writer.writerows(conflicts)
print(f"CONFLICTS {conflict_path.name} rows={len(conflicts)}")

con.execute("BEGIN")
try:
    for status, data_date, row_id in licence_updates:
        con.execute("UPDATE businesses SET cityLicenceStatus = ?, cityLicenceDataDate = ? WHERE id = ?",
                    (status, data_date, row_id))
    for phone, website, sources, confidence, row_id in enrichment:
        con.execute(
            "UPDATE businesses SET phone = coalesce(?, phone), website = coalesce(?, website), "
            "dataSources = ?, overtureConfidence = ? WHERE id = ?",
            (phone, website, sources, confidence, row_id))
    inserted = 0
    for place, licence, address in additions:
        slug = slugify(place["name"], place["id"].split("-")[-1][:8])
        while slug in existing_slugs:
            slug = slug + "x"
        existing_slugs.add(slug)
        neighborhood_id = nearest_neighborhood(place["lat"], place["lon"], licence["localarea"])
        category = controlled_category(place["category"], place.get("brand"))
        con.execute(
            "INSERT INTO businesses (id, neighborhoodId, name, slug, category, primaryCategory, tags, "
            "address, latitude, longitude, phone, website, hours, priceRange, rating, reviewCount, photos, "
            "description, isVerified, createdAt, cityLicenceStatus, cityLicenceDataDate, dataSources, "
            "overtureConfidence) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,'[]',NULL,0,?,?,?,?,?)",
            (f"overture-{place['id']}", neighborhood_id, place["name"], slug, category, category,
             json.dumps(["source-overture"]), address, place["lat"], place["lon"],
             place.get("phone"), place.get("website"), int(time_ms := datetime.now().timestamp() * 1000),
             licence["status"], licence["extractdate"],
             json.dumps(["overture", "city-of-vancouver-business-licences"]), place["confidence"]))
        inserted += 1
    con.commit()
except Exception:
    con.rollback()
    raise
print(f"APPLIED: licence flags on {len(licence_updates)} rows, enrichment on {len(enrichment)} rows, "
      f"inserted {inserted} new venues")
print(json.dumps({
    "businesses": con.execute("SELECT COUNT(*) FROM businesses").fetchone()[0],
    "with_city_licence_status": con.execute("SELECT COUNT(*) FROM businesses WHERE cityLicenceStatus IS NOT NULL").fetchone()[0],
    "with_overture_confidence": con.execute("SELECT COUNT(*) FROM businesses WHERE overtureConfidence IS NOT NULL").fetchone()[0],
    "orphan_steps": con.execute("SELECT COUNT(*) FROM itinerary_steps s LEFT JOIN businesses b ON b.id = s.businessId WHERE s.businessId IS NOT NULL AND b.id IS NULL").fetchone()[0],
}, indent=2))
