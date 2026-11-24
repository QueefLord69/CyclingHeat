"""Index approved GPX files for the static archive."""
import json
import math
import re
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "dist"


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def distance(a, b):
    lat_a, lat_b = map(math.radians, (a[0], b[0]))
    delta_lon = math.radians(b[1] - a[1])
    h = math.sin((lat_b - lat_a) / 2) ** 2
    h += math.cos(lat_a) * math.cos(lat_b) * math.sin(delta_lon / 2) ** 2
    return 12742 * math.asin(math.sqrt(max(0, min(1, h))))


def normalize_date(value):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date().isoformat()
    except (AttributeError, ValueError):
        return None


def index_route(path, metadata):
    document = ET.parse(path).getroot()
    for element in document.iter():
        element.tag = element.tag.rsplit("}", 1)[-1]

    segments = []
    kilometres, ascent, elevations = 0, 0, 0
    dates = []
    for element, tag in [(node, "trkpt") for node in document.findall(".//trkseg")] + [
        (node, "rtept") for node in document.findall(".//rte")
    ]:
        segment = []
        previous = None
        for point in element.findall(tag):
            lat, lon = number(point.get("lat")), number(point.get("lon"))
            if lat is None or lon is None or abs(lat) > 90 or abs(lon) > 180:
                previous = None
                if segment:
                    segments.append(segment)
                    segment = []
                continue
            elevation = number(point.findtext("ele"))
            if previous:
                kilometres += distance(previous, (lat, lon))
                if elevation is not None and previous[2] is not None:
                    ascent += max(0, elevation - previous[2])
            elevations += elevation is not None
            date = normalize_date(point.findtext("time"))
            if date:
                dates.append(date)
            previous = [lat, lon, elevation, round(kilometres, 4)]
            segment.append(previous)
        if segment:
            segments.append(segment)

    if not any(len(segment) >= 2 for segment in segments):
        raise ValueError(f"{path.name}: GPX requires at least two consecutive valid points")

    return {
        "id": path.relative_to(ROOT).with_suffix("").as_posix(),
        "file": path.relative_to(ROOT).as_posix(),
        "name": metadata.get("name") or document.findtext(".//trk/name") or document.findtext(".//rte/name") or path.stem,
        "country": metadata.get("country") or "Unknown",
        "category": metadata.get("category") or "Uncategorised",
        "description": metadata.get("description") or "",
        "photo": metadata.get("photo") or "",
        "photoAlt": metadata.get("photoAlt") or "",
        "date": normalize_date(metadata.get("date")) or normalize_date(document.findtext("./metadata/time")) or min(dates, default=None),
        "demo": metadata.get("demo") is True,
        "distance": round(kilometres, 2),
        "gain": round(ascent) if elevations else None,
        "partialElevation": 0 < elevations < sum(map(len, segments)),
        "segments": segments,
    }


def main():
    routes = []
    for path in sorted((ROOT / "routes").rglob("*.gpx")):
        if not re.fullmatch(r"routes/(?:[a-z0-9-]+/)*[a-z0-9-]+\.gpx", path.relative_to(ROOT).as_posix()):
            raise ValueError(f"Use lowercase letters, digits and hyphens in route paths: {path.name}")
        sidecar = path.with_suffix(".json")
        metadata = json.loads(sidecar.read_text(encoding="utf-8")) if sidecar.exists() else {}
        if metadata.get("public") is True:
            photo = metadata.get("photo")
            if photo and (not re.fullmatch(r"photos/[a-zA-Z0-9/_\-.]+", photo)
                          or not (ROOT / photo).resolve().is_relative_to(ROOT / "photos")
                          or not (ROOT / photo).is_file()):
                raise ValueError(f"{sidecar.name}: photo must be an existing file under photos/")
            routes.append(index_route(path, metadata))
    target = ROOT / "routes-index.json"
    target.write_text(json.dumps(routes, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Indexed {len(routes)} approved route(s)")


if __name__ == "__main__":
    main()
