"""Recompute the controlled category from the ORIGINAL venue type (post-Phase-C snapshot)
and apply it, so a venue is never reclassified by a free-text feature tag.

Source of truth: prisma/dev.db.backup-phaseB-20261014-153638.db (taken after Phase C import,
before any category normalisation). Dry run unless --apply.
"""
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "prisma" / "dev.db"
SOURCE = ROOT / "prisma" / "dev.db.backup-phaseB-20261014-153638.db"
APPLY = "--apply" in sys.argv


def controlled_category(category, primary):
    primary = (primary or "").strip().lower()
    category = (category or "").strip().lower()
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


def cuisine_token(primary):
    token = (primary or "").strip().lower().replace(" ", "-")
    if not token:
        return None
    generic = {
        "restaurant", "cafe", "bar", "pub", "dessert", "other", "attraction", "fast-food",
        "food-court", "bakery", "ice-cream", "coffee-shop", "deli", "confectionery",
        "market", "coffee_shop", "internet_cafe", "bar-/pub", "food", "diner", "bistro",
    }
    if token in generic:
        return None
    return f"cuisine-{token}"


source = sqlite3.connect(f"file:{SOURCE.as_posix()}?mode=ro", uri=True)
live = sqlite3.connect(str(DB))
rows = source.execute("SELECT id, category, primaryCategory, tags FROM businesses").fetchall()
live_state = {r[0]: (r[1], r[2], r[3]) for r in live.execute(
    "SELECT id, category, primaryCategory, tags FROM businesses")}

category_changes = []
tag_changes = []
for row_id, category, primary, tags in rows:
    if row_id not in live_state:
        continue  # row was removed by dedupe
    live_category, live_primary, live_tags = live_state[row_id]
    target = controlled_category(category, primary)
    if target != live_category or target != live_primary:
        category_changes.append((target, row_id))
    try:
        parsed = json.loads(live_tags or "[]")
    except Exception:
        parsed = []
    token = cuisine_token(primary)
    if token and token not in parsed and not any(str(t).startswith("cuisine-") for t in parsed):
        parsed.append(token)
        tag_changes.append((json.dumps(parsed), row_id))

print(f"source rows={len(rows)} live rows={len(live_state)}")
print(f"category changes={len(category_changes)} tag changes={len(tag_changes)}")
check = live.execute(
    "SELECT COUNT(*) FROM businesses WHERE category NOT IN "
    "('Restaurant','Cafe','Bar / Pub','Bakery','Dessert','Fast Food','Other')").fetchone()[0]
print(f"rows currently outside the controlled list={check}")

if APPLY:
    live.executemany("UPDATE businesses SET category = ?, primaryCategory = ? WHERE id = ?",
                     [(c, c, i) for c, i in category_changes])
    live.executemany("UPDATE businesses SET tags = ? WHERE id = ?", tag_changes)
    live.commit()
    print("applied")
    print("final:", live.execute(
        "SELECT category, COUNT(*) FROM businesses GROUP BY category ORDER BY 2 DESC").fetchall())
    print("outside controlled list now:", live.execute(
        "SELECT COUNT(*) FROM businesses WHERE category NOT IN "
        "('Restaurant','Cafe','Bar / Pub','Bakery','Dessert','Fast Food','Other')").fetchone()[0])
    print("spurious Bakery check (Bakery rows whose type was cafe/coffee):", live.execute(
        "SELECT COUNT(*) FROM businesses WHERE category='Bakery' AND primaryCategory='Bakery' "
        "AND tags LIKE '%coffee%'").fetchone()[0])
else:
    print("DRY RUN: no writes (pass --apply)")
