"""List the 111 previously isVerified rows (from the Phase A archive) for verification work."""
import csv
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
archive = sorted(DATA.glob("phaseA-archived-unverifiable-fields-*.csv"))[-1]
print("archive:", archive)

rows = list(csv.DictReader(archive.open(encoding="utf-8")))
flagged = [r for r in rows if r["old_isVerified"] == "1"]
print("flagged count:", len(flagged))

con = sqlite3.connect(f"file:{(ROOT / 'prisma' / 'dev.db').as_posix()}?mode=ro", uri=True)
live = {r[0]: r for r in con.execute(
    "SELECT id, name, address, phone, website, hours, category, primaryCategory, tags FROM businesses")}
for r in flagged:
    row = live.get(r["id"])
    if row:
        print(" | ".join(str(x) for x in (row[0], row[1], row[2], row[3], row[4], row[5], row[6])))
    else:
        print("MISSING", r["id"], r["name"])
print("count with website:", sum(1 for r in flagged if live.get(r["id"]) and live[r["id"]][4]))
print("count with phone:", sum(1 for r in flagged if live.get(r["id"]) and live[r["id"]][3]))
