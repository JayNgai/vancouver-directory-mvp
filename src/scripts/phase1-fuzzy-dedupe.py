"""PHASE 1 - fuzzy de-duplication of the Directory database.

Rules (from Alfred, Jay-approved):
  * merge when the normalized names are similar AND (same normalized address OR within ~120 m)
  * never merge chain branches at different addresses (different house numbers block a merge)
  * keep the most complete row and FILL its gaps from the removed row (never overwrite a non-empty value)
  * conflicts (both values present and different) go to a review CSV
  * ambiguous pairs go to a review CSV instead of being deleted
  * repoint itinerary_steps before deleting, then prove 3 itineraries / 12 steps still resolve
  * removed rows archived to CSV; every archive/lookup writes to data/

Dry run by default; --apply writes. Takes its own named backup.
"""
import csv
import difflib
import json
import math
import re
import shutil
import sqlite3
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PRISMA = ROOT / "prisma"
DB = PRISMA / "dev.db"
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
APPLY = "--apply" in sys.argv
stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
DISTANCE_M = 120.0
SIM_ADDRESS = 0.72
SIM_DISTANCE = 0.85
SIM_AMBIGUOUS_FLOOR = 0.60

GENERIC = {"restaurant", "cafe", "coffee", "bar", "pub", "kitchen", "bistro", "grill",
           "lounge", "the", "and", "vancouver", "inc", "ltd", "co", "shop", "house",
           "market", "bakery", "deli", "eatery", "tavern", "bar", "raw", "bar+raw"}


def norm_text(value):
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(c for c in value if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def norm_name(value):
    text = norm_text(value)
    tokens = [t for t in text.split() if t]
    core = [t for t in tokens if t not in GENERIC]
    return (core or tokens)


def norm_address(value):
    text = norm_text(value)
    text = re.sub(r"\bvancouver\b", " ", text)
    text = re.sub(r"\bbc\b", " ", text)
    text = re.sub(r"\bv\d[a-z]\s*\d[a-z]\d\b", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def house_number(value):
    match = re.match(r"\s*(\d+[a-z]?)", value or "")
    return match.group(1) if match else None


def similarity(a_name, b_name):
    a_core, b_core = norm_name(a_name), norm_name(b_name)
    a_all, b_all = norm_text(a_name), norm_text(b_name)
    set_ratio = difflib.SequenceMatcher(None, " ".join(a_core), " ".join(b_core)).ratio()
    full_ratio = difflib.SequenceMatcher(None, a_all, b_all).ratio()
    a_set, b_set = set(a_core), set(b_core)
    jaccard = len(a_set & b_set) / len(a_set | b_set) if (a_set | b_set) else 0.0
    return max(set_ratio, full_ratio * 0.95, jaccard)


def metres(a, b):
    if None in (a["latitude"], a["longitude"], b["latitude"], b["longitude"]):
        return None
    mean = math.radians((a["latitude"] + b["latitude"]) / 2)
    return math.hypot((a["longitude"] - b["longitude"]) * 111320 * math.cos(mean),
                      (a["latitude"] - b["latitude"]) * 111320)


FILLABLE = ["phone", "website", "hours", "description", "slug"]


def completeness(row):
    score = 0
    if house_number(row["address"]):
        score += 4
    if row["phone"]:
        score += 3
    if row["website"]:
        score += 3
    if row["hours"]:
        score += 2
    if row["description"]:
        score += 1
    if row["latitude"] is not None:
        score += 1

    try:
        if json.loads(row["photos"] or "[]"):
            score += 1
    except Exception:
        pass
    return score


backup = PRISMA / f"dev.db.backup-phase1-fuzzy-{stamp}.db"
if APPLY:
    shutil.copy2(DB, backup)
    print(f"BACKUP {backup.name}")

con = sqlite3.connect(str(DB))
con.row_factory = sqlite3.Row
rows = [dict(r) for r in con.execute(
    "SELECT id, name, slug, category, primaryCategory, tags, address, latitude, longitude, "
    "phone, website, hours, description, neighborhoodId FROM businesses")]
print(f"rows={len(rows)}")

# --- candidate pair scanning, bucketed by first significant name token ---------
buckets = {}
for row in rows:
    core = norm_name(row["name"])
    if not core:
        continue
    buckets.setdefault(core[0], []).append(row)

pairs = []
seen = set()
for key, group in buckets.items():
    for i, a in enumerate(group):
        for b in group[i + 1:]:
            if a["id"] == b["id"]:
                continue
            pair_key = tuple(sorted((a["id"], b["id"])))
            if pair_key in seen:
                continue
            seen.add(pair_key)
            sim = similarity(a["name"], b["name"])
            if sim < SIM_AMBIGUOUS_FLOOR:
                continue
            distance = metres(a, b)
            same_address = (house_number(a["address"]) and house_number(b["address"])
                            and norm_address(a["address"]) == norm_address(b["address"]))
            close = distance is not None and distance <= DISTANCE_M
            # Pairs with no address/coordinate evidence are only worth review when the names
            # are effectively identical and the two points are not far apart.
            weak_evidence = (
                sim >= 0.90 and (
                    (distance is not None and distance <= 250) or
                    (distance is None and not house_number(a["address"]) and not house_number(b["address"]))
                )
            )
            if not (same_address or close or weak_evidence):
                continue
            pairs.append((a, b, sim, distance, bool(same_address), bool(close)))

print(f"candidate near pairs={len(pairs)}")

merges = []
ambiguous = []
for a, b, sim, distance, same_address, close in pairs:
    hn_a, hn_b = house_number(a["address"]), house_number(b["address"])
    different_branch = bool(hn_a and hn_b and hn_a != hn_b)
    if same_address and sim >= SIM_ADDRESS and not different_branch:
        merges.append((a, b, sim, distance, "same normalized address"))
    elif close and sim >= SIM_DISTANCE and not different_branch:
        merges.append((a, b, sim, distance, "within 120 m and near-identical name"))
    elif different_branch and (same_address or close) and sim >= SIM_AMBIGUOUS_FLOOR:
        ambiguous.append((a, b, sim, distance, "different house numbers (possible chain branches)"))
    elif sim >= SIM_ADDRESS:
        ambiguous.append((a, b, sim, distance, "similar names but address/distance not decisive"))

# collapse transitive merges into clusters
parent = {}


def find(x):
    parent.setdefault(x, x)
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb:
        parent[rb] = ra


for a, b, *_ in merges:
    union(a["id"], b["id"])

by_id = {row["id"]: row for row in rows}
clusters = {}
for row_id in list(parent.keys()):
    clusters.setdefault(find(row_id), []).append(by_id[row_id])

merge_plan = []
for members in clusters.values():
    members.sort(key=lambda r: (-completeness(r), r["id"]))
    keep, drop = members[0], members[1:]
    if drop:
        merge_plan.append((keep, drop))

pair_meta = {}
for a, b, sim, distance, reason in merges:
    pair_meta[tuple(sorted((a["id"], b["id"])))] = (round(sim, 3), distance, reason)

print(f"merge clusters={len(merge_plan)} rows_to_remove={sum(len(d) for _, d in merge_plan)}")
print(f"ambiguous pairs for review={len(ambiguous)}")
for keep, drop in merge_plan[:20]:
    for row in drop:
        print(f"   merge {row['name']!r} -> {keep['name']!r} ({row['address'][:38]!r})")

# --- what would be filled / conflicted ---------------------------------------
fills = {}
conflicts = []
for keep, drop in merge_plan:
    destination = dict(keep)
    for row in drop:
        for field in FILLABLE:
            value = row[field]
            if not value:
                continue
            if not destination[field]:
                fills.setdefault(keep["id"], {})[field] = value
                destination[field] = value
            elif destination[field] != value:
                conflicts.append({"kept_id": keep["id"], "kept_name": keep["name"], "removed_id": row["id"],
                                  "field": field, "kept_value": destination[field], "removed_value": value})
print(f"fields to fill on kept rows={sum(len(v) for v in fills.values())} conflicts={len(conflicts)}")

# --- itinerary step reference check ------------------------------------------
steps = [dict(r) for r in con.execute("SELECT id, itineraryId, \"order\", businessId FROM itinerary_steps")]
removed_ids = {row["id"] for _, drop in merge_plan for row in drop}
repoint = []
for keep, drop in merge_plan:
    for row in drop:
        for step in steps:
            if step["businessId"] == row["id"]:
                repoint.append((keep["id"], step["id"]))
print(f"itinerary steps referencing a removed row={len(repoint)}")

plan_path = DATA / f"phase1-merge-plan-{stamp}.csv"
with plan_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(["kept_id", "kept_name", "kept_address", "removed_id", "removed_name",
                     "removed_address", "similarity", "distance_m", "reason"])
    for keep, drop in merge_plan:
        for row in drop:
            sim, distance, reason = pair_meta.get(tuple(sorted((keep["id"], row["id"]))), ("", None, "cluster"))
            writer.writerow([keep["id"], keep["name"], keep["address"], row["id"], row["name"],
                             row["address"], sim,
                             "" if distance is None else round(distance, 1), reason])
print(f"PLAN {plan_path.name}")

review_path = DATA / f"phase1-review-ambiguous-{stamp}.csv"
with review_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(["id_a", "name_a", "address_a", "id_b", "name_b", "address_b",
                     "similarity", "distance_m", "reason"])
    for a, b, sim, distance, reason in ambiguous:
        writer.writerow([a["id"], a["name"], a["address"], b["id"], b["name"], b["address"],
                         round(sim, 3), "" if distance is None else round(distance, 1), reason])
print(f"REVIEW {review_path.name}")

if not APPLY:
    print("DRY RUN: no writes (pass --apply)")
    raise SystemExit(0)

columns = [d[0] for d in con.execute("SELECT * FROM businesses LIMIT 1").description]
removed_path = DATA / f"phase1-removed-rows-{stamp}.csv"
with removed_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(columns + ["merged_into"])
    for keep, drop in merge_plan:
        for row in drop:
            full = con.execute("SELECT * FROM businesses WHERE id = ?", (row["id"],)).fetchone()
            writer.writerow([full[c] for c in columns] + [keep["id"]])
print(f"ARCHIVE {removed_path.name} rows={len(removed_ids)}")

conflict_path = DATA / f"phase1-conflicts-{stamp}.csv"
with conflict_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.DictWriter(fh, fieldnames=["kept_id", "kept_name", "removed_id", "field",
                                            "kept_value", "removed_value"])
    writer.writeheader()
    writer.writerows(conflicts)
print(f"CONFLICTS {conflict_path.name} rows={len(conflicts)}")

con.execute("BEGIN")
try:
    if repoint:
        con.executemany("UPDATE itinerary_steps SET businessId = ? WHERE id = ?", repoint)
    for keep_id, values in fills.items():
        sets = ", ".join(f"{field} = ?" for field in values)
        con.execute(f"UPDATE businesses SET {sets} WHERE id = ?", list(values.values()) + [keep_id])
        # provenance for enriched fields
        tags = json.loads(con.execute("SELECT tags FROM businesses WHERE id = ?", (keep_id,)).fetchone()[0] or "[]")
        if "source-internal-merge" not in tags:
            tags.append("source-internal-merge")
            con.execute("UPDATE businesses SET tags = ? WHERE id = ?", (json.dumps(tags), keep_id))
    con.executemany("DELETE FROM businesses WHERE id = ?", [(row_id,) for row_id in removed_ids])
    con.commit()
except Exception:
    con.rollback()
    raise
print(f"APPLIED: merged {len(merge_plan)} clusters, removed {len(removed_ids)} rows, "
      f"filled {sum(len(v) for v in fills.values())} fields on {len(fills)} rows")

businesses = con.execute("SELECT COUNT(*) FROM businesses").fetchone()[0]
itineraries = con.execute("SELECT COUNT(*) FROM itineraries").fetchone()[0]
step_count = con.execute("SELECT COUNT(*) FROM itinerary_steps").fetchone()[0]
orphans = con.execute(
    "SELECT COUNT(*) FROM itinerary_steps s LEFT JOIN businesses b ON b.id = s.businessId "
    "WHERE s.businessId IS NOT NULL AND b.id IS NULL").fetchone()[0]
dupe_slugs = con.execute(
    "SELECT COUNT(*) FROM (SELECT slug FROM businesses GROUP BY slug HAVING COUNT(*) > 1)").fetchone()[0]
per_hood = [tuple(r) for r in con.execute(
    "SELECT n.name, COUNT(b.id) FROM neighborhoods n LEFT JOIN businesses b ON b.neighborhoodId = n.id "
    "GROUP BY n.id ORDER BY n.name")]
print(json.dumps({"businesses": businesses, "itineraries": itineraries, "steps": step_count,
                  "orphan_steps": orphans, "duplicate_slugs": dupe_slugs}, indent=2))
print("per-neighbourhood:", per_hood)
con.close()
