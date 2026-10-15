"""PHASE 7 - clean up the slug aliases Alfred flagged.

An alias is only valid when NO live row owns that slug. The backfill re-read older archive
CSVs, so 15 aliases ended up pointing at a slug that a live venue still owns (for example
"Sushi Star" carrying "sushi-jin-3c57337f", which belongs to the live "Sushi Jin" at the same
address). The live page must always win.

This removes any alias that collides with a live primary slug, drops duplicates and drops a
row's own slug from its alias list. Dry run unless --apply.
"""
import csv
import json
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PRISMA = ROOT / "prisma"
DB = PRISMA / "dev.db"
DATA = ROOT / "data"
APPLY = "--apply" in sys.argv
stamp = datetime.now().strftime("%Y%m%d-%H%M%S")

con = sqlite3.connect(str(DB))
con.row_factory = sqlite3.Row
rows = [dict(r) for r in con.execute("SELECT id, name, slug, slugAliases FROM businesses")]
primary = {row["slug"]: row for row in rows if row["slug"]}

changes, collisions = [], []
for row in rows:
    if not row["slugAliases"]:
        continue
    try:
        aliases = json.loads(row["slugAliases"])
    except Exception:
        aliases = []
    kept = []
    for alias in aliases:
        if alias == row["slug"]:
            continue
        owner = primary.get(alias)
        if owner and owner["id"] != row["id"]:
            collisions.append((row["name"], row["id"], alias, owner["name"], owner["id"]))
            continue
        if alias not in kept:
            kept.append(alias)
    if kept != aliases:
        changes.append((json.dumps(kept) if kept else None, row["id"]))

print(f"rows with aliases={sum(1 for r in rows if r['slugAliases'])} "
      f"aliases dropped={len(collisions)} rows updated={len(changes)}")
for item in collisions:
    print(f"   drop {item[2]!r} from {item[0]!r} (owned by live {item[3]!r})")

report = DATA / f"phase7-alias-cleanup-{stamp}.csv"
with report.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(["alias_holder", "holder_id", "dropped_alias", "live_owner", "live_owner_id"])
    writer.writerows(collisions)
print(f"REPORT {report.name}")

if not APPLY:
    print("DRY RUN: no writes (pass --apply)")
    raise SystemExit(0)

backup = PRISMA / f"dev.db.backup-phase7-alias-cleanup-{stamp}.db"
shutil.copy2(DB, backup)
print(f"BACKUP {backup.name}")

con.executemany("UPDATE businesses SET slugAliases = ? WHERE id = ?", changes)
con.commit()

remaining = [dict(r) for r in con.execute("SELECT id, name, slug, slugAliases FROM businesses")]
live_slugs = {r["slug"]: r["id"] for r in remaining if r["slug"]}
bad = 0
total = 0
for row in remaining:
    if not row["slugAliases"]:
        continue
    for alias in json.loads(row["slugAliases"]):
        total += 1
        owner = live_slugs.get(alias)
        if owner and owner != row["id"]:
            bad += 1
print(json.dumps({
    "aliases_now": total,
    "aliases_colliding_with_a_live_slug": bad,
    "rows_with_aliases": sum(1 for r in remaining if r["slugAliases"]),
    "businesses": len(remaining),
}, indent=1))
con.close()
