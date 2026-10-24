# Personal Browser Dashboard

A personal start page: a grid of links with icons. Plain HTML/CSS/JS, no framework, no build step.
Every push to `main` deploys it to GitHub Pages through GitHub Actions → https://tanishqharit.github.io/Personal-Browser-Dashboard/

## Files

| File | What it does |
|---|---|
| `links.json` | **The only file you normally edit.** All sections and links. |
| `icons/` | One PNG per link, auto-fetched or your own. |
| `scripts/fetch_icons.py` | Downloads missing icons during deploy. |
| `index.html` | Page skeleton. |
| `style.css` | Look and layout. Colors are at the top. |
| `app.js` | Reads `links.json` and draws the page and sidebar. |
| `manifest.webmanifest` | Lets you "Add to Home Screen" as an app. |
| `.github/workflows/deploy.yml` | Checks `links.json`, fetches missing icons, publishes to Pages. |

## Add a link

```json
{ "name": "Notion", "url": "https://notion.so" }
```

## Icons

Icons are automatic. On each deploy, GitHub Actions (`scripts/fetch_icons.py`) finds the
biggest icon each new site publishes and saves it as `icons/<name>.png` (256×256),
then commits it back here. Each icon is only downloaded once.

- **File name** = link name, lowercased, spaces → dashes: "YouTube Music" → `icons/youtube-music.png`.
- **Don't like one?** Replace that PNG with your own (square, 256×256 or bigger). It's never overwritten.
- **Want it re-downloaded?** Delete the PNG and push.
- **Different file name?** Add `"icon": "icons/whatever.png"` to the link.
- No icon found → a colored letter tile.

Tiles are cut to a macOS-style squircle by `icons/squircle.svg`, so don't round the corners yourself.

## Add a section

Add another object to `sections` with its own `name` and `links`.

## Sidebar

Every section in `links.json` gets a sidebar entry automatically, plus **All** at the top.
On a phone the sidebar becomes a sideways-scrolling strip at the top.
Each section has its own URL, so you can bookmark one directly, e.g. `…/Personal-Browser-Dashboard/#finance`.

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

(Opening `index.html` directly from disk won't work: browsers block `fetch("links.json")` on `file://`.)

## Heads-up

This repo and site are **public**. Don't put account numbers, logins, or private URLs in `links.json`.
To lock it down later, move hosting to Cloudflare Pages + Cloudflare Access (free) — the files stay the same, only `deploy.yml` changes.
