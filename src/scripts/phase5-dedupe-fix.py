"""PHASE 5 - fix the leak found by Alfred's audit.

Two problems with the Phase 2 additions:
  1. the "already exists" check used a weaker address/name normalisation, so venues that were
     already in the Directory were added again (St/Street, W/West, &/and, Co/Company,
     word-order differences such as "Yamato Sushi" vs "Sushi Yamato", "Quesada" vs
     "Quesada Burritos & Tacos");
  2. 22 additions carry an Overture confidence below 0.5.

Fix: rebuild the matching with the stronger normalisation, keep the EXISTING row, fill only its
empty fields from the new copy, then delete the new copy. Low-confidence additions are removed
and listed for review. Doubtful duplicate pairs go to a review CSV instead of being deleted.
Dry run unless --apply.
"""
import csv
import json
import math
import re
import shutil
import sqlite3
import sys
import unicodedata
from difflib import SequenceMatcher
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PRISMA = ROOT / "prisma"
DB = PRISMA / "dev.db"
DATA = ROOT / "data"
APPLY = "--apply" in sys.argv
stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
LOW_CONFIDENCE = 0.5
DISTANCE_M = 120.0

# Street and word abbreviations that must not block a match.
ABBR = {
    "st": "street", "str": "street", "ave": "avenue", "av": "avenue", "rd": "road",
    "blvd": "boulevard", "dr": "drive", "hwy": "highway", "cres": "crescent", "pl": "place",
    "ct": "court", "e": "east", "w": "west", "n": "north", "s": "south", "co": "company",
    "ltd": "limited", "inc": "incorporated", "brothers": "bros", "rest": "restaurant",
    "cafe": "cafe", "the": "the",
}
FILLABLE = ["phone", "website", "hours"]
PROVENANCE = ["cityLicenceStatus", "cityLicenceDataDate", "liquorLicenceType",
              "liquorServiceHours", "overtureConfidence", "dataSources"]


def norm_text(value):
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(c for c in value if not unicodedata.combining(c))
    value = value.replace("&", " and ").replace("+", " and ")
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def tokens(value):
    expanded = [ABBR.get(t, t) for t in norm_text(value).split()]
    return expanded


def name_tokens(value):
    return tokens(value)


def name_key(value):
    return " ".join(t for t in name_tokens(value) if t not in {"the", "vancouver"})


def name_similarity(a, b):
    a_key, b_key = name_key(a), name_key(b)
    if not a_key or not b_key:
        return 0.0
    a_set, b_set = set(a_key.split()), set(b_key.split())
    jaccard = len(a_set & b_set) / len(a_set | b_set) if (a_set | b_set) else 0.0
    sequence = SequenceMatcher(None, a_key, b_key).ratio()
    return max(jaccard, sequence * 0.95)


def name_containment(a, b):
    """"Quesada" is contained in "Quesada Burritos and Tacos"."""
    a_set, b_set = set(name_key(a).split()), set(name_key(b).split())
    if not a_set or not b_set:
        return False
    smaller, larger = (a_set, b_set) if len(a_set) <= len(b_set) else (b_set, a_set)
    return len(smaller) >= 1 and smaller.issubset(larger) and len(larger) - len(smaller) <= 3


def address_key(value):
    text = norm_text(value)
    match = re.match(r"(\d+[a-z]?)\s+(.*)", text)
    if not match:
        return None
    street = re.sub(r"\b(vancouver|bc|canada)\b", " ", match.group(2))
    street_tokens = [ABBR.get(t, t) for t in street.split()]
    return match.group(1), " ".join(street_tokens)


def metres(a, b):
    if None in (a["latitude"], a["longitude"], b["latitude"], b["longitude"]):
        return None
    mean = math.radians((a["latitude"] + b["latitude"]) / 2)
    return math.hypot((a["longitude"] - b["longitude"]) * 111320 * math.cos(mean),
                      (a["latitude"] - b["latitude"]) * 111320)


con = sqlite3.connect(str(DB))
con.row_factory = sqlite3.Row
rows = [dict(r) for r in con.execute("SELECT * FROM businesses")]
new_comers = [r for r in rows if str(r["id"]).startswith("overture-")]
originals = [r for r in rows if not str(r["id"]).startswith("overture-")]
print(f"rows={len(rows)} phase2_additions={len(new_comers)} pre-existing={len(originals)}")

by_address = {}
by_name = {}
by_coarse = {}
for row in originals:
    key = address_key(row["address"])
    if key:
        by_address.setdefault(key, []).append(row)
    by_name.setdefault(name_key(row["name"]), []).append(row)
    if row["latitude"] is not None:
        by_coarse.setdefault((round(row["latitude"], 3), round(row["longitude"], 3)), []).append(row)


def compact_key(value):
    return name_key(value).replace(" ", "")


def candidates_for(row):
    found = []
    key = address_key(row["address"])
    if key:
        found.extend(by_address.get(key, []))
    found.extend(by_name.get(name_key(row["name"]), []))
    if row["latitude"] is not None:
        for d_lat in (-0.001, 0, 0.001):
            for d_lon in (-0.001, 0, 0.001):
                found.extend(by_coarse.get((round(row["latitude"] + d_lat, 3),
                                            round(row["longitude"] + d_lon, 3)), []))
    unique = {}
    for candidate in found:
        unique[candidate["id"]] = candidate
    return list(unique.values())


mergeable, doubtful = [], []
for row in new_comers:
    best, best_score, best_reason = None, 0.0, ""
    for candidate in candidates_for(row):
        same_address = bool(address_key(row["address"]) and address_key(candidate["address"]) == address_key(row["address"]))
        distance = metres(row, candidate)
        near = distance is not None and distance <= DISTANCE_M
        if not (same_address or near):
            continue
        score = name_similarity(row["name"], candidate["name"])
        contained = name_containment(row["name"], candidate["name"])
        compact_equal = compact_key(row["name"]) == compact_key(candidate["name"])
        if same_address and (contained or compact_equal or score >= 0.80):
            reason = "same normalized address"
        elif near and score >= 0.85:
            reason = "within 120 m and near-identical name"
        else:
            if (same_address or near) and score >= 0.45:
                doubtful.append((row, candidate, score, distance))
            continue
        if score > best_score or (contained and best_reason != "same normalized address"):
            best, best_score, best_reason = candidate, score, reason
    if best:
        mergeable.append((row, best, best_score, best_reason))

merged_ids = {}
for row, keep, score, reason in mergeable:
    merged_ids.setdefault(keep["id"], []).append(row)
print(f"duplicate additions found={len(mergeable)} doubtful pairs={len(doubtful)}")

low_confidence = [r for r in new_comers
                  if r["id"] not in {row["id"] for row, *_ in mergeable}
                  and (r["overtureConfidence"] is None or r["overtureConfidence"] < LOW_CONFIDENCE)]
print(f"low-confidence additions removed for review={len(low_confidence)}")

fills = {}
conflicts = []
for row, keep, score, reason in mergeable:
    for field in FILLABLE + PROVENANCE:
        incoming = row[field]
        if incoming in (None, ""):
            continue
        if keep[field] in (None, ""):
            fills.setdefault(keep["id"], {})[field] = incoming
        elif field in ("dataSources",):
            try:
                merged = sorted(set(json.loads(keep[field] or "[]")) | set(json.loads(incoming or "[]")))
            except Exception:
                merged = None
            if merged:
                fills.setdefault(keep["id"], {})["dataSources"] = json.dumps(merged)
        elif field != "overtureConfidence" and keep[field] != incoming:
            conflicts.append({"kept_id": keep["id"], "kept_name": keep["name"], "field": field,
                              "kept_value": keep[field], "removed_value": incoming})
print(f"fields to fill on kept rows={sum(len(v) for v in fills.values())} conflicts={len(conflicts)}")

removed = list(merged_ids.keys()) and [row["id"] for row, *_ in mergeable] + [r["id"] for r in low_confidence]

plan_path = DATA / f"phase5-duplicate-removals-{stamp}.csv"
with plan_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(["removed_id", "removed_name", "removed_address", "kept_id", "kept_name",
                     "kept_address", "similarity", "reason"])
    for row, keep, score, reason in mergeable:
        writer.writerow([row["id"], row["name"], row["address"], keep["id"], keep["name"],
                         keep["address"], round(score, 3), reason])
print(f"PLAN {plan_path.name}")

review_path = DATA / f"phase5-review-doubtful-{stamp}.csv"
with review_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(["new_id", "new_name", "new_address", "existing_id", "existing_name",
                     "existing_address", "similarity", "distance_m"])
    for row, candidate, score, distance in doubtful:
        writer.writerow([row["id"], row["name"], row["address"], candidate["id"], candidate["name"],
                         candidate["address"], round(score, 3),
                         "" if distance is None else round(distance, 1)])
low_path = DATA / f"phase5-low-confidence-removed-{stamp}.csv"
with low_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(["id", "name", "address", "category", "overture_confidence", "city_licence_type"])
    for row in low_confidence:
        writer.writerow([row["id"], row["name"], row["address"], row["category"],
                         row["overtureConfidence"], row["cityLicenceStatus"]])
print(f"REVIEW {review_path.name} / LOW-CONFIDENCE {low_path.name}")

if not APPLY:
    print("DRY RUN: no writes (pass --apply)")
    raise SystemExit(0)

backup = PRISMA / f"dev.db.backup-phase5-dedupe-fix-{stamp}.db"
shutil.copy2(DB, backup)
print(f"BACKUP {backup.name}")

archive_path = DATA / f"phase5-removed-rows-{stamp}.csv"
columns = [d[0] for d in con.execute("SELECT * FROM businesses LIMIT 1").description]
duplicate_ids = {row["id"] for row, *_ in mergeable}
with archive_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(columns + ["reason"])
    for row_id in removed:
        full = con.execute("SELECT * FROM businesses WHERE id = ?", (row_id,)).fetchone()
        reason = "duplicate of an existing row" if row_id in duplicate_ids else "overture confidence < 0.5"
        writer.writerow([full[c] for c in columns] + [reason])
print(f"ARCHIVE {archive_path.name} rows={len(removed)}")

conflict_path = DATA / f"phase5-conflicts-{stamp}.csv"
with conflict_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.DictWriter(fh, fieldnames=["kept_id", "kept_name", "field", "kept_value", "removed_value"])
    writer.writeheader()
    writer.writerows(conflicts)

con.execute("BEGIN")
try:
    for keep_id, values in fills.items():
        sets = ", ".join(f"{field} = ?" for field in values)
        con.execute(f"UPDATE businesses SET {sets} WHERE id = ?", list(values.values()) + [keep_id])
    con.executemany("DELETE FROM businesses WHERE id = ?", [(row_id,) for row_id in removed])
    con.commit()
except Exception:
    con.rollback()
    raise
print(f"APPLIED: merged {len(mergeable)} duplicates, removed {len(low_confidence)} low-confidence rows, "
      f"filled {sum(len(v) for v in fills.values())} fields on {len(fills)} existing rows")

print(json.dumps({
    "businesses": con.execute("SELECT COUNT(*) FROM businesses").fetchone()[0],
    "overture_rows_left": con.execute("SELECT COUNT(*) FROM businesses WHERE id LIKE 'overture-%'").fetchone()[0],
    "duplicate_slugs": con.execute("SELECT COUNT(*) FROM (SELECT slug FROM businesses GROUP BY slug HAVING COUNT(*)>1)").fetchone()[0],
    "orphan_steps": con.execute("SELECT COUNT(*) FROM itinerary_steps s LEFT JOIN businesses b ON b.id = s.businessId WHERE s.businessId IS NOT NULL AND b.id IS NULL").fetchone()[0],
    "itineraries": con.execute("SELECT COUNT(*) FROM itineraries").fetchone()[0],
    "steps": con.execute("SELECT COUNT(*) FROM itinerary_steps").fetchone()[0],
}, indent=2))
con.close()
