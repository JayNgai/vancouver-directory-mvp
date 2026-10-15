"""Audit: are any near-duplicate venues still in the database? Read-only."""
import csv
import json
import math
import re
import sqlite3
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
con = sqlite3.connect(f"file:{(ROOT / 'prisma' / 'dev.db').as_posix()}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
rows = [dict(r) for r in con.execute(
    "SELECT id, name, address, latitude, longitude, phone, website FROM businesses")]

ABBR = {"st": "street", "str": "street", "ave": "avenue", "av": "avenue", "rd": "road",
        "blvd": "boulevard", "dr": "drive", "hwy": "highway", "cres": "crescent", "pl": "place",
        "ct": "court", "e": "east", "w": "west", "n": "north", "s": "south", "co": "company",
        "ltd": "limited", "inc": "incorporated"}


def norm(value):
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(c for c in value if not unicodedata.combining(c))
    value = value.replace("&", " and ").replace("+", " and ")
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def tokens(value):
    return [ABBR.get(t, t) for t in norm(value).split()]


def name_key(value):
    return " ".join(t for t in tokens(value) if t not in {"the", "vancouver"})


def address_key(value):
    text = norm(value)
    match = re.match(r"(\d+[a-z]?)\s+(.*)", text)
    if not match:
        return None
    street = re.sub(r"\b(vancouver|bc|canada)\b", " ", match.group(2))
    return match.group(1), " ".join(ABBR.get(t, t) for t in street.split())


def metres(a, b):
    if None in (a["latitude"], a["longitude"], b["latitude"], b["longitude"]):
        return None
    mean = math.radians((a["latitude"] + b["latitude"]) / 2)
    return math.hypot((a["longitude"] - b["longitude"]) * 111320 * math.cos(mean),
                      (a["latitude"] - b["latitude"]) * 111320)


by_name = {}
by_address = {}
by_coarse = {}
for row in rows:
    by_name.setdefault(name_key(row["name"]), []).append(row)
    key = address_key(row["address"])
    if key:
        by_address.setdefault(key, []).append(row)
    if row["latitude"] is not None:
        by_coarse.setdefault((round(row["latitude"], 3), round(row["longitude"], 3)), []).append(row)

suspects = []
seen = set()
for row in rows:
    pool = []
    pool.extend(by_name.get(name_key(row["name"]), []))
    key = address_key(row["address"])
    if key:
        pool.extend(by_address.get(key, []))
    if row["latitude"] is not None:
        for d_lat in (-0.001, 0, 0.001):
            for d_lon in (-0.001, 0, 0.001):
                pool.extend(by_coarse.get((round(row["latitude"] + d_lat, 3),
                                           round(row["longitude"] + d_lon, 3)), []))
    for other in pool:
        if other["id"] == row["id"]:
            continue
        pair = tuple(sorted((row["id"], other["id"])))
        if pair in seen:
            continue
        seen.add(pair)
        same_address = bool(key and address_key(other["address"]) == key)
        distance = metres(row, other)
        near = distance is not None and distance <= 120
        if not (same_address or near):
            continue
        score = max(SequenceMatcher(None, name_key(row["name"]), name_key(other["name"])).ratio(),
                    len(set(name_key(row["name"]).split()) & set(name_key(other["name"]).split()))
                    / max(1, len(set(name_key(row["name"]).split()) | set(name_key(other["name"]).split()))))
        a_set, b_set = set(name_key(row["name"]).split()), set(name_key(other["name"]).split())
        contained = a_set.issubset(b_set) or b_set.issubset(a_set)
        if same_address and (contained or score >= 0.80):
            suspects.append((row["name"], row["address"], other["name"], other["address"],
                             round(score, 3), "same address"))
        elif near and score >= 0.85:
            suspects.append((row["name"], row["address"], other["name"], other["address"],
                             round(score, 3), "within 120 m"))

print(f"rows={len(rows)} remaining near-duplicate candidates={len(suspects)}")
for item in suspects[:20]:
    print("  ", item)
if suspects:
    out = ROOT / "data" / "phase5-post-audit-remaining-candidates.csv"
    with out.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["name_a", "address_a", "name_b", "address_b", "similarity", "reason"])
        writer.writerows(suspects)
    print("written", out.name)
print(json.dumps({
    "businesses": con.execute("SELECT COUNT(*) FROM businesses").fetchone()[0],
    "duplicate_slugs": con.execute("SELECT COUNT(*) FROM (SELECT slug FROM businesses GROUP BY slug HAVING COUNT(*)>1)").fetchone()[0],
    "verified_true": con.execute("SELECT COUNT(*) FROM businesses WHERE isVerified=1").fetchone()[0],
    "ratings": con.execute("SELECT COUNT(*) FROM businesses WHERE rating IS NOT NULL").fetchone()[0],
    "low_confidence_kept": con.execute("SELECT COUNT(*) FROM businesses WHERE overtureConfidence IS NOT NULL AND overtureConfidence < 0.5").fetchone()[0],
}, indent=1))
