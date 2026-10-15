"""Fetch the Overture attribution page and save readable text for the credit lines."""
import html
import re
import tempfile
import urllib.request
from pathlib import Path

CACHE = Path(tempfile.gettempdir()) / "vancouver-directory-source-cache"
CACHE.mkdir(parents=True, exist_ok=True)
UA = "VancouverDirectoryMVP/1.0 (local directory enrichment; contact: local development)"

request = urllib.request.Request("https://docs.overturemaps.org/attribution/",
                                 headers={"User-Agent": UA, "Accept": "text/html,*/*"})
raw = urllib.request.urlopen(request, timeout=60).read().decode("utf-8", "replace")
body = re.sub(r"<script.*?</script>|<style.*?</style>", " ", raw, flags=re.S | re.I)
text = html.unescape(re.sub(r"<[^>]+>", "\n", body))
text = re.sub(r"\n{2,}", "\n", text)
out = CACHE / "overture-attribution.txt"
out.write_text(text, encoding="utf-8")
print("saved", out, len(text), "chars")
start = text.lower().find("places")
print(text[start:start + 3500])
