"""Phase A step 1: archive unverifiable fields to CSV, then clear them (truth-first)."""
import csv
import json
import re
import sqlite3
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "prisma" / "dev.db"
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
stamp = datetime.now().strftime("%Y%m%d-%H%M%S")

FILLER = re.compile(r"is a local spot located in", re.I)

con = sqlite3.connect(str(DB))
cur = con.cursor()

archived = cur.execute(
    "SELECT id, name, address, rating, reviewCount, priceRange, photos, isVerified, description FROM businesses"
).fetchall()

archive_path = DATA / f"phaseA-archived-unverifiable-fields-{stamp}.csv"
with archive_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(["id", "name", "address", "old_rating", "old_reviewCount", "old_priceRange",
                     "old_photos", "old_isVerified", "old_description"])
    writer.writerows(archived)
print(f"ARCHIVE {archive_path} rows={len(archived)}")

unsplash = cur.execute("SELECT COUNT(*) FROM businesses WHERE photos LIKE '%unsplash%'").fetchone()[0]
filler = cur.execute(
    "SELECT COUNT(*) FROM businesses WHERE description IS NOT NULL AND LOWER(description) LIKE '%is a local spot located in%'"
).fetchone()[0]
print(f"will_clear_photos={unsplash} will_clear_filler_descriptions={filler}")

cur.execute(
    """
    UPDATE businesses SET
      rating = NULL,
      reviewCount = NULL,
      priceRange = NULL,
      isVerified = 0,
      photos = CASE WHEN photos LIKE '%unsplash%' THEN '[]' ELSE photos END,
      description = CASE
        WHEN description IS NOT NULL AND LOWER(description) LIKE '%is a local spot located in%' THEN NULL
        ELSE description END
    """
)
con.commit()
print(f"rows_touched={cur.rowcount}")

check = cur.execute(
    "SELECT COUNT(*), SUM(rating IS NULL), SUM(reviewCount IS NULL), SUM(priceRange IS NULL), "
    "SUM(isVerified = 1), SUM(photos LIKE '%unsplash%'), "
    "SUM(description IS NOT NULL AND LOWER(description) LIKE '%is a local spot located in%') FROM businesses"
).fetchone()
print("POST total=%s rating_null=%s review_null=%s price_null=%s verified_true=%s unsplash=%s filler=%s" % check)
con.close()
