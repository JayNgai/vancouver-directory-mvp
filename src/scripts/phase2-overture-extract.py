"""PHASE 2 step 2 - extract Overture Maps Places (food & drink) for the Vancouver bbox.

Writes the candidate set to data/overture-*.csv (no DB writes). Queries the public parquet
with DuckDB; the newest release uses `taxonomy`, older ones use `categories`, so both are
handled.
"""
import csv
import json
import tempfile
from datetime import datetime
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
CACHE = Path(tempfile.gettempdir()) / "vancouver-directory-source-cache"
stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
BBOX = "bbox.xmin BETWEEN -123.28 AND -123.00 AND bbox.ymin BETWEEN 49.19 AND 49.34"

releases = json.loads((CACHE / "overture-releases.json").read_text(encoding="utf-8"))
release = releases[-1]
path = f"s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*.parquet"
print("release:", release)

con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs;")
columns = [c[0] for c in con.execute(f"DESCRIBE SELECT * FROM read_parquet('{path}') LIMIT 1").fetchall()]
category_col = "taxonomy" if "taxonomy" in columns else "categories"
print("category field:", category_col)

FOOD_EXACT = {
    "coffee_shop", "cafe", "bakery", "bar", "pub", "brewery", "brewpub", "food_court",
    "food_truck", "diner", "ice_cream_shop", "dessert_shop", "bubble_tea_shop", "tea_room",
    "juice_bar", "smoothie_shop", "sandwich_shop", "deli", "candy_store", "chocolate_shop",
    "patisserie", "donut_shop", "frozen_yogurt_shop", "liquor_store", "wine_bar",
    "cocktail_bar", "sports_bar", "gastropub", "tavern", "confectionery", "creamery",
    "korean_restaurant", "buffet_restaurant", "food_stand", "food_hall", "cafeteria",
    "bistro", "eatery", "juice_and_smoothie_bar", "coffee_and_tea", "coffee_roastery",
    "pizza_delivery", "drive_in_restaurant", "farmers_market", "public_market",
}
# A venue is food/drink only when the place category is a restaurant subtype or an exact
# match from the list above: substring matching pulled in barbers, pet stores and
# restaurant-equipment suppliers.
def is_food_drink(category, brand):
    category = (category or "").lower()
    if not category:
        return False
    if category.endswith("_restaurant") or category in FOOD_EXACT:
        return True
    return category.endswith("_shop") and category.split("_")[0] in {
        "bakery", "coffee", "tea", "donut", "doughnut", "cake", "dessert", "ice", "juice",
        "candy", "chocolate", "bubble", "pie", "pretzel", "waffle", "gelato", "pastry",
    }

query = f"""
SELECT id, names.primary AS name, {category_col}.primary AS category,
       confidence, operating_status,
       addresses[1].freeform AS address_freeform, addresses[1].locality AS locality,
       addresses[1].region AS region, addresses[1].postcode AS postcode,
       phones[1] AS phone, websites[1] AS website,
       coalesce(brand.names.primary, '') AS brand,
       (bbox.xmin + bbox.xmax) / 2 AS lon, (bbox.ymin + bbox.ymax) / 2 AS lat
FROM read_parquet('{path}')
WHERE {BBOX}
  AND names.primary IS NOT NULL
  AND {category_col}.primary IS NOT NULL
"""
rows = con.execute(query).fetchall()
names = [d[0] for d in con.description]
print(f"overture places in bbox: {len(rows)}")

food = []
for row in rows:
    record = dict(zip(names, row))
    if is_food_drink(record["category"], record["brand"]):
        food.append(record)
print(f"food & drink candidates: {len(food)}")

out = DATA / f"overture-food-drink-candidates-{stamp}.csv"
with out.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.DictWriter(fh, fieldnames=list(food[0].keys()))
    writer.writeheader()
    writer.writerows(food)
print("CSV", out.name)

# also keep the ISO release marker for the documentation
(CACHE / "overture-release.txt").write_text(release, encoding="utf-8")
