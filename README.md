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
| `app.js` | Draws the page; Add Link, Manage and GitHub Connection panels save to GitHub. |
| `manifest.webmanifest` | Lets you "Add to Home Screen" as an app. |
| `.github/workflows/deploy.yml` | Checks `links.json`, fetches missing icons, publishes to Pages. |

## Edit from the page (any device)

The bottom of the sidebar has three tools (icons only on a phone):

- **Add Link**: quick form with name, URL, optional icon image, and group (or **＋ New group…**).
- **Manage Groups & Links**: a two-pane editor. Left: groups (add, select). Right: the group's
  name and links. Rename, reorder (↑ ↓), move a link to another group, change its icon, delete.
  Changes are staged until **Save Changes**, which writes them as one commit; **Discard** undoes them.
  If another device saved in the meantime, it says so instead of overwriting.
- **GitHub Connection**: connect or disconnect this browser, see the account and repo, and test the
  connection. The dot is green when connected.

Saving commits `links.json` (and any icons) straight to this repo through the GitHub API, so the
normal deploy publishes it everywhere in about a minute.

**One-time setup per device:** create a
[fine-grained token](https://github.com/settings/personal-access-tokens/new) with
*Only select repositories → Personal-Browser-Dashboard* and *Contents: Read and write*, and paste it into
GitHub Connection. It's kept only in that browser's storage.

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

Every group in `links.json` gets a sidebar entry automatically; the page opens on the first one.
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
