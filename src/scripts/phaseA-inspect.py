"""Phase A inspection: classify rows before making any truth changes. Read-only."""
import json
import re
import shutil
import sqlite3
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PRISMA = ROOT / "prisma"
DB = PRISMA / "dev.db"
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)

stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
backup = PRISMA / f"dev.db.backup-phaseA-{stamp}.db"
if not backup.exists():
    shutil.copy2(DB, backup)
print(f"BACKUP {backup}")

con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
cur = con.execute(
    "SELECT id, name, slug, category, primaryCategory, address, phone, website, hours, priceRange, "
    "rating, reviewCount, photos, description, isVerified, latitude, longitude, neighborhoodId FROM businesses"
)
rows = cur.fetchall()
cols = [d[0] for d in cur.description]
records = [dict(zip(cols, r)) for r in rows]

osm = [r for r in records if r["id"].startswith("osm-")]
hand = [r for r in records if not r["id"].startswith("osm-")]
print(f"total={len(records)} osm_like_ids={len(osm)} non_osm_ids={len(hand)}")
print("non_osm sample:", [r["id"] for r in hand[:5]])
print("verified_true=", sum(1 for r in records if r["isVerified"]))
print("verified_true_non_osm=", sum(1 for r in hand if r["isVerified"]))
print("verified_true_osm=", sum(1 for r in osm if r["isVerified"]))
print("with_rating=", sum(1 for r in records if r["rating"] is not None))
print("with_review_count=", sum(1 for r in records if r["reviewCount"] is not None))
print("with_price=", sum(1 for r in records if r["priceRange"]))
print("with_hours=", sum(1 for r in records if r["hours"]))
print("photos_empty=", sum(1 for r in records if r["photos"] in ("[]", "", None)))
photo_counter = Counter()
for r in records:
    try:
        urls = json.loads(r["photos"] or "[]")
    except Exception:
        urls = []
    for u in set(urls):
        photo_counter[u] += 1
print("distinct_photo_urls=", len(photo_counter), "most_common=", photo_counter.most_common(5))
print("unsplash_rows=", sum(1 for r in records if "unsplash" in (r["photos"] or "")))
filler = re.compile(r"is a local spot located in", re.I)
print("filler_descriptions=", sum(1 for r in records if r["description"] and filler.search(r["description"])))
print("null_descriptions=", sum(1 for r in records if not r["description"]))
print("category_values=", Counter(r["category"] for r in records).most_common())
print("primary_category_top=", Counter(r["primaryCategory"] for r in records).most_common(15))
slug_counter = Counter(r["slug"] for r in records)
print("duplicate_slug_groups=", sum(1 for s, c in slug_counter.items() if c > 1))
print("slug_null=", sum(1 for r in records if not r["slug"]))
