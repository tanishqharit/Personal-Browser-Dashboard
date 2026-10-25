"""Make an iOS-style dark version of every icon: icons/<name>.png -> icons/dark/<name>.png.

Runs in GitHub Actions on each deploy, after fetch_icons.py. Output is deterministic,
so unchanged icons produce no git diff.

What it does to each icon:
  1. Finds the light, grey-ish background touching the edges (flood fill from the border).
     Icons with no such background (full-colour tiles like Apple Card, photos) are kept as is.
  2. Replaces that background with a dark graphite gradient. The logo's soft edges are
     "un-mixed" from white first (the maths of GIMP's Color to Alpha), so there's no light halo.
     White details inside the logo (YouTube's play triangle, Reddit's face) are left alone.
  3. If the logo is mostly black (ChatGPT, X, Amazon's "a"), the whole icon is treated as ink on
     paper: paper turns dark, black ink turns soft white. Brand colours are never changed.
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "icons"
DARK = ICONS / "dark"
SKIP = {"app.png"}

TOP, BOTTOM = np.array([40, 40, 43.0]), np.array([20, 20, 22.0])  # graphite, like iOS dark icons


def light_neutral(rgb):
    lo, hi = rgb.min(axis=2), rgb.max(axis=2)
    return (lo >= 200) & (hi - lo <= 30)


def grow(mask, allowed=None, steps=1):
    """Grow a mask by `steps` pixels (4-neighbours), optionally staying inside `allowed`."""
    for _ in range(steps):
        m = mask.copy()
        m[1:, :] |= mask[:-1, :]
        m[:-1, :] |= mask[1:, :]
        m[:, 1:] |= mask[:, :-1]
        m[:, :-1] |= mask[:, 1:]
        if allowed is not None:
            m &= allowed
        mask = m
    return mask


def flood_from_border(allowed):
    seed = np.zeros_like(allowed)
    seed[0, :] = allowed[0, :]
    seed[-1, :] = allowed[-1, :]
    seed[:, 0] = allowed[:, 0]
    seed[:, -1] = allowed[:, -1]
    while True:
        nxt = grow(seed, allowed)
        if (nxt == seed).all():
            return seed
        seed = nxt


def lift(colors, sat_mask):
    """Brighten very dark brand colours (navy on Paytm, Experian) so they read on graphite.
    Smooth curve (no threshold), so noisy pixels can't flip between brightened and not."""
    lum = colors @ np.array([0.299, 0.587, 0.114])
    gain = np.clip(115 / np.maximum(lum, 1), 1, 3)[..., None]
    return np.where(sat_mask[..., None], np.clip(colors * gain, 0, 255), colors)


def darken(img):
    img = img.convert("RGBA")
    arr = np.asarray(img).astype(np.float64)
    rgb, alpha = arr[..., :3], arr[..., 3:] / 255
    rgb = rgb * alpha + 255 * (1 - alpha)  # flatten any transparency onto white
    h, w, _ = rgb.shape
    white = np.array([255.0, 255, 255])

    bg = flood_from_border(light_neutral(rgb))
    if bg.mean() < 0.10:
        return img  # full-colour tile or photo: nothing to darken

    t = np.linspace(0, 1, h)[:, None, None]
    dark = np.broadcast_to(TOP * (1 - t) + BOTTOM * t, rgb.shape)

    lo, hi = rgb.min(axis=2), rgb.max(axis=2)
    lum = rgb @ np.array([0.299, 0.587, 0.114])
    saturated = (hi - lo) > 40

    # Mostly-black logo (ChatGPT, X, Amazon's "a")? Treat the icon as ink on paper:
    # amount of ink = darkness; black ink becomes soft white, paper (incl. holes) becomes dark.
    logo = ~bg & (lum < 200)
    black = ~saturated & (lum < 90)
    if logo.any() and (logo & black).sum() / logo.sum() > 0.5:
        ink = ((255 - rgb).max(axis=2) / 255)[..., None]
        pure = np.clip((rgb - 255 * (1 - ink)) / np.where(ink > 0, ink, 1), 0, 255)
        neutral_ink = (pure.max(axis=2) - pure.min(axis=2)) < 40
        pure = np.where(neutral_ink[..., None], 235.0, pure)
        out = pure * ink + dark * (1 - ink)
        return Image.fromarray(np.clip(out, 0, 255).round().astype(np.uint8), "RGB").convert("RGBA")

    # Otherwise: background -> dark; logo untouched (apart from lifting very dark colours);
    # the soft edge in between is re-blended with the dark background instead of white.
    edge = grow(bg, steps=3) & ~bg
    solid = ~bg & ~edge

    # Give every edge pixel the colour of the nearest solid logo pixel.
    color = np.where(solid[..., None], rgb, 0.0)
    known = solid.copy()
    for _ in range(8):
        if not (edge & ~known).any():
            break
        total = np.zeros_like(color)
        count = np.zeros((h, w, 1))
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            shifted_c = np.roll(color, (dy, dx), axis=(0, 1))
            shifted_k = np.roll(known, (dy, dx), axis=(0, 1))[..., None]
            total += shifted_c * shifted_k
            count += shifted_k
        fill = edge & ~known & (count[..., 0] > 0)
        color = np.where(fill[..., None], total / np.maximum(count, 1), color)
        known |= fill
    color = np.where(known[..., None], color, white)  # isolated specks: treat as background

    # How much white is mixed into each edge pixel: project it on the line logo-colour -> white.
    span = white - color
    m = ((rgb - color) * span).sum(axis=2) / np.maximum((span ** 2).sum(axis=2), 1)
    m = np.clip(m, 0, 1)[..., None]
    m = np.where(((span ** 2).sum(axis=2) < 600)[..., None], 1.0, m)  # near-white "logo": background

    sat_color = (color.max(axis=2) - color.min(axis=2)) > 40
    color = lift(color, sat_color)
    logo_rgb = lift(rgb, saturated & solid)

    out = np.where(bg[..., None], dark, logo_rgb)
    out = np.where(edge[..., None], color * (1 - m) + dark * m, out)
    return Image.fromarray(np.clip(out, 0, 255).round().astype(np.uint8), "RGB").convert("RGBA")


def main():
    DARK.mkdir(exist_ok=True)
    made = 0
    for src in sorted(ICONS.glob("*.png")):
        if src.name in SKIP:
            continue
        dest = DARK / src.name
        darken(Image.open(src)).save(dest, optimize=True)
        made += 1
    print(f"{made} dark icon(s) written to {DARK.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
