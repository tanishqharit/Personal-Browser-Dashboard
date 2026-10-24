# Personal Browser Dashboard

A personal start page: a grid of links with icons. Plain HTML/CSS/JS, no framework, no build step.
Every push to `main` deploys it to GitHub Pages through GitHub Actions → https://tanishqharit.github.io/Personal-Browser-Dashboard/

## Files

| File | What it does |
|---|---|
| `links.json` | **The only file you normally edit.** All sections, links and folders. |
| `icons/` | Custom icon images (PNG/SVG/WebP). |
| `index.html` | Page skeleton. |
| `style.css` | Look and layout. Colors are at the top. |
| `app.js` | Reads `links.json` and draws the page. Search and folders. |
| `manifest.webmanifest` | Lets you "Add to Home Screen" as an app. |
| `.github/workflows/deploy.yml` | Checks `links.json` is valid, then publishes to Pages. |

## Add a link

```json
{ "name": "Notion", "url": "https://notion.so" }
```

## Add a custom icon

Drop the image in `icons/` (square, ~180×180 or larger), then point to it:

```json
{ "name": "Chase", "url": "https://chase.com", "icon": "icons/chase.png" }
```

Icon order of preference: your `icon` file → the site's favicon (auto-fetched) → a colored letter tile.

## Add a folder

```json
{
  "name": "Personal",
  "folder": [
    { "name": "GitHub", "url": "https://github.com" },
    { "name": "Drive", "url": "https://drive.google.com" }
  ]
}
```

## Add a section

Add another object to `sections` with its own `name` and `links`.

## Shortcuts

- `/` focuses search (laptop)
- Type to filter, `Enter` opens the first match
- `Esc` closes a folder

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

(Opening `index.html` directly from disk won't work: browsers block `fetch("links.json")` on `file://`.)

## Heads-up

This repo and site are **public**. Don't put account numbers, logins, or private URLs in `links.json`.
To lock it down later, move hosting to Cloudflare Pages + Cloudflare Access (free) — the files stay the same, only `deploy.yml` changes.
