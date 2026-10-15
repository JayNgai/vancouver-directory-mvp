import json
import sqlite3
from pathlib import Path
from urllib.parse import quote

root = Path(__file__).resolve().parents[2]
db_path = root / "prisma" / "dev.db"
backup_path = root / "prisma" / "dev.db.backup-osm-20261014-151545.db"

def open_readonly(path):
    uri = "file:" + quote(path.as_posix(), safe="/:.") + "?mode=ro"
    return sqlite3.connect(uri, uri=True)

old = open_readonly(backup_path)
new = open_readonly(db_path)
checks = {}
for table in ("neighborhoods", "businesses", "itineraries", "itinerary_steps"):
    old_columns = [row[1] for row in old.execute(f'PRAGMA table_info("{table}")')]
    new_columns = [row[1] for row in new.execute(f'PRAGMA table_info("{table}")')]
    if old_columns != new_columns:
        raise RuntimeError(f"Schema changed for {table}: backup={old_columns}, current={new_columns}")
    columns = ",".join('"' + name + '"' for name in old_columns)
    original_rows = old.execute(f'SELECT {columns} FROM "{table}" ORDER BY id').fetchall()
    current_rows = new.execute(f'SELECT {columns} FROM "{table}" ORDER BY id').fetchall()
    if table == "businesses":
        # Filter to the original business IDs, while allowing additional OSM records.
        original_ids = {row[0] for row in original_rows}
        current_original_rows = [row for row in current_rows if row[0] in original_ids]
    else:
        current_original_rows = current_rows
    checks[table] = {
        "backup_rows": len(original_rows),
        "current_original_id_rows": len(current_original_rows),
        "identical": original_rows == current_original_rows,
    }
    print(f"UNCHANGED {table}: {json.dumps(checks[table])}")

if not all(result["identical"] and result["backup_rows"] == result["current_original_id_rows"] for result in checks.values()):
    raise SystemExit("FAIL: original records differ from backup")

before_counts = dict(old.execute("SELECT n.name, COUNT(b.id) FROM neighborhoods n LEFT JOIN businesses b ON b.neighborhoodId=n.id GROUP BY n.id ORDER BY n.name"))
after_counts = dict(new.execute("SELECT n.name, COUNT(b.id) FROM neighborhoods n LEFT JOIN businesses b ON b.neighborhoodId=n.id GROUP BY n.id ORDER BY n.name"))
print("BEFORE_AFTER_COUNTS:")
for name in sorted(after_counts):
    print(f"{name}: {before_counts.get(name, 0)} -> {after_counts[name]}")
print(f"TOTALS: neighborhoods={new.execute('SELECT COUNT(*) FROM neighborhoods').fetchone()[0]}, businesses={new.execute('SELECT COUNT(*) FROM businesses').fetchone()[0]}, itineraries={new.execute('SELECT COUNT(*) FROM itineraries').fetchone()[0]}, steps={new.execute('SELECT COUNT(*) FROM itinerary_steps').fetchone()[0]}")
print("ALL_ORIGINAL_ROWS_INTACT=true")
