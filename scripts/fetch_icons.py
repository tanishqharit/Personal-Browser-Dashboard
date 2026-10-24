"""Download a sharp icon for every link in links.json that doesn't have one yet.

Runs in GitHub Actions on each deploy. For each link it looks at what the site
publishes (web app manifest icons, apple-touch-icon, <link rel=icon>), plus
Google's favicon service as a fallback, keeps the biggest image, and saves it as
icons/<slug>.png at 256x256.

  - Opaque square icons (most apple-touch-icons) fill the tile edge to edge.
  - Logos with a transparent background get padding on a solid tile, like
    macOS app icons.

Icons that already exist are never touched, so a hand-made icons/<slug>.png
always wins. Delete a file to make it re-download.
"""

import io
import json
import re
import sys
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "icons"
SIZE = 256
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"


def slug(name):
    # Must match slug() in app.js.
    return re.sub(r"[^a-z0-9]+", "-", name.lower())


def get(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.geturl(), r.read(3_000_000)


class IconLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.icons, self.manifest = [], None

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
        elif "icon" in rel or "apple-touch-icon" in rel or "apple-touch-icon-precomposed" in rel:
            self.icons.append(href)


def candidates(url):
    """Icon URLs to try, roughly best-first."""
    out = []
    try:
        final, body = get(url)
        p = IconLinks()
        p.feed(body.decode("utf-8", "ignore"))
        if p.manifest:
            murl = urllib.parse.urljoin(final, p.manifest)
            try:
                _, mbody = get(murl)
                icons = json.loads(mbody).get("icons", [])
                out += [urllib.parse.urljoin(murl, i["src"]) for i in icons if "src" in i]
            except Exception as e:
                print(f"    manifest failed: {e}")
        out += [urllib.parse.urljoin(final, h) for h in p.icons]
        base = final
    except Exception as e:
        print(f"    page failed: {e}")
        base = url
    origin = "{0.scheme}://{0.netloc}".format(urllib.parse.urlparse(base))
    out += [origin + "/apple-touch-icon.png"]
    host = urllib.parse.urlparse(url).hostname
    out += [f"https://www.google.com/s2/favicons?domain={host}&sz=256"]
    seen = set()
    return [u for u in out if not (u in seen or seen.add(u)) and not u.lower().split("?")[0].endswith(".svg")]


def load(url):
    try:
        _, data = get(url)
        img = Image.open(io.BytesIO(data))
        if img.format == "ICO":
            # ICO files hold several sizes; take the biggest.
            img = img.ico.getimage(max(img.ico.sizes()))
        img.load()
        return img.convert("RGBA")
    except Exception:
        return None


def make_tile(img):
    w, h = img.size
    s = min(w, h)
    img = img.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))

    alpha = img.getchannel("A")
    see_through = sum(1 for a in alpha.getdata() if a < 200) / (s * s)

    if see_through < 0.03:
        # Already a full square icon: fill the tile.
        return img.resize((SIZE, SIZE), Image.LANCZOS)

    # Transparent logo: pick a background it shows up on, then pad it.
    px = [p for p in img.getdata() if p[3] > 200]
    lum = sum(0.299 * r + 0.587 * g + 0.114 * b for r, g, b, _ in px) / max(len(px), 1)
    bg = (28, 28, 30, 255) if lum > 200 else (255, 255, 255, 255)

    tile = Image.new("RGBA", (SIZE, SIZE), bg)
    inner = int(SIZE * 0.68) if s >= 96 else min(int(SIZE * 0.5), s * 4)
    logo = img.resize((inner, inner), Image.LANCZOS)
    off = (SIZE - inner) // 2
    tile.alpha_composite(logo, (off, off))
    return tile


def main():
    data = json.loads((ROOT / "links.json").read_text())
    links = [l for sec in data["sections"] for l in sec["links"]]
    ICONS.mkdir(exist_ok=True)
    added = 0

    for link in links:
        if link.get("icon"):
            continue
        dest = ICONS / f"{slug(link['name'])}.png"
        if dest.exists():
            continue
        print(f"{link['name']}  ({link['url']})")
        best = None
        for c in candidates(link["url"]):
            img = load(c)
            if img is None:
                continue
            print(f"    {min(img.size):>4}px  {c}")
            if best is None or min(img.size) > min(best.size):
                best = img
            if min(best.size) >= SIZE:
                break
        if best is None:
            print("    no icon found, will show a letter tile")
            continue
        make_tile(best).save(dest, optimize=True)
        print(f"    saved {dest.name} from {min(best.size)}px source")
        added += 1

    print(f"\n{added} new icon(s)")


if __name__ == "__main__":
    sys.exit(main())
