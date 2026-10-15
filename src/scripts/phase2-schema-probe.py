"""Inspect the Overture Places schema for the latest release (column names change between releases)."""
import json
import tempfile
from pathlib import Path

CACHE = Path(tempfile.gettempdir()) / "vancouver-directory-source-cache"
releases = json.loads((CACHE / "overture-releases.json").read_text(encoding="utf-8"))
release = releases[-1]
print("release:", release)
path = f"s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*.parquet"

import duckdb
con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs;")
columns = con.execute(f"DESCRIBE SELECT * FROM read_parquet('{path}') LIMIT 1").fetchall()
print("columns:", [c[0] for c in columns])
for name in ("categories", "taxonomy", "basic_category"):
    present = any(c[0] == name for c in columns)
    print(f"{name}: {'present' if present else 'absent'}")
