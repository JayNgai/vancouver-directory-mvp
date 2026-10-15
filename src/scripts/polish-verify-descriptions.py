"""Item 5 of the polish pass: keep only descriptions that the venue's own website supports.

For each business with a description:
  - fetch the venue's own public website (home page, then /about as a fallback)
  - a description is KEPT only when the page text corroborates it: the venue name appears,
    and at least 60% of the description's distinctive words (>=4 chars, not stopwords) appear
    on the venue's own page
  - otherwise the description is NULLed (never replaced with invented copy)

Writes a report CSV and, with --apply, clears the unsupported descriptions.
"""
import csv
import html
import json
import os
import re
import sqlite3
import ssl
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "prisma" / "dev.db"
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
APPLY = "--apply" in sys.argv
UA = "VancouverDirectoryMVP/1.0 (local listing description check; contact: local development)"

STOPWORDS = {
    "with", "from", "that", "this", "your", "their", "have", "serves", "serving", "food",
    "foods", "great", "good", "best", "vancouver", "kitchen", "restaurant", "cafe", "coffee",
    "shop", "store", "very", "only", "also", "more", "than", "into", "over", "under", "made",
    "here", "when", "where", "which", "while", "will", "been", "they", "them", "some", "just",
    "like", "well", "each", "other", "made", "using", "local", "locals", "new", "one", "two",
    "and", "the", "for", "you", "are", "our", "all", "its", "his", "her", "not", "but", "out",
}


def norm(text):
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def fetch(url, timeout=25):
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*"})
    with urllib.request.urlopen(request, timeout=timeout, context=ssl.create_default_context()) as response:
        return response.read(700000).decode("utf-8", "replace")


def page_text(url):
    raw = fetch(url)
    body = re.sub(r"<script.*?</script>|<style.*?</style>", " ", raw, flags=re.S | re.I)
    return norm(re.sub(r"<[^>]+>", " ", html.unescape(body)))


def distinctive_words(text):
    words = [w for w in norm(text).split() if len(w) >= 4 and w not in STOPWORDS]
    return list(dict.fromkeys(words))


con = sqlite3.connect(str(DB))
con.row_factory = sqlite3.Row
rows = [dict(r) for r in con.execute(
    "SELECT id, name, address, website, description FROM businesses WHERE description IS NOT NULL ORDER BY name")]
print(f"descriptions to check: {len(rows)}")

report = []
for index, row in enumerate(rows, 1):
    words = distinctive_words(row["description"])
    name_words = [w for w in norm(row["name"]).split() if len(w) > 3]
    verdict = "null"
    matched = 0
    ratio = 0.0
    used_url = ""
    note = ""
    if row["website"]:
        base = row["website"].rstrip("/")
        candidates = [base]
        # Try common URL variants before treating a venue's page as unavailable.
        if "://www." in base:
            candidates.append(base.replace("://www.", "://"))
        elif "://" in base:
            scheme, rest = base.split("://", 1)
            candidates.append(f"{scheme}://www.{rest}")
        if base.startswith("http://"):
            candidates.append("https://" + base[len("http://"):])
        elif base.startswith("https://"):
            candidates.append("http://" + base[len("https://"):])
        about_variants = [f"{url}/about" for url in list(candidates)]
        candidates = list(dict.fromkeys(candidates + about_variants))
        for url in candidates:
            try:
                text = page_text(url)
            except urllib.error.HTTPError as error:
                note = f"fetch-failed-http-{error.code}"
                continue
            except Exception as error:
                note = f"fetch-failed-{type(error).__name__}"
                continue
            name_ok = any(token in text for token in name_words) if name_words else True
            matched = sum(1 for w in words if w in text)
            ratio = matched / len(words) if words else 0.0
            used_url = url
            if name_ok and ratio >= 0.6:
                verdict = "keep"
                note = "supported by venue's own page"
                break
            note = "page does not corroborate the description" if name_ok else "venue name not found on page"
            time.sleep(1.0)
        time.sleep(1.0)
    else:
        note = "no website to check against"

    report.append({
        "id": row["id"], "name": row["name"], "website": row["website"] or "",
        "description": row["description"], "verdict": verdict,
        "matched_words": f"{matched}/{len(words)}", "ratio": round(ratio, 2),
        "checked_url": used_url, "note": note
    })
    if index % 10 == 0:
        print(f"  checked {index}/{len(rows)}")

report_path = DATA / f"polish-descriptions-check-{stamp}.csv"
with report_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.DictWriter(fh, fieldnames=list(report[0].keys()))
    writer.writeheader()
    writer.writerows(report)

kept = [r for r in report if r["verdict"] == "keep"]
removed = [r for r in report if r["verdict"] != "keep"]
print(f"REPORT {report_path.name}")
print(f"KEEP {len(kept)} :: " + "; ".join(f"{r['name']} ({r['matched_words']})" for r in kept))
print(f"REMOVE {len(removed)}")

removed_path = DATA / f"polish-descriptions-removed-{stamp}.csv"
with removed_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.DictWriter(fh, fieldnames=list(report[0].keys()))
    writer.writeheader()
    writer.writerows(removed)
kept_path = DATA / f"polish-descriptions-kept-{stamp}.csv"
with kept_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.DictWriter(fh, fieldnames=list(report[0].keys()))
    writer.writeheader()
    writer.writerows(kept)
print(f"REMOVED LIST {removed_path.name}")
print(f"KEPT LIST {kept_path.name}")

if APPLY:
    con.executemany("UPDATE businesses SET description = NULL WHERE id = ?", [(r["id"],) for r in removed])
    con.commit()
    remaining = con.execute("SELECT COUNT(*) FROM businesses WHERE description IS NOT NULL").fetchone()[0]
    print(f"APPLIED: {len(removed)} descriptions removed; {remaining} descriptions remain")
else:
    print("DRY RUN: no writes (pass --apply)")
