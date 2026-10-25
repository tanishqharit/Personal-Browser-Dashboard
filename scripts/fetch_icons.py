"""Download a sharp icon for every link in links.json that doesn't have one yet.

Runs in GitHub Actions on each deploy and saves icons/<slug>.png at 256x256.

Where it looks, best first:
  1. "icon" URLs from links.json (string or list) - for sites with poor icons
  2. web app manifest icons marked "maskable" (made to fill a shape edge to edge)
  3. apple-touch-icon (the site's own home-screen app icon)
  4. other manifest icons, then <link rel=icon>, then /apple-touch-icon.png
  5. Google's favicon service

The first source that is sharp enough (>= GOOD px) wins; otherwise the biggest
one found. SVGs are rendered as vectors, so they are always sharp.

How the tile is made:
  - Opaque square icon             -> fills the tile
  - App icon with rounded corners  -> cropped and filled (the page applies its own corners)
  - Logo on transparent background -> padded on a solid tile, like macOS icons

Existing icons are never touched, so a hand-made icons/<slug>.png always wins.
Delete a file to make it re-download.
"""

import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

from PIL import Image

try:
    import cairosvg
except Exception:  # missing system cairo: just skip SVGs
    cairosvg = None

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "icons"
SIZE = 256
GOOD = 160
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
# Wikimedia asks automated tools to identify themselves; a browser-like UA from a
# server gets rate-limited (HTTP 429).
BOT_UA = "PersonalDashboardIconFetcher/1.0 (https://github.com/tanishqharit/Personal-Browser-Dashboard)"


def slug(name):
    # Must match slug() in app.js.
    return re.sub(r"[^a-z0-9]+", "-", name.lower())


def get(url, timeout=15):
    ua = BOT_UA if "wikimedia.org" in url or "wikipedia.org" in url else UA
    for attempt in range(3):
        req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "*/*"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.geturl(), r.read(5_000_000)
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 2:
                raise
            time.sleep(4 * (attempt + 1))  # rate-limited: wait and retry


class IconLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.touch, self.icons, self.manifest = [], [], None

    def handle_starttag(self, tag, attrs):
        if tag != "link":
            return
        a = dict(attrs)
        rel = (a.get("rel") or "").lower().split()
        href = a.get("href")
        if not href:
            return
        if "manifest" in rel:
            self.manifest = href
        elif "apple-touch-icon" in rel or "apple-touch-icon-precomposed" in rel:
            self.touch.append(href)
        elif "icon" in rel:
            self.icons.append(href)


def site_candidates(url):
    """Icon URLs the site itself publishes, best-first."""
    maskable, touch, other, rel_icons = [], [], [], []
    base = url
    try:
        base, body = get(url)
        p = IconLinks()
        p.feed(body.decode("utf-8", "ignore"))
        touch = [urllib.parse.urljoin(base, h) for h in p.touch]
        rel_icons = [urllib.parse.urljoin(base, h) for h in p.icons]
        if p.manifest:
            murl = urllib.parse.urljoin(base, p.manifest)
            try:
                _, mbody = get(murl)
                for i in json.loads(mbody).get("icons", []):
                    purpose = i.get("purpose", "any")
                    if "src" not in i or "monochrome" in purpose:
                        continue
                    src = urllib.parse.urljoin(murl, i["src"])
                    (maskable if "maskable" in purpose else other).append(src)
            except Exception as e:
                print(f"    manifest failed: {e}")
    except Exception as e:
        print(f"    page failed: {e}")
    origin = "{0.scheme}://{0.netloc}".format(urllib.parse.urlparse(base))
    host = urllib.parse.urlparse(url).hostname
    return (
        maskable + touch + other + rel_icons
        + [origin + "/apple-touch-icon.png", f"https://www.google.com/s2/favicons?domain={host}&sz=256"]
    )


def load(url):
    """Returns (image, size_score) or None. SVGs score as huge since they scale."""
    try:
        _, data = get(url)
        head = data[:500].lstrip().lower()
        # Decide by content, not URL: "…logo.svg?width=1024" is a PNG rendered by Wikimedia.
        if head.startswith(b"<svg") or (head.startswith((b"<?xml", b"<!--", b"<!doctype svg")) and b"<svg" in data[:4000].lower()):
            if cairosvg is None:
                return None
            # Width only, so wide wordmarks keep their shape and plenty of resolution.
            png = cairosvg.svg2png(bytestring=data, output_width=SIZE * 4)
            return Image.open(io.BytesIO(png)).convert("RGBA"), 10_000
        img = Image.open(io.BytesIO(data))
        if img.format == "ICO":
            # ICO files hold several sizes; take the biggest.
            img = img.ico.getimage(max(img.ico.sizes()))
        img.load()
        img = img.convert("RGBA")
        return img, min(img.size)
    except Exception as e:
        print(f"    fail   {url}  ({type(e).__name__}: {str(e)[:80]})")
        return None


def make_tile(img):
    # Fit the drawing into a square canvas (wide logos get transparent bars).
    w, h = img.size
    s = max(w, h)
    sq = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sq.alpha_composite(img, ((s - w) // 2, (s - h) // 2))
    img = sq

    alpha = img.getchannel("A")
    total = s * s
    clear = sum(1 for a in alpha.getdata() if a < 200) / total

    if clear < 0.03:
        # Opaque square icon: fill the tile.
        return img.resize((SIZE, SIZE), Image.LANCZOS)

    bbox = alpha.point(lambda a: 255 if a >= 200 else 0).getbbox()
    if bbox:
        bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
        inside = img.crop(bbox).getchannel("A")
        solid = sum(1 for a in inside.getdata() if a >= 200) / max(bw * bh, 1)
        if solid > 0.85 and abs(bw - bh) <= max(bw, bh) * 0.05:
            # A square app icon with its own rounded corners (and maybe margin):
            # crop to it and fill the tile. Corners get the icon's edge color.
            crop = img.crop(bbox).resize((SIZE, SIZE), Image.LANCZOS)
            edge = crop.getpixel((SIZE // 2, 3))
            tile = Image.new("RGBA", (SIZE, SIZE), edge[:3] + (255,))
            tile.alpha_composite(crop)
            return tile

    # Transparent logo: pick a background it shows up on, then pad it.
    px = [p for p in img.getdata() if p[3] > 200]
    lum = sum(0.299 * r + 0.587 * g + 0.114 * b for r, g, b, _ in px) / max(len(px), 1)
    bg = (28, 28, 30, 255) if lum > 200 else (255, 255, 255, 255)

    if bbox:
        img = img.crop(bbox)

    # Square-ish logos fill ~62% of the tile; wide wordmarks (YONO, Bath & Body Works)
    # get ~82% of the width so the text stays readable.
    w, h = img.size
    target = 0.82 if w / h > 1.8 else 0.62
    k = SIZE * target / max(w, h)
    logo = img.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
    tile = Image.new("RGBA", (SIZE, SIZE), bg)
    tile.alpha_composite(logo, ((SIZE - logo.width) // 2, (SIZE - logo.height) // 2))
    return tile


def main():
    data = json.loads((ROOT / "links.json").read_text())
    links = [l for sec in data["sections"] for l in sec["links"]]
    ICONS.mkdir(exist_ok=True)
    print(f"SVG support: {'yes' if cairosvg else 'no'}")
    added = 0

    for link in links:
        given = link.get("icon") or []
        given = [given] if isinstance(given, str) else given
        if given and not given[0].startswith("http"):
            continue  # points at a file in the repo: use as is
        dest = ICONS / f"{slug(link['name'])}.png"
        if dest.exists():
            continue

        print(f"{link['name']}  ({link['url']})")
        best = None
        # Wikimedia can also render an SVG to PNG itself (?width=), in case cairosvg can't.
        given = [v for u in given for v in ([u, u + "?width=1024"] if "Special:FilePath/" in u and u.lower().endswith(".svg") else [u])]
        for c in given + site_candidates(link["url"]):
            got = load(c)
            if got is None:
                continue
            img, score = got
            print(f"    {'svg' if score == 10_000 else score:>5}  {c}")
            if best is None or score > best[1]:
                best = got
            if score >= GOOD:
                best = got  # good enough and earlier in the list = preferred
                break
        if best is None:
            print("    no icon found, will show a letter tile")
            continue
        make_tile(best[0]).save(dest, optimize=True)
        print(f"    saved {dest.name}")
        added += 1

    print(f"\n{added} new icon(s)")


if __name__ == "__main__":
    sys.exit(main())
