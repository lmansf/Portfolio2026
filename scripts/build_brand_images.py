#!/usr/bin/env python3
"""Build the site icon set and the link-preview (Open Graph) card.

Everything is drawn as SVG with text converted to outlines, then rendered to
PNG/ICO/JPG, so the output never depends on fonts being installed.

    python3 -m pip install fonttools uharfbuzz resvg-py pillow
    python3 scripts/build_brand_images.py            # downloads fonts once
    python3 scripts/build_brand_images.py --fonts DIR  # or use local TTFs

Outputs (paths relative to the repo root):
    favicon.ico                    16/32/48 px, served at /favicon.ico
    assets/favicon.svg             scalable tab icon
    assets/apple-touch-icon.png    180 px, full-bleed (iOS rounds the corners)
    assets/icon-192.png            manifest "any" icons (rounded tile)
    assets/icon-512.png
    assets/icon-maskable-512.png   manifest "maskable" icon (mark in safe zone)
    assets/share-card.jpg          1200x627 og:image / twitter:image

Palette is the "Barn Owl" set from assets/tokens.css (Day theme).
"""
from __future__ import annotations

import argparse
import base64
import io
import os
import pathlib
import tempfile
import urllib.request

import resvg_py
import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent

# tokens.css, Day theme
BG = "#fdf9f3"
SURFACE_1 = "#f6eee2"
INK_1 = "#3a281c"
INK_2 = "#715a47"
ACCENT = "#35607b"
ACCENT_SOFT = "#c5d9e6"
ACCENT_MIST = "#e2ecf3"
TAN = "#c4a07c"
CHESTNUT = "#7a3f1f"
FAWN = "#dcc8b2"

GOOGLE_FONTS_SHA = "2fe1e8c6b137fb13041a7cfca6fdcd8a910ea4dc"
FONT_URLS = {
    "Fraunces.ttf": f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_FONTS_SHA}/ofl/fraunces/Fraunces%5BSOFT,WONK,opsz,wght%5D.ttf",
    "Figtree.ttf": f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_FONTS_SHA}/ofl/figtree/Figtree%5Bwght%5D.ttf",
}


# ── fonts ────────────────────────────────────────────────────────────────
class Face:
    """A static instance of a variable font, with shaping and outlines."""

    def __init__(self, path: pathlib.Path, axes: dict[str, float]):
        tt = TTFont(path)
        instancer.instantiateVariableFont(tt, axes, inplace=True)
        buf = io.BytesIO()
        tt.save(buf)
        self.tt = TTFont(io.BytesIO(buf.getvalue()))
        self.hb_font = hb.Font(hb.Face(buf.getvalue()))
        self.upem = self.tt["head"].unitsPerEm
        self.glyphs = self.tt.getGlyphSet()
        self.order = self.tt.getGlyphOrder()

    def shape(self, text: str):
        b = hb.Buffer()
        b.add_str(text)
        b.guess_segment_properties()
        hb.shape(self.hb_font, b, {"kern": True, "liga": True})
        return b.glyph_infos, b.glyph_positions

    def width(self, text: str, size: float, tracking: float = 0) -> float:
        _, pos = self.shape(text)
        return sum(p.x_advance for p in pos) * size / self.upem + tracking * size * max(len(pos) - 1, 0)

    def path(self, text: str, x: float, y: float, size: float, tracking: float = 0) -> str:
        """SVG path data for `text` with its baseline starting at (x, y)."""
        s = size / self.upem
        infos, pos = self.shape(text)
        pen = SVGPathPen(self.glyphs)
        cx = 0.0
        for info, p in zip(infos, pos):
            name = self.order[info.codepoint]
            t = TransformPen(pen, (s, 0, 0, -s, x + (cx + p.x_offset) * s, y - p.y_offset * s))
            self.glyphs[name].draw(t)
            cx += p.x_advance + tracking * self.upem
        return pen.getCommands()

    def cap_height(self, size: float) -> float:
        return self.tt["OS/2"].sCapHeight * size / self.upem


def load_fonts(font_dir: pathlib.Path | None):
    if font_dir is None:
        font_dir = pathlib.Path(tempfile.gettempdir()) / "lm-brand-fonts"
        font_dir.mkdir(exist_ok=True)
        for name, url in FONT_URLS.items():
            dest = font_dir / name
            if not dest.exists():
                part = dest.with_name(f"{name}.{os.getpid()}.part")
                try:
                    urllib.request.urlretrieve(url, part)
                    os.replace(part, dest)
                finally:
                    part.unlink(missing_ok=True)
    fr = font_dir / "Fraunces.ttf"
    fg = font_dir / "Figtree.ttf"
    plain = {"SOFT": 0, "WONK": 0}
    return {
        "display": Face(fr, {"opsz": 72, "wght": 600, **plain}),
        "mark": Face(fr, {"opsz": 48, "wght": 700, **plain}),
        "mark_small": Face(fr, {"opsz": 9, "wght": 800, **plain}),
        "text": Face(fg, {"wght": 500}),
        "text_semi": Face(fg, {"wght": 600}),
    }


# ── rendering ────────────────────────────────────────────────────────────
def render(svg: str, width: int, height: int | None = None) -> Image.Image:
    png = resvg_py.svg_to_bytes(svg_string=svg, width=width, height=height or width)
    return Image.open(io.BytesIO(bytes(png))).convert("RGBA")


# ── the mark: "LM" on a creamy-blue tile, tan rule beneath ──────────────
def monogram(f, cx: float, cy: float, box: float, small: bool = False) -> str:
    """Cream 'LM' centred on (cx, cy), sized to sit inside a `box`-wide area."""
    face = f["mark_small"] if small else f["mark"]
    tracking = 0.0 if small else -0.02
    size = box * 0.50
    w = face.width("LM", size, tracking)
    cap = face.cap_height(size)
    rule = not small
    rule_h = box * 0.045
    gap = box * 0.075
    block_h = cap + (gap + rule_h if rule else 0)
    top = cy - block_h / 2
    base = top + cap
    out = f'<path fill="{BG}" d="{face.path("LM", cx - w / 2, base, size, tracking)}"/>'
    if rule:
        rw = w * 0.42
        out += (f'<rect x="{cx - rw / 2:.2f}" y="{base + gap:.2f}" width="{rw:.2f}" '
                f'height="{rule_h:.2f}" rx="{rule_h / 2:.2f}" fill="{TAN}"/>')
    return out


def tile_svg(f, size: int, *, radius: float, inset: float = 0.0, mark_scale: float = 1.0,
             small: bool = False) -> str:
    """Square canvas with an accent tile; `inset` leaves transparent margin."""
    t = size * inset
    side = size - 2 * t
    r = side * radius
    mark = monogram(f, size / 2, size / 2, side * mark_scale, small=small)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
            f'<rect x="{t:.2f}" y="{t:.2f}" width="{side:.2f}" height="{side:.2f}" rx="{r:.2f}" fill="{ACCENT}"/>'
            f'{mark}</svg>')


# ── share card ───────────────────────────────────────────────────────────
def share_card_svg(f, photo_png: bytes) -> str:
    W, H = 1200, 627
    photo = base64.b64encode(photo_png).decode()
    pcx, pcy, pr = 262, 313, 152  # photo circle
    x = 492                       # text column
    maxw = W - x - 64

    name, name_size = "Logan Mansfield", 84
    while f["display"].width(name, name_size, -0.01) > maxw:
        name_size -= 1
    role, role_size = "IT Analyst · Tampa, FL", 36
    body = ["Moving into analytics engineering. I build the",
            "pipelines, models, and dashboards that turn raw",
            "operational data into decisions."]
    body_size = 26
    while max(f["text"].width(line, body_size) for line in body) > maxw:
        body_size -= 0.5
    url, url_size = "loganmansfield.org", 32

    y_name = 222
    y_rule = y_name + 30
    y_role = y_rule + 66
    y_body0 = y_role + 52
    lh = body_size * 1.5
    y_url = y_body0 + lh * (len(body) - 1) + 78
    tile = 46
    url_x = x + tile + 16

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        '<defs>',
        f'<radialGradient id="g1" cx="0.9" cy="-0.1" r="0.75"><stop offset="0" stop-color="{ACCENT_MIST}"/><stop offset="1" stop-color="{BG}" stop-opacity="0"/></radialGradient>',
        f'<radialGradient id="g2" cx="-0.05" cy="1.1" r="0.7"><stop offset="0" stop-color="{FAWN}" stop-opacity="0.7"/><stop offset="1" stop-color="{BG}" stop-opacity="0"/></radialGradient>',
        f'<clipPath id="pc"><circle cx="{pcx}" cy="{pcy}" r="{pr}"/></clipPath>',
        '</defs>',
        f'<rect width="{W}" height="{H}" fill="{BG}"/>',
        f'<rect width="{W}" height="{H}" fill="url(#g1)"/>',
        f'<rect width="{W}" height="{H}" fill="url(#g2)"/>',
        # photo with the site's creamy-blue avatar ring
        f'<circle cx="{pcx}" cy="{pcy}" r="{pr + 16}" fill="{SURFACE_1}"/>',
        f'<circle cx="{pcx}" cy="{pcy}" r="{pr + 12}" fill="{ACCENT_SOFT}"/>',
        (f'<image x="{pcx - pr}" y="{pcy - pr}" width="{2 * pr}" height="{2 * pr}" clip-path="url(#pc)" '
         f'preserveAspectRatio="xMidYMid slice" xlink:href="data:image/png;base64,{photo}"/>'),
        # text column
        f'<path fill="{INK_1}" d="{f["display"].path(name, x, y_name, name_size, -0.01)}"/>',
        f'<rect x="{x}" y="{y_rule}" width="92" height="6" rx="3" fill="{TAN}"/>',
        f'<path fill="{CHESTNUT}" d="{f["text_semi"].path(role, x, y_role, role_size)}"/>',
    ]
    for i, line in enumerate(body):
        parts.append(f'<path fill="{INK_2}" d="{f["text"].path(line, x, y_body0 + i * lh, body_size)}"/>')
    # brand tile + URL
    ty = y_url - f["text_semi"].cap_height(url_size) / 2 - tile / 2
    parts.append(f'<rect x="{x}" y="{ty:.2f}" width="{tile}" height="{tile}" rx="{tile * 0.22:.2f}" fill="{ACCENT}"/>')
    parts.append(monogram(f, x + tile / 2, ty + tile / 2, tile, small=True))
    parts.append(f'<path fill="{ACCENT}" d="{f["text_semi"].path(url, url_x, y_url, url_size)}"/>')
    parts.append('</svg>')
    return "".join(parts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fonts", type=pathlib.Path, help="dir holding Fraunces.ttf and Figtree.ttf (variable)")
    ap.add_argument("--out", type=pathlib.Path, default=ROOT)
    a = ap.parse_args()
    f = load_fonts(a.fonts)
    out = a.out
    (out / "assets").mkdir(parents=True, exist_ok=True)

    # Scalable tab icon. Small sizes use the heavier optical size, no rule.
    svg = tile_svg(f, 64, radius=0.22, small=True)
    (out / "assets/favicon.svg").write_text(svg + "\n")

    # favicon.ico: each size drawn on its own so 16 px stays crisp.
    frames = [render(tile_svg(f, s * 8, radius=0.22, small=True), s) for s in (16, 32, 48)]
    frames[2].save(out / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)],
                   append_images=frames[:2])

    # Home-screen / manifest icons.
    render(tile_svg(f, 180, radius=0.0), 180).convert("RGB").save(out / "assets/apple-touch-icon.png", optimize=True)
    for s in (192, 512):
        render(tile_svg(f, s, radius=0.22), s).save(out / f"assets/icon-{s}.png", optimize=True)
    render(tile_svg(f, 512, radius=0.0, mark_scale=0.8), 512).convert("RGB").save(
        out / "assets/icon-maskable-512.png", optimize=True)

    # Share card.
    pic = Image.open(ROOT / "assets/profilepicture.webp").convert("RGB")
    b = io.BytesIO()
    pic.save(b, "PNG")
    card = render(share_card_svg(f, b.getvalue()), 1200, 627).convert("RGB")
    card.save(out / "assets/share-card.jpg", quality=90, optimize=True, progressive=True)
    print("built icons and share card in", out)


if __name__ == "__main__":
    main()
