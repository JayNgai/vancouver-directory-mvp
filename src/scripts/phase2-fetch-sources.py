"""PHASE 2/3 step 1 - download the free source data into the local cache (no DB writes).

Sources:
  * City of Vancouver business licences (Open Government Licence - Vancouver), status Issued
  * BC Data Catalogue "Licensed Establishments" workbook (Open Government Licence - BC)
Also lists the distinct licence business types so the food/drink filter is explicit.
"""
import csv
import io
import json
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

CACHE = Path(tempfile.gettempdir()) / "vancouver-directory-source-cache"
CACHE.mkdir(parents=True, exist_ok=True)
UA = "VancouverDirectoryMVP/1.0 (local directory enrichment; contact: local development)"
BASE = "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/business-licences"


def get(url, timeout=180):
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


print("1) distinct business types (one request)")
facets = json.loads(get(f"{BASE}/records?group_by=businesstype&limit=100&select=businesstype,count(*)").decode())
types = [(row.get("businesstype"), row.get("count") or row.get("count(*)") or 0) for row in facets.get("results", [])]
(CACHE / "licence-types.json").write_text(json.dumps(types, indent=1), encoding="utf-8")
for name, count in types:
    print(f"   {count:>7}  {name}")
print("   extractdate:", json.loads(get(f"{BASE}/records?limit=1&select=extractdate").decode())["results"][0])

FOOD_TYPES = [name for name, _ in types if name and any(
    token in name.lower() for token in ("food", "restaurant", "liquor", "catering", "brew", "winery"))]
print("2) food/drink licence types used:", len(FOOD_TYPES))

where = 'status = "Issued" AND (' + " OR ".join(
    f'businesstype = "{t}"'.replace("'", "''") for t in FOOD_TYPES) + ')'
url = f"{BASE}/exports/csv?" + urllib.parse.urlencode({"where": where, "delimiter": ",", "limit": -1})
raw = get(url)
licence_path = CACHE / "city-business-licences-issued-food.csv"
licence_path.write_bytes(raw)
rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig", "replace"))))
print(f"   saved {licence_path.name} rows={len(rows)}")
print("   sample:", {k: rows[0][k] for k in ("businessname", "status", "businesstype", "businesssubtype",
                                             "house", "street", "localarea", "extractdate")} if rows else None)
time.sleep(1.5)

print("3) BC Licensed Establishments workbook")
bc_url = ("https://www2.gov.bc.ca/assets/gov/employment-business-and-economic-development/"
          "business-management/liquor-regulation-licensing/reports/"
          "all_liquor_licensed_establishments_in_bc.xlsx")
raw = get(bc_url, timeout=300)
bc_path = CACHE / "bc-licensed-establishments.xlsx"
bc_path.write_bytes(raw)
print(f"   saved {bc_path.name} bytes={len(raw)}")
