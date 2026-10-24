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
| `app.js` | Draws the page and sidebar; the add/edit form saves to GitHub. |
| `manifest.webmanifest` | Lets you "Add to Home Screen" as an app. |
| `.github/workflows/deploy.yml` | Checks `links.json`, fetches missing icons, publishes to Pages. |

## Edit from the page (any device)

- **＋ Add Link** (bottom of the sidebar): name, URL, optional icon image, and group.
  Pick **＋ New group…** to create a group; **Manage groups** deletes one (its links move to a group you choose).
- **Edit** → tap any tile to change it, move it to another group, or delete it.
  On a laptop you can also drag a tile onto a group in the sidebar. **Done** to leave edit mode.

Saving commits `links.json` (and the icon, if you chose one) straight to this repo through the GitHub API,
so the normal deploy publishes it everywhere in about a minute.

**One-time setup per device:** the first Save asks for a GitHub token. Create a
[fine-grained token](https://github.com/settings/personal-access-tokens/new) with
*Only select repositories → Personal-Browser-Dashboard* and *Contents: Read and write*, then paste it in.
It's kept only in that browser's storage. "GitHub connection…" in the form replaces or forgets it.

## Add a link by hand

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
- **Site's icon is bad or blurry?** Point it at a better source and the deploy downloads it once:
  `"icon": "https://…/logo.svg"`, or a list to try in order. SVGs (vector) are always sharp —
  Wikimedia Commons has most brand logos: `https://commons.wikimedia.org/wiki/Special:FilePath/<File>.svg`.
  Delete the old PNG so it re-downloads.
- **Different file name?** `"icon": "icons/whatever.png"` (a path, not a URL) is used as is.
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
