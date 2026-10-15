"""Export the rows added by the Phase C OSM fill so the addition is reversible.

No pre-Phase-C snapshot exists, so this id list is the documented rollback handle.
Selection: rows created at or after the Phase C apply start, restricted to the ten
Phase C target neighbourhoods and OSM-sourced ids.
"""
import csv
import sqlite3
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "prisma" / "dev.db"
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
PHASE_C_START = datetime(2026, 10, 14, 15, 34, 0)
threshold_ms = int(PHASE_C_START.timestamp() * 1000)

targets = ['chinatown', 'kerrisdale', 'coal-harbour', 'mount-pleasant', 'south-granville',
           'fairview', 'false-creek', 'point-grey', 'victoria-fraserview', 'renfrew-collingwood']

con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
rows = [dict(r) for r in con.execute(
    f"""
    SELECT b.id, b.name, b.address, b.category, b.createdAt, n.slug AS neighborhood
    FROM businesses b
    JOIN neighborhoods n ON n.id = b.neighborhoodId
    WHERE n.slug IN ({','.join('?' * len(targets))})
      AND b.id LIKE 'osm-%'
      AND CAST(b.createdAt AS INTEGER) >= ?
    ORDER BY n.slug, b.name
    """, targets + [threshold_ms])]

out = DATA / f"phaseC-added-rows-{stamp}.csv"
with out.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.DictWriter(fh, fieldnames=["id", "name", "address", "category", "createdAt", "neighborhood"])
    writer.writeheader()
    writer.writerows(rows)
print(f"threshold_ms={threshold_ms} rows={len(rows)}")
print(f"CSV {out}")
print("per neighbourhood:", {t: sum(1 for r in rows if r["neighborhood"] == t) for t in targets})
