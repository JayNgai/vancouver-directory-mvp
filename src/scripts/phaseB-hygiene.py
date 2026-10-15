"""Phase B hygiene: de-duplicate, repoint itinerary steps, unique slugs, controlled categories.

Dry run by default; pass --apply to write. Always takes its own backup first.
Add-only is NOT the rule here: Phase B removes duplicate rows by explicit instruction,
archiving each removed row to CSV and repointing itinerary steps to the row that is kept.
"""
import csv
import json
import re
import shutil
import sqlite3
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PRISMA = ROOT / "prisma"
DB = PRISMA / "dev.db"
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
APPLY = "--apply" in sys.argv
stamp = datetime.now().strftime("%Y%m%d-%H%M%S")

CONTROLLED = "Restaurant, Cafe, Bar / Pub, Bakery, Dessert, Fast Food, Other"


def norm_name(value):
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(c for c in value if not unicodedata.combining(c))
    value = value.lower()
    value = re.sub(r"\b(inc|ltd|the)\b", " ", value)
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def norm_address(value):
    value = unicodedata.normalize("NFKD", value or "").lower()
    value = re.sub(r"\bvancouver\b", " ", value)
    value = re.sub(r"\bbc\b", " ", value)
    value = re.sub(r"\bv\d[a-z]\s*\d[a-z]\d\b", " ", value)  # postal codes
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def has_street_number(value):
    return bool(re.match(r"\s*\d+[a-z]?\s+\S", value or ""))


def coords(row):
    return row["latitude"], row["longitude"]


def has_coords(row):
    return row["latitude"] is not None and row["longitude"] is not None


def metres(a, b):
    import math
    if not has_coords(a) or not has_coords(b):
        return None
    lat_mean = math.radians((a["latitude"] + b["latitude"]) / 2)
    return math.hypot(
        (a["longitude"] - b["longitude"]) * 111320 * math.cos(lat_mean),
        (a["latitude"] - b["latitude"]) * 111320,
    )


def completeness(row):
    """Higher is better: how much real listing data the row carries."""
    score = 0
    if has_street_number(row["address"]):
        score += 4
    if row["phone"]:
        score += 3
    if row["website"]:
        score += 3
    if row["hours"]:
        score += 2
    if row["description"]:
        score += 1
    if has_coords(row):
        score += 1
    try:
        if json.loads(row["photos"] or "[]"):
            score += 1
    except Exception:
        pass
    return score


def controlled_category(row):
    """Map to the short controlled list; cuisine detail is preserved in tags separately.

    The venue *type* decides the category. Free-text feature tags (e.g. a cafe tagged
    'bakery' for its pastries) must not reclassify the venue.
    """
    primary = (row["primaryCategory"] or "").strip().lower()
    category = (row["category"] or "").strip().lower()
    kind = primary or category
    if kind in ("bakery", "confectionery", "patisserie", "pastry", "bakeries"):
        return "Bakery"
    if kind in ("fast food", "food court", "fast_food"):
        return "Fast Food"
    if kind in ("ice cream", "ice_cream", "dessert", "desserts", "gelato"):
        return "Dessert"
    if kind in ("coffee shop", "coffee_shop", "cafe", "coffee", "internet cafe", "internet_cafe"):
        return "Cafe"
    if kind in ("bar", "pub", "biergarten", "bar / pub", "brewery", "cocktail bar"):
        return "Bar / Pub"
    if kind in ("restaurant", "diner", "bistro", "food", "deli"):
        return "Restaurant"
    if kind in ("attraction", "market", "museum", "gallery", "public_bookcase", "other"):
        return "Other"
    # Anything else is a cuisine name (japanese, pizza, vietnamese, ...) -> use the venue type.
    if category in ("bakery", "confectionery"):
        return "Bakery"
    if category in ("cafe",):
        return "Cafe"
    if category in ("bar", "pub"):
        return "Bar / Pub"
    if category in ("dessert", "ice_cream"):
        return "Dessert"
    if category in ("restaurant",):
        return "Restaurant"
    return "Other"


def cuisine_token(row):
    """Return a cuisine tag to preserve when primaryCategory held cuisine detail."""
    primary = (row["primaryCategory"] or "").strip().lower().replace(" ", "-")
    if not primary:
        return None
    if primary in ("restaurant", "cafe", "bar", "pub", "dessert", "other", "attraction",
                   "fast-food", "food-court", "bakery", "ice-cream", "coffee-shop", "deli",
                   "confectionery", "market"):
        return None
    if primary in ("coffee_shop", "internet_cafe"):
        return None
    return f"cuisine-{primary}"


if not APPLY:
    print("DRY RUN (pass --apply to write)")

backup = PRISMA / f"dev.db.backup-phaseB-{stamp}.db"
if APPLY:
    shutil.copy2(DB, backup)
    print(f"BACKUP {backup.name}")

con = sqlite3.connect(str(DB))
con.row_factory = sqlite3.Row
rows = [dict(r) for r in con.execute(
    "SELECT id, name, slug, category, primaryCategory, tags, address, latitude, longitude, "
    "phone, website, hours, photos, description, neighborhoodId, isVerified FROM businesses")]
steps = [dict(r) for r in con.execute(
    "SELECT id, itineraryId, \"order\", businessId FROM itinerary_steps ORDER BY itineraryId, \"order\"")]
print(f"before: businesses={len(rows)} steps={len(steps)}")

# ---- 1. duplicate detection -------------------------------------------------
by_name = defaultdict(list)
for row in rows:
    by_name[norm_name(row["name"])].append(row)

removed = {}
kept_for = {}
groups = []
for name, group in by_name.items():
    if len(group) < 2:
        continue
    parent = {row["id"]: row["id"] for row in group}

    def find(x):
        while parent[x] != x:
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i, left in enumerate(group):
        for right in group[i + 1:]:
            same_address = (
                has_street_number(left["address"]) and has_street_number(right["address"])
                and norm_address(left["address"]) == norm_address(right["address"])
            )
            close = metres(left, right)
            same_spot = close is not None and close <= 30
            if same_address or same_spot:
                union(left["id"], right["id"])

    clusters = defaultdict(list)
    for row in group:
        clusters[find(row["id"])].append(row)
    for cluster in clusters.values():
        if len(cluster) < 2:
            continue
        cluster.sort(key=lambda r: (-completeness(r), r["id"]))
        keep = cluster[0]
        drop = cluster[1:]
        for row in drop:
            removed[row["id"]] = row
            kept_for[row["id"]] = keep["id"]
        groups.append({"name": name, "kept": keep, "dropped": drop,
                       "reason": "same name + same address or within 30m"})

name_only = [g for g in groups if False]
# Report same-name groups that were NOT merged, so nothing hides.
merged_names = {g["name"] for g in groups}
unmerged = []
for name, group in by_name.items():
    if len(group) < 2 or name in merged_names:
        continue
    distinct = {(norm_address(r["address"]), r["latitude"], r["longitude"]) for r in group}
    unmerged.append((name, len(group), len(distinct)))
print(f"duplicate clusters={len(groups)} rows_to_remove={len(removed)}")
print(f"same-name groups left alone (addresses/coords differ)={len(unmerged)}")
for name, total, distinct in sorted(unmerged)[:10]:
    print(f"   kept-separate: {name} x{total} ({distinct} distinct addresses)")

# ---- 2. itinerary step repointing -------------------------------------------
repoint = [(kept_for[s["businessId"]], s["id"]) for s in steps if s["businessId"] in kept_for]
print(f"itinerary steps to repoint={len(repoint)}")
affected_itineraries = Counter(s["itineraryId"] for s in steps if s["businessId"] in kept_for)

# ---- 3. slug uniqueness ------------------------------------------------------
neighborhood_slug = {r["id"]: r["slug"] for r in con.execute("SELECT id, slug FROM neighborhoods")}
slug_changes = []
seen = defaultdict(list)
for row in rows:
    if row["id"] in removed:
        continue
    seen[row["slug"] or ""].append(row)
for slug, group in seen.items():
    if len(group) < 2:
        continue
    for row in sorted(group, key=lambda r: r["id"]):
        hood = neighborhood_slug.get(row["neighborhoodId"], "vancouver")
        candidate = f"{slug}-{hood}"
        slug_changes.append((candidate, row["id"], slug, hood))
        for attempt in range(2, 20):
            if candidate not in seen and all(c[0] != candidate for c in slug_changes):
                break
            candidate = f"{slug}-{hood}-{attempt}"
        slug_changes[-1] = (candidate, row["id"], slug, hood)
print(f"slug updates for duplicate groups={len(slug_changes)}")

# ---- 4. category normalisation ----------------------------------------------
category_changes = []
tag_additions = []
for row in rows:
    if row["id"] in removed:
        continue
    target = controlled_category(row)
    try:
        tags = json.loads(row["tags"] or "[]")
    except Exception:
        tags = []
    cuisines = [t for t in tags if str(t).startswith("cuisine-")]
    cuisine = cuisine_token(row)
    new_tags = list(tags)
    if cuisine and cuisine not in new_tags and not cuisines:
        new_tags.append(cuisine)
    if new_tags != tags:
        tag_additions.append((json.dumps(new_tags), row["id"]))
    if target != row["category"] or target != row["primaryCategory"]:
        category_changes.append((target, row["id"], row["category"], row["primaryCategory"]))
print(f"category updates={len(category_changes)} tag updates={len(tag_additions)}")
print("target categories:", Counter(c[0] for c in category_changes).most_common())

# ---- report ------------------------------------------------------------------
report_path = DATA / f"phaseB-dedupe-plan-{stamp}.csv"
with report_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(["kept_id", "kept_name", "kept_address", "removed_id", "removed_name",
                     "removed_address", "distance_m", "reason"])
    for group in groups:
        for row in group["dropped"]:
            distance = metres(group["kept"], row)
            writer.writerow([group["kept"]["id"], group["kept"]["name"], group["kept"]["address"],
                             row["id"], row["name"], row["address"],
                             "" if distance is None else round(distance, 1), group["reason"]])
print(f"PLAN {report_path.name}")

if not APPLY:
    print("dry run complete: no writes")
    con.close()
    raise SystemExit(0)

# ---- apply -------------------------------------------------------------------
removed_path = DATA / f"phaseB-removed-rows-{stamp}.csv"
columns = [d[0] for d in con.execute("SELECT * FROM businesses LIMIT 1").description]
with removed_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(columns)
    for row in removed.values():
        full = con.execute("SELECT * FROM businesses WHERE id = ?", (row["id"],)).fetchone()
        writer.writerow([full[c] for c in columns])
print(f"ARCHIVE removed rows {removed_path.name} rows={len(removed)}")

con.execute("BEGIN")
try:
    if repoint:
        con.executemany("UPDATE itinerary_steps SET businessId = ? WHERE id = ?", repoint)
    if slug_changes:
        con.executemany("UPDATE businesses SET slug = ? WHERE id = ?", [(s[0], s[1]) for s in slug_changes])
    con.executemany("UPDATE businesses SET tags = ? WHERE id = ?", tag_additions)
    con.executemany("UPDATE businesses SET category = ?, primaryCategory = ? WHERE id = ?",
                    [(c[0], c[0], c[1]) for c in category_changes])
    con.executemany("DELETE FROM businesses WHERE id = ?", [(rid,) for rid in removed])
    con.commit()
except Exception:
    con.rollback()
    raise
print(f"repointed={len(repoint)} slug_updates={len(slug_changes)} tag_updates={len(tag_additions)} "
      f"category_updates={len(category_changes)} deleted={len(removed)}")

# ---- verify ------------------------------------------------------------------
final = con.execute("SELECT COUNT(*) FROM businesses").fetchone()[0]
itin = con.execute("SELECT COUNT(*) FROM itineraries").fetchone()[0]
step_count = con.execute("SELECT COUNT(*) FROM itinerary_steps").fetchone()[0]
orphans = con.execute(
    "SELECT COUNT(*) FROM itinerary_steps s LEFT JOIN businesses b ON b.id = s.businessId "
    "WHERE s.businessId IS NOT NULL AND b.id IS NULL").fetchone()[0]
unresolved = con.execute(
    "SELECT COUNT(*) FROM itinerary_steps WHERE businessId IS NULL").fetchone()[0]
dupe_slugs = con.execute(
    "SELECT COUNT(*) FROM (SELECT slug FROM businesses GROUP BY slug HAVING COUNT(*) > 1)").fetchone()[0]
cats = [tuple(row) for row in con.execute(
    "SELECT category, COUNT(*) FROM businesses GROUP BY category ORDER BY 2 DESC").fetchall()]
print(json.dumps({
    "businesses": final, "itineraries": itin, "itinerary_steps": step_count,
    "orphan_steps": orphans, "steps_without_business": unresolved, "duplicate_slug_groups": dupe_slugs,
    "categories": cats,
}, indent=2))
print("CONTROLLED LIST:", CONTROLLED)
con.close()
