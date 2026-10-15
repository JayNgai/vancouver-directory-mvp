"""Debug: is the Joe Fortes pair generated and how is it classified?"""
import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "p6", Path(__file__).resolve().parent / "phase6-global-dedupe.py")
module = importlib.util.module_from_spec(spec)
sys.argv = [str(Path(__file__).resolve().parent / "phase6-global-dedupe.py")]  # dry run
try:
    spec.loader.exec_module(module)
except SystemExit:
    pass

left = {"name": "Joe Fortes", "address": "777 Thurlow Street", "latitude": None, "longitude": None}
right = {"name": "Joe Fortes Seafood & Chop House", "address": "777 Thurlow St, Vancouver",
         "latitude": None, "longitude": None}
print("address keys equal:", module.address_key(left["address"]) == module.address_key(right["address"]))
print("name keys:", module.name_key(left["name"]), "|", module.name_key(right["name"]))
print("similarity:", module.similarity(left["name"], right["name"]))
print("containment slack5:", module.contained_with_slack(left["name"], right["name"]))
