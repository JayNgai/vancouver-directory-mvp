"""PHASE 6 - global duplicate sweep with the strengthened matcher.

Phase 5 removed the additions that duplicated existing rows. This pass applies the same
matcher to every remaining pair, because a few duplicates that predate the enrichment
(e.g. "Blenz Coffee" twice at 4198 Main St, "Quesada Burritos and Tacos" vs
"Quesada Burritos & Tacos", "Cuhillo" vs "Cuchillo") were missed by the earlier, stricter
rules that treated St/Street, W/West and &/and as different.

Merge rules (documented, conservative):
  * same normalized address (abbreviations expanded, "&" read as "and") AND
    (one name's tokens contain the other's with at most 5 extra tokens, OR the compact keys
    are equal, OR similarity >= 0.90)
  * OR within 120 m AND similarity >= 0.90 AND (containment OR equal token sets)
Everything else that is close and name-similar goes to a review CSV instead of being merged.
The more complete row is kept; only its empty fields are filled; removed rows are archived;
itinerary steps are repointed before deletion. Dry run unless --apply.
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
DISTANCE_M = 120.0

ABBR = {"st": "street", "str": "street", "ave": "avenue", "av": "avenue", "rd": "road",
        "blvd": "boulevard", "dr": "drive", "hwy": "highway", "cres": "crescent", "pl": "place",
        "ct": "court", "e": "east", "w": "west", "n": "north", "s": "south", "co": "company",
        "ltd": "limited", "inc": "incorporated", "s": "s"}
FILLABLE = ["phone", "website", "hours", "description"]
ALIAS_FIELD = "slugAliases"


def norm(value):
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(c for c in value if not unicodedata.combining(c))
    value = value.replace("&", " and ").replace("+", " and ")
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def name_key(value):
    tokens = [ABBR.get(t, t) for t in norm(value).split()]
    return " ".join(t for t in tokens if t not in {"the", "vancouver"})


def address_key(value):
    text = norm(value)
    # drop Canadian postal codes and the city/province so "302 W Hastings St, Vancouver, BC V6B 2N4"
    # and "302 West Hastings Street" normalise to the same key
    text = re.sub(r"\bv\d[a-z]\s*\d[a-z]\d\b", " ", text)
    match = re.match(r"(\d+[a-z]?)\s+(.*)", text)
    if not match:
        return None
    street = re.sub(r"\b(vancouver|bc|canada)\b", " ", match.group(2))
    return match.group(1), " ".join(ABBR.get(t, t) for t in street.split())


def similarity(a, b):
    a_key, b_key = name_key(a), name_key(b)
    a_set, b_set = set(a_key.split()), set(b_key.split())
    jaccard = len(a_set & b_set) / len(a_set | b_set) if (a_set | b_set) else 0.0
    return max(jaccard, SequenceMatcher(None, a_key, b_key).ratio() * 0.95)


GENERIC_MENU_WORDS = {
    "pizza", "sushi", "cafe", "caffe", "coffee", "bar", "pub", "grill", "kitchen",
    "restaurant", "noodle", "pho", "bbq", "burger", "taco", "tea", "bakery", "bread",
    "deli", "donair", "chicken", "wok", "garden", "express", "house", "food", "cuisine",
    "bistro", "thai", "chinese", "japanese", "korean", "indian", "vietnamese", "mexican",
    "italian", "seafood", "poke", "salad", "bowl", "grill", "lounge", "diner", "eatery",
    "juice", "smoothie", "dessert", "ice", "cream", "shop", "store", "market", "concession",
}


def has_distinctive(name):
    """A "Pizza Hut" vs "Pizza Pizza" pair at one address must not merge: the shared token
    is just a menu word, not a brand."""
    tokens = {t for t in name_key(name).split() if len(t) > 1}
    return bool([t for t in tokens if t not in GENERIC_MENU_WORDS])


def contained_with_slack(a, b, slack=5):
    a_set, b_set = set(name_key(a).split()), set(name_key(b).split())
    smaller, larger = (a_set, b_set) if len(a_set) <= len(b_set) else (b_set, a_set)
    if not smaller or not smaller.issubset(larger) or len(larger) - len(smaller) > slack:
        return False
    smaller_name = a if a_set is smaller else b
    if not has_distinctive(smaller_name):
        return False
    # A one-word shorter name is only accepted when it is a brand-like word (>= 5 characters)
    # that the longer name starts with: that keeps "Nemesis" == "Nemesis Coffee Gastown" while
    # rejecting "The Main" == "MeeT on Main" (main is a street word).
    if len(smaller) == 1:
        token = next(iter(smaller))
        longer_name = name_key(b if smaller_name == a else a)
        return len(token) >= 5 and longer_name.split()[0] == token
    return True


def same_token_set(a, b):
    return set(name_key(a).split()) == set(name_key(b).split())


def metres(a, b):
    if None in (a["latitude"], a["longitude"], b["latitude"], b["longitude"]):
        return None
    mean = math.radians((a["latitude"] + b["latitude"]) / 2)
    return math.hypot((a["longitude"] - b["longitude"]) * 111320 * math.cos(mean),
                      (a["latitude"] - b["latitude"]) * 111320)


def completeness(row):
    score = 0
    if address_key(row["address"]):
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
    if row["cityLicenceStatus"]:
        score += 2
    if row["liquorServiceHours"]:
        score += 2
    if row["overtureConfidence"] is not None:
        score += 1
    return score


PROVENANCE = ["cityLicenceStatus", "cityLicenceDataDate", "liquorLicenceType", "liquorServiceHours"]

con = sqlite3.connect(str(DB))
con.row_factory = sqlite3.Row
rows = [dict(r) for r in con.execute("SELECT * FROM businesses")]
print(f"rows={len(rows)}")

buckets = {}
for row in rows:
    key = name_key(row["name"])
    if key:
        buckets.setdefault(("name", key.split()[0]), []).append(row)
    address = address_key(row["address"])
    if address:
        buckets.setdefault(("address", address), []).append(row)
    if row["latitude"] is not None:
        buckets.setdefault(("geo", round(row["latitude"], 3), round(row["longitude"], 3)), []).append(row)
        for d_lat in (-0.001, 0.001):
            for d_lon in (-0.001, 0.001):
                buckets.setdefault(("geo", round(row["latitude"] + d_lat, 3),
                                    round(row["longitude"] + d_lon, 3)), []).append(row)

pairs = []
seen = set()
for group in buckets.values():
    for i, left in enumerate(group):
        for right in group[i + 1:]:
            pair = tuple(sorted((left["id"], right["id"])))
            if pair in seen:
                continue
            seen.add(pair)
            same_address = bool(address_key(left["address"]) and address_key(left["address"]) == address_key(right["address"]))
            distance = metres(left, right)
            near = distance is not None and distance <= DISTANCE_M
            if not (same_address or near):
                continue
            score = similarity(left["name"], right["name"])
            containment = contained_with_slack(left["name"], right["name"], slack=6)
            compact = name_key(left["name"]).replace(" ", "") == name_key(right["name"]).replace(" ", "")
            # Containment is meaningful evidence on its own ("Joe Fortes" vs
            # "Joe Fortes Seafood & Chop House"), so it must not be filtered out by the
            # raw name-similarity gate.
            if score < 0.45 and not containment and not compact:
                continue
            pairs.append((left, right, score, distance, same_address, near))

merge_pairs, review_pairs = [], []
for left, right, score, distance, same_address, near in pairs:
    containment = contained_with_slack(left["name"], right["name"], slack=6)
    compact = name_key(left["name"]).replace(" ", "") == name_key(right["name"]).replace(" ", "")
    if same_address and (containment or compact or score >= 0.90):
        merge_pairs.append((left, right, score, distance, "same normalized address"))
    elif same_address and score >= 0.85 and min(len(set(name_key(left["name"]).split())),
                                                len(set(name_key(right["name"]).split()))) <= 3:
        # Short names at one address that differ only by a spelling variant, e.g.
        # "Cuhillo" / "Cuchillo" and "Cafe W" / "Caffe W".
        merge_pairs.append((left, right, score, distance, "same address, spelling variant"))
    elif near and (compact or same_token_set(left["name"], right["name"])
                   or contained_with_slack(left["name"], right["name"], slack=3)
                   or score >= 0.90):
        # "Nemesis" and "Nemesis Coffee Gastown" sit at one address 26 m apart and share a
        # name stem, so containment within 120 m is enough here.
        merge_pairs.append((left, right, score, distance, "within 120 m, equivalent names"))
    else:
        review_pairs.append((left, right, score, distance, same_address))

parent = {}


def find(node):
    parent.setdefault(node, node)
    while parent[node] != node:
        parent[node] = parent[parent[node]]
        node = parent[node]
    return node


def union(a, b):
    root_a, root_b = find(a), find(b)
    if root_a != root_b:
        parent[root_b] = root_a


for left, right, *_ in merge_pairs:
    union(left["id"], right["id"])

by_id = {row["id"]: row for row in rows}
clusters = {}
for row_id in list(parent.keys()):
    clusters.setdefault(find(row_id), []).append(by_id[row_id])

plan = []
for members in clusters.values():
    members.sort(key=lambda r: (-completeness(r), r["id"]))
    keep, drop = members[0], members[1:]
    if drop:
        plan.append((keep, drop))

print(f"merge pairs={len(merge_pairs)} clusters={len(plan)} rows_to_remove={sum(len(d) for _, d in plan)}")
print(f"pairs for review={len(review_pairs)}")
for keep, drop in plan[:20]:
    for row in drop:
        print(f"   merge {row['name'][:34]!r} -> {keep['name'][:34]!r} ({row['address'][:30]!r})")

fills, conflicts = {}, []
for keep, drop in plan:
    for row in drop:
        for field in FILLABLE + PROVENANCE:
            incoming = row[field]
            if incoming in (None, ""):
                continue
            if keep[field] in (None, ""):
                fills.setdefault(keep["id"], {})[field] = incoming
            elif field in ("dataSources", "tags"):
                continue
            elif keep[field] != incoming:
                conflicts.append({"kept_id": keep["id"], "kept_name": keep["name"], "field": field,
                                  "kept_value": keep[field], "removed_value": incoming})
        # Keep the merged-away slug as an alias so old links still resolve.
        if row["slug"] and row["slug"] != keep["slug"]:
            try:
                aliases = json.loads(keep.get(ALIAS_FIELD) or "[]")
            except Exception:
                aliases = []
            if row["slug"] not in aliases:
                aliases.append(row["slug"])
            keep[ALIAS_FIELD] = json.dumps(aliases)
            fills.setdefault(keep["id"], {})[ALIAS_FIELD] = keep[ALIAS_FIELD]
print(f"fields to fill={sum(len(v) for v in fills.values())} conflicts={len(conflicts)}")

steps = [dict(r) for r in con.execute("SELECT id, businessId FROM itinerary_steps")]
repoint = []
for keep, drop in plan:
    for row in drop:
        for step in steps:
            if step["businessId"] == row["id"]:
                repoint.append((keep["id"], step["id"]))
print(f"itinerary steps to repoint={len(repoint)}")

plan_path = DATA / f"phase6-merge-plan-{stamp}.csv"
with plan_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(["kept_id", "kept_name", "kept_address", "removed_id", "removed_name", "removed_address"])
    for keep, drop in plan:
        for row in drop:
            writer.writerow([keep["id"], keep["name"], keep["address"], row["id"], row["name"], row["address"]])
review_path = DATA / f"phase6-review-{stamp}.csv"
with review_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(["name_a", "address_a", "name_b", "address_b", "similarity", "distance_m", "same_address"])
    for left, right, score, distance, same_address in review_pairs:
        writer.writerow([left["name"], left["address"], right["name"], right["address"],
                         round(score, 3), "" if distance is None else round(distance, 1), same_address])
print(f"PLAN {plan_path.name} / REVIEW {review_path.name}")

if not APPLY:
    print("DRY RUN: no writes (pass --apply)")
    raise SystemExit(0)

backup = PRISMA / f"dev.db.backup-phase6-global-dedupe-{stamp}.db"
shutil.copy2(DB, backup)
print(f"BACKUP {backup.name}")

removed_ids = [row["id"] for _, drop in plan for row in drop]
columns = [d[0] for d in con.execute("SELECT * FROM businesses LIMIT 1").description]
archive_path = DATA / f"phase6-removed-rows-{stamp}.csv"
with archive_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(columns + ["merged_into"])
    for keep, drop in plan:
        for row in drop:
            full = con.execute("SELECT * FROM businesses WHERE id = ?", (row["id"],)).fetchone()
            writer.writerow([full[c] for c in columns] + [keep["id"]])
print(f"ARCHIVE {archive_path.name} rows={len(removed_ids)}")
conflict_path = DATA / f"phase6-conflicts-{stamp}.csv"
with conflict_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.DictWriter(fh, fieldnames=["kept_id", "kept_name", "field", "kept_value", "removed_value"])
    writer.writeheader()
    writer.writerows(conflicts)

con.execute("BEGIN")
try:
    # Backfill aliases for rows merged away in the earlier phases, so their old page links work.
    alias_updates = {}
    for pattern, slug_column, kept_column in (
            ("phase5-duplicate-removals-*.csv", None, "kept_id"),
            ("phase6-removed-rows-*.csv", "slug", "merged_into"),
            ("phase1-removed-rows-*.csv", "slug", "merged_into")):
        for path in DATA.glob(pattern):
            with path.open(encoding="utf-8") as handle:
                for entry in csv.DictReader(handle):
                    kept_id = entry.get(kept_column)
                    if not kept_id:
                        continue
                    slug = entry.get(slug_column) if slug_column else None
                    if slug is None:
                        removed_id = entry.get("removed_id")
                        row = con.execute("SELECT slug FROM businesses WHERE id = ?", (removed_id,)).fetchone()
                        slug = row[0] if row else None
                    if not slug:
                        continue
                    current = con.execute("SELECT slugAliases, slug FROM businesses WHERE id = ?",
                                          (kept_id,)).fetchone()
                    if not current or current[1] == slug:
                        continue
                    try:
                        aliases = json.loads(current[0] or "[]")
                    except Exception:
                        aliases = []
                    if slug not in aliases:
                        aliases.append(slug)
                        alias_updates[kept_id] = json.dumps(aliases)
    if alias_updates:
        con.executemany("UPDATE businesses SET slugAliases = ? WHERE id = ?",
                        [(value, key) for key, value in alias_updates.items()])
        print(f"alias backfill for {len(alias_updates)} rows")
    if repoint:
        con.executemany("UPDATE itinerary_steps SET businessId = ? WHERE id = ?", repoint)
    for keep_id, values in fills.items():
        sets = ", ".join(f"{field} = ?" for field in values)
        con.execute(f"UPDATE businesses SET {sets} WHERE id = ?", list(values.values()) + [keep_id])
    con.executemany("DELETE FROM businesses WHERE id = ?", [(row_id,) for row_id in removed_ids])
    con.commit()
except Exception:
    con.rollback()
    raise
print(f"APPLIED: merged {len(plan)} clusters, removed {len(removed_ids)} rows, filled "
      f"{sum(len(v) for v in fills.values())} fields on {len(fills)} rows")
print(json.dumps({
    "businesses": con.execute("SELECT COUNT(*) FROM businesses").fetchone()[0],
    "duplicate_slugs": con.execute("SELECT COUNT(*) FROM (SELECT slug FROM businesses GROUP BY slug HAVING COUNT(*)>1)").fetchone()[0],
    "orphan_steps": con.execute("SELECT COUNT(*) FROM itinerary_steps s LEFT JOIN businesses b ON b.id = s.businessId WHERE s.businessId IS NOT NULL AND b.id IS NULL").fetchone()[0],
    "itineraries": con.execute("SELECT COUNT(*) FROM itineraries").fetchone()[0],
    "steps": con.execute("SELECT COUNT(*) FROM itinerary_steps").fetchone()[0],
}, indent=2))
con.close()
