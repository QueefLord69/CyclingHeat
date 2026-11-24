# Cycling Up That Hill

A static, map-first cycling route archive built with Leaflet and OpenStreetMap. The bundled GPX routes are fictional demonstration data. The demonstration tracks can cross terrain or roads unsuitable for cycling.

## Run locally

Use Python 3.10 or later. No package installation, backend, or API key is required. An internet connection is needed for OpenStreetMap tiles.

```sh
python3 scripts/stage_site.py _site
python3 -m http.server 8000 --directory _site
```

Open http://localhost:8000. Run the staging command with a new output directory each time.

## Add, edit, or remove a route

1. Review the GPX locally before committing it. Keep private originals outside the repository. Trim sensitive segments and remove metadata you do not intend to share. Published downloads contain the approved GPX file as supplied.
2. Add the reviewed file under `dist/routes/<year>/<country>/<route-name>.gpx`. Use lowercase ASCII letters, digits and hyphens in each directory and filename.
3. Add a JSON file next to the GPX with the same basename:

```json
{
  "public": true,
  "name": "Example route",
  "country": "Sweden",
  "category": "Gravel",
  "date": "2026-07-12",
  "description": "A short description of the ride.",
  "photo": "photos/example-route.jpg",
  "photoAlt": "Gravel road above a lake"
}
```

Only routes with `"public": true` are included in the index and staged site. GitHub repository visibility applies independently. In a public repo, every committed file can be visible, including files excluded from staging. Use `"demo": true` for fictional routes. Dates and photos are optional. Place reviewed photographs under `dist/photos/` and use relative paths. Remove any sensitive photo metadata before committing.

To edit a route, replace the GPX or edit its JSON. To remove one, delete both files or remove its approval and regenerate the site. Repository history may retain earlier versions.

Run `python3 scripts/build_routes.py` to regenerate the local index. GitHub Actions rebuilds and stages the index when changes are submitted in a pull request or pushed to `main`. The staged output is the deployable site.

## GitHub Pages

Set **Settings → Pages → Source** to **GitHub Actions**. When the approved changes are on `main`, run **Build route archive** manually with **Publish approved routes to GitHub Pages** checked. Normal builds generate an artifact for review. All asset URLs work under a GitHub Pages repository subpath.

## Route data

The index accepts GPX tracks and routes. Distance is computed between consecutive points within each segment. Elevation gain sums positive elevation changes where consecutive points have heights. Partial values are shown as lower bounds. Replay displays dated rides from oldest to newest and draws each route by distance. If no date can be read from its metadata or GPX, the route remains browsable under **Undated** and is skipped during replay.
