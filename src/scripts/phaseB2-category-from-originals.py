"""Final category normalisation from the ORIGINAL venue type.

Why a second pass: the first normalisation pass also overwrote primaryCategory with the
controlled label, so the original type has to be read from the pre-truth snapshots:
  - prisma/dev.db.backup-phaseA-<stamp>.db   -> original type for the pre-Phase-C rows
  - prisma/dev.db.backup-phaseB-20261014-153638.db -> original type for the Phase C rows
    (that snapshot was taken after the Phase C import and before any normalisation)

Dry run unless --apply.
"""
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PRISMA = ROOT / "prisma"
DB = PRISMA / "dev.db"
APPLY = "--apply" in sys.argv
CONTROLLED = ('Restaurant', 'Cafe', 'Bar / Pub', 'Bakery', 'Dessert', 'Fast Food', 'Other')


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
    generic = {
        "restaurant", "cafe", "bar", "pub", "dessert", "other", "attraction", "fast-food",
        "food-court", "bakery", "ice-cream", "coffee-shop", "deli", "confectionery",
        "market", "coffee_shop", "internet_cafe", "bar-/pub", "food", "diner", "bistro",
        "specialty-coffee", "pub-&-patio", "aburi-sushi", "japanese-izakaya", "seafood",
        "brunch", "cafe-brunch", "italian", "french", "steakhouse", "sushi", "ice-cream",
    }
    if not token or token in generic:
        return None
    return f"cuisine-{token}"


def load(path):
    con = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    return {r[0]: (r[1], r[2]) for r in con.execute("SELECT id, category, primaryCategory FROM businesses")}


pre_c = load(sorted(PRISMA.glob("dev.db.backup-phaseA-*.db"))[0])
post_c = load(PRISMA / "dev.db.backup-phaseB-20261014-153638.db")

live = sqlite3.connect(str(DB))
live_state = {r[0]: (r[1], r[2], r[3]) for r in live.execute(
    "SELECT id, category, primaryCategory, tags FROM businesses")}

changes = []
tag_changes = []
unresolved = []
for row_id, (live_cat, live_primary, live_tags) in live_state.items():
    origin = pre_c.get(row_id) or post_c.get(row_id)
    if origin is None:
        unresolved.append(row_id)
        continue
    target = controlled_category(*origin)
    if target != live_cat or target != live_primary:
        changes.append((target, row_id, live_cat, live_primary, target))
    token = cuisine_token(origin[1])
    try:
        parsed = json.loads(live_tags or "[]")
    except Exception:
        parsed = []
    if token and not any(str(t).startswith("cuisine-") for t in parsed):
        parsed.append(token)
        tag_changes.append((json.dumps(parsed), row_id))

print(f"rows from phaseA snapshot={len(pre_c)} phaseB(post-C) snapshot={len(post_c)} live={len(live_state)}")
print(f"unresolved rows (no original type available)={len(unresolved)}")
print(f"category corrections={len(changes)} cuisine tag additions={len(tag_changes)}")
for change in changes[:25]:
    print(f"   {change[1][:14]}…  {change[2]}/{change[3]} -> {change[4]}")

if APPLY:
    live.executemany("UPDATE businesses SET category = ?, primaryCategory = ? WHERE id = ?",
                     [(c, c, i) for c, i, *_ in changes])
    live.executemany("UPDATE businesses SET tags = ? WHERE id = ?", tag_changes)
    live.commit()
    print("applied")
    print("final categories:", live.execute(
        "SELECT category, COUNT(*) FROM businesses GROUP BY category ORDER BY 2 DESC").fetchall())
    bad = live.execute(
        "SELECT COUNT(*) FROM businesses WHERE category NOT IN (?,?,?,?,?,?,?)", CONTROLLED).fetchone()[0]
    print("outside controlled list:", bad)
else:
    print("DRY RUN: no writes (pass --apply)")
