"""Stage only the static assets referenced by the approved route index."""
import json
import shutil
import sys
from pathlib import Path

from build_routes import ROOT, main

output = Path(sys.argv[1]).resolve()
if output.exists():
    raise SystemExit(f"Staging directory must be new: {output}")
main()
index = ROOT / "routes-index.json"
assets = [
    "index.html", "style.css", "app.js", "routes-index.json", "leaflet.js",
    "leaflet.css", "leaflet-heat.js", "leaflet-LICENSE.txt", "leaflet-heat-LICENSE.txt",
]
for route in json.loads(index.read_text(encoding="utf-8")):
    assets.append(route["file"])
    if route["photo"]:
        assets.append(route["photo"])
for asset in dict.fromkeys(assets):
    source = ROOT / asset
    if not source.resolve().is_relative_to(ROOT):
        raise ValueError(f"Asset must stay inside the site directory: {asset}")
    destination = output / asset
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
(output / ".nojekyll").touch()
