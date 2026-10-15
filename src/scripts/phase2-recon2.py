"""PHASE 2b - recon follow-up: find the latest Overture release and probe Places via DuckDB."""
import json
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

CACHE = Path(tempfile.gettempdir()) / "vancouver-directory-source-cache"
CACHE.mkdir(parents=True, exist_ok=True)
UA = "VancouverDirectoryMVP/1.0 (local directory enrichment; contact: local development)"
BBOX = "bbox.xmin BETWEEN -123.28 AND -123.00 AND bbox.ymin BETWEEN 49.19 AND 49.34"

request = urllib.request.Request(
    "https://overturemaps-us-west-2.s3.amazonaws.com/?list-type=2&prefix=release/&delimiter=/",
    headers={"User-Agent": UA})
raw = urllib.request.urlopen(request, timeout=60).read().decode("utf-8", "replace")
root = ET.fromstring(raw)
ns = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
releases = [node.text.split("/")[-2] for node in root.findall(".//s3:CommonPrefixes/s3:Prefix", ns)]
print("releases found:", len(releases), "latest:", releases[-3:])
(CACHE / "overture-releases.json").write_text(json.dumps(releases), encoding="utf-8")

import duckdb
con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs;")

for release in reversed(releases[-4:]):
    path = f"s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*.parquet"
    try:
        count = con.execute(f"SELECT count(*) FROM read_parquet('{path}') WHERE {BBOX}").fetchone()[0]
        print(f"{release}: Vancouver bbox places = {count}")
        (CACHE / "overture-release.txt").write_text(release, encoding="utf-8")
        sample = con.execute(
            f"SELECT names.primary, categories.primary, confidence, "
            f"addresses[1].freeform, addresses[1].locality, phones[1], websites[1] "
            f"FROM read_parquet('{path}') WHERE {BBOX} AND categories.primary IS NOT NULL LIMIT 5"
        ).fetchall()
        for row in sample:
            print("  sample:", row)
        break
    except Exception as error:
        print(f"{release}: failed - {type(error).__name__}: {str(error)[:160]}")
