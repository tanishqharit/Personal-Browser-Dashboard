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
| `app.js` | Draws the page; the Manage, Wallpaper and GitHub Connection panels save to GitHub. |
| `manifest.webmanifest` | Lets you "Add to Home Screen" as an app. |
| `.github/workflows/deploy.yml` | Checks `links.json`, fetches missing icons, publishes to Pages. |
| `.github/workflows/check-links.yml` + `scripts/check_links.py` | Weekly check for dead links; opens an issue if it finds any. |

## Edit from the page (any device)

The bottom of the sidebar has the tools (icons only on a phone):

- **Manage Groups & Links**: a two-pane editor, and where you add links (pick a group → **＋ Add link**). Left: groups (add, select). Right: the group's
  emoji and name, and its links. Rename, drag the ≡ handle to reorder (mouse, trackpad or touch; arrow keys work too), move a link to another group, change its icon, delete.
  - **Tick several links** to move or delete them together.
  - **↻** on a link deletes its icon on save, so the next deploy downloads it again (fixes a bad or outdated icon).
  - **Emoji** (optional): the box left of the group name. It's shown next to the group in the sidebar.
  - **History**: every save of your groups and links. Pick one to see what restoring it would change, then **Restore**.
    A restore is a new commit, so it can be undone the same way. The wallpaper isn't touched.

  Changes are staged until **Save Changes**, which writes them as one commit; **Discard** undoes them.
  If another device saved in the meantime, it says so instead of overwriting.
- **Wallpaper**: upload from your device (resized to 2560px JPEG, saved in `wallpapers/`) or use an
  image URL (stays hosted there). Saved in `links.json`, so it's the same on every device until you change
  or remove it. The repo is public, so the wallpaper is too.
- **Open**: whether links open in **this tab** (default, start-page style) or a **new tab**. Saved per browser.
- **View**: switches between **Icons** (home-screen grid) and **List** (rows with name and address).
  Saved per browser.
- **Icons**: toggles the icon style between **Dark** (default) and **Light**. Saved per browser, so each
  device can have its own.
- **GitHub Connection**: connect or disconnect this browser, see the account and repo, and test the
  connection. The dot is green when connected, **amber** in the week before the token expires, **red** once it has
  expired or GitHub rejects it. (GitHub doesn't let web pages read a token's expiry, so type the date in when you
  connect, or later in the panel.)

## Keyboard

| Key | Does |
|---|---|
| **⌘K** / **Ctrl+K**, **/**, or just start typing | Quick launch: type part of a name (or the letters in order: "ymus" → YouTube Music), **↵** opens it |
| **⇧↵** in quick launch | Opens it the other way (new tab instead of this tab, or the reverse) |
| **1**–**9** | Jump to that group |

## Broken-link check

Every Monday `check-links.yml` visits every link. If any are dead (domain gone, server down, 404/410) it opens one
issue, **Broken links**, which GitHub emails you about. It updates that issue on later runs and closes it once
everything works. Sites that block scripts (403, 429…) are listed as "couldn't check", not as broken. Sites that
now redirect to another domain are listed so you can update the saved URL. Run it any time from **Actions → Check
links → Run workflow**.

Saving commits `links.json` (and any icons) straight to this repo through the GitHub API, so the
normal deploy publishes it everywhere in about a minute.

**One-time setup per device:** create a
[fine-grained token](https://github.com/settings/personal-access-tokens/new) with
*Only select repositories → Personal-Browser-Dashboard* and *Contents: Read and write*, and paste it into
GitHub Connection along with its expiry date. It's kept only in that browser's storage.

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

Tiles are cut to the iPhone app-icon shape (continuous corners) by `icons/squircle.svg`, so don't round the corners yourself.

**Dark mode:** when the device is in dark mode, icons come from `icons/dark/` — iOS-style versions made by
`scripts/dark_icons.py` on every deploy (white background → graphite, logo colours kept, black logos turned light).
Light mode uses the originals.

## Add a section

Add another object to `sections` with its own `name` and `links` (and optionally `"emoji": "🎮"`).

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
