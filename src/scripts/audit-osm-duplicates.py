import json
import math
import re
import sqlite3
import unicodedata
from pathlib import Path

root = Path(__file__).resolve().parents[2]
db = sqlite3.connect(f"file:{(root / 'prisma' / 'dev.db').as_posix()}?mode=ro", uri=True)
backup = sqlite3.connect(f"file:{(root / 'prisma' / 'dev.db.backup-osm-20261014-151545.db').as_posix()}?mode=ro", uri=True)

def norm(text):
    text = ''.join(c for c in unicodedata.normalize('NFKD', text or '') if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]+', ' ', text.lower()).strip()

def metres(a, b):
    lat_mean = math.radians((a[3] + b[3]) / 2)
    return math.hypot((a[4] - b[4]) * 111320 * math.cos(lat_mean), (a[3] - b[3]) * 111320)

old = backup.execute('SELECT id, name, address, latitude, longitude FROM businesses').fetchall()
old_ids = {row[0] for row in old}
new = [row for row in db.execute('SELECT id, name, address, latitude, longitude FROM businesses ORDER BY id').fetchall() if row[0] not in old_ids]
old_by_name = {}
for row in old:
    old_by_name.setdefault(norm(row[1]), []).append(row)
old_collisions = []
for row in new:
    for prior in old_by_name.get(norm(row[1]), []):
        same_address = row[2] and prior[2] and norm(row[2]) == norm(prior[2])
        near = row[3] is not None and row[4] is not None and prior[3] is not None and prior[4] is not None and metres(row, prior) <= 30
        if same_address or near:
            old_collisions.append((row[0], row[1], prior[0], prior[1], round(metres(row, prior), 2) if near else None))

new_by_name = {}
for row in new:
    new_by_name.setdefault(norm(row[1]), []).append(row)
internal_collisions = []
seen = set()
for key, rows in new_by_name.items():
    for i, left in enumerate(rows):
        for right in rows[i + 1:]:
            if left[3] is None or left[4] is None or right[3] is None or right[4] is None:
                continue
            distance = metres(left, right)
            if distance <= 30:
                pair = tuple(sorted((left[0], right[0])))
                if pair not in seen:
                    seen.add(pair)
                    internal_collisions.append((left[0], left[1], right[0], right[1], round(distance, 2)))

new_ids = [row[0] for row in new]
marks = ','.join('?' for _ in new_ids)
print(json.dumps({
    'original_rows': len(old),
    'added_rows': len(new),
    'same_name_address_or_coordinates_with_original': old_collisions,
    'same_name_within_30m_among_added_rows': internal_collisions,
    'added_verification_flag_false': db.execute(f"SELECT COUNT(*) FROM businesses WHERE id IN ({marks}) AND isVerified=0", new_ids).fetchone()[0],
    'added_rating_null': db.execute(f"SELECT COUNT(*) FROM businesses WHERE id IN ({marks}) AND rating IS NULL", new_ids).fetchone()[0],
    'added_review_count_null': db.execute(f"SELECT COUNT(*) FROM businesses WHERE id IN ({marks}) AND reviewCount IS NULL", new_ids).fetchone()[0],
    'added_photos_empty': db.execute(f"SELECT COUNT(*) FROM businesses WHERE id IN ({marks}) AND photos='[]'", new_ids).fetchone()[0]
}, ensure_ascii=False, indent=2))
if old_collisions or internal_collisions:
    raise SystemExit('Duplicate audit found one or more collisions; inspect before any further import.')
