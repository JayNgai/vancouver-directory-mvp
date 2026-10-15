"""Independent verification of the truth pass (Phases A/B/C) against the live database."""
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
con = sqlite3.connect(f"file:{(ROOT / 'prisma' / 'dev.db').as_posix()}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
q = lambda sql, *args: con.execute(sql, args).fetchall()
one = lambda sql, *args: con.execute(sql, args).fetchone()[0]

out = {}
out["totals"] = {
    "neighborhoods": one("SELECT COUNT(*) FROM neighborhoods"),
    "businesses": one("SELECT COUNT(*) FROM businesses"),
    "itineraries": one("SELECT COUNT(*) FROM itineraries"),
    "itinerary_steps": one("SELECT COUNT(*) FROM itinerary_steps"),
}
out["field_truth"] = {
    "rating_null": one("SELECT COUNT(*) FROM businesses WHERE rating IS NULL"),
    "review_count_null": one("SELECT COUNT(*) FROM businesses WHERE reviewCount IS NULL"),
    "price_range_null": one("SELECT COUNT(*) FROM businesses WHERE priceRange IS NULL"),
    "photos_empty": one("SELECT COUNT(*) FROM businesses WHERE photos = '[]'"),
    "photos_with_unsplash": one("SELECT COUNT(*) FROM businesses WHERE photos LIKE '%unsplash%'"),
    "verified_true": one("SELECT COUNT(*) FROM businesses WHERE isVerified = 1"),
    "filler_descriptions": one(
        "SELECT COUNT(*) FROM businesses WHERE description IS NOT NULL "
        "AND LOWER(description) LIKE '%is a local spot located in%'"),
    "with_phone": one("SELECT COUNT(*) FROM businesses WHERE phone IS NOT NULL AND phone <> ''"),
    "with_website": one("SELECT COUNT(*) FROM businesses WHERE website IS NOT NULL AND website <> ''"),
    "with_hours": one("SELECT COUNT(*) FROM businesses WHERE hours IS NOT NULL AND hours <> ''"),
}
out["slugs"] = {
    "duplicate_groups": one("SELECT COUNT(*) FROM (SELECT slug FROM businesses GROUP BY slug HAVING COUNT(*) > 1)"),
    "null_or_empty": one("SELECT COUNT(*) FROM businesses WHERE slug IS NULL OR slug = ''"),
}
out["categories"] = [dict(r) for r in q(
    "SELECT category, COUNT(*) AS n FROM businesses GROUP BY category ORDER BY n DESC")]
out["itinerary_integrity"] = {
    "itineraries": [dict(r) for r in q("SELECT id, title, slug FROM itineraries ORDER BY slug")],
    "steps_total": one("SELECT COUNT(*) FROM itinerary_steps"),
    "steps_with_business": one("SELECT COUNT(*) FROM itinerary_steps WHERE businessId IS NOT NULL"),
    "orphan_steps": one(
        "SELECT COUNT(*) FROM itinerary_steps s LEFT JOIN businesses b ON b.id = s.businessId "
        "WHERE s.businessId IS NOT NULL AND b.id IS NULL"),
    "steps_per_itinerary": [dict(r) for r in q(
        "SELECT itineraryId, COUNT(*) AS n FROM itinerary_steps GROUP BY itineraryId ORDER BY itineraryId")],
}
out["neighborhood_counts"] = [dict(r) for r in q(
    "SELECT n.name, COUNT(b.id) AS businesses, SUM(CASE WHEN b.phone IS NOT NULL AND b.phone <> '' THEN 1 ELSE 0 END) AS with_phone "
    "FROM neighborhoods n LEFT JOIN businesses b ON b.neighborhoodId = n.id GROUP BY n.id ORDER BY n.name")]
out["thin_or_empty"] = [dict(r) for r in q(
    "SELECT n.name, COUNT(b.id) AS businesses FROM neighborhoods n "
    "LEFT JOIN businesses b ON b.neighborhoodId = n.id GROUP BY n.id HAVING COUNT(b.id) < 10 ORDER BY 2")]
out["sample_rows"] = [dict(r) for r in q(
    "SELECT name, category, primaryCategory, address, phone, hours, isVerified, rating, priceRange, photos "
    "FROM businesses WHERE phone IS NOT NULL ORDER BY name LIMIT 5")]

print(json.dumps(out, indent=2, ensure_ascii=False))
