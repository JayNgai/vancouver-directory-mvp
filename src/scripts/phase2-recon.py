"""PHASE 2a - recon: confirm Overture Places is reachable through DuckDB and check the
City of Vancouver business-licence API field names. Read-only; writes only into the local
cache directory.
"""
import json
import os
import tempfile
import urllib.request
from pathlib import Path

CACHE = Path(tempfile.gettempdir()) / "vancouver-directory-source-cache"
CACHE.mkdir(parents=True, exist_ok=True)
UA = "VancouverDirectoryMVP/1.0 (local directory enrichment; contact: local development)"


def fetch_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


print("--- City of Vancouver business licences: one record ---")
data = fetch_json("https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/"
                  "business-licences/records?limit=1")
print("total_count:", data.get("total_count"))
if data.get("results"):
    print(json.dumps(data["results"][0], indent=1, ensure_ascii=False)[:1500])

print("--- Overture release listing ---")
try:
    listing = fetch_json("https://overturemaps-us-west-2.s3.amazonaws.com/?list-type=2&prefix=release/&delimiter=/")
    prefixes = [p["Prefix"] for p in listing.get("CommonPrefixes", [])]
    print("releases:", prefixes[-6:])
except Exception as error:
    print("listing failed:", type(error).__name__, error)

print("--- DuckDB Overture probe ---")
import duckdb
con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs;")
releases = [p.rstrip("/").split("/")[-1] for p in prefixes] if 'prefixes' in dir() else []
for release in reversed(releases[-3:]):
    try:
        path = (f"s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*.parquet")
        row = con.execute(
            f"SELECT count(*) AS n FROM read_parquet('{path}') "
            "WHERE bbox.xmin BETWEEN -123.28 AND -123.00 AND bbox.ymin BETWEEN 49.19 AND 49.34"
        ).fetchone()
        print(f"{release}: places rows in Vancouver bbox = {row[0]}")
        (CACHE / "overture-release.txt").write_text(release, encoding="utf-8")
        sample = con.execute(
            f"SELECT id, names.primary, categories.primary, confidence, "
            f"addresses[1].freeform, addresses[1].locality, phones[1], websites[1] "
            f"FROM read_parquet('{path}') "
            "WHERE bbox.xmin BETWEEN -123.28 AND -123.00 AND bbox.ymin BETWEEN 49.19 AND 49.34 "
            "AND categories.primary IS NOT NULL LIMIT 3"
        ).fetchall()
        for s in sample:
            print("  sample:", s)
        break
    except Exception as error:
        print(f"{release}: failed - {type(error).__name__}: {str(error)[:200]}")
