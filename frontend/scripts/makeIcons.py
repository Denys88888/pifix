#!/usr/bin/env python3
"""
Renders the PiFix app icon to PNG.

The mark is the same one as `public/favicon.svg` — a green pi whose right leg
bends into a pipe elbow — redrawn here because the Developer Portal and Android
both want raster icons and neither will take the SVG. Keeping one geometry in
two files is a real risk, so the coordinates below are the favicon's 64-unit
grid multiplied by 16; change one and change the other.

    python3 scripts/makeIcons.py

Writes public/icon-{1024,512,192,180}.png. Committed output, so this only has
to run when the mark itself changes.
"""
from PIL import Image, ImageDraw

BASE = 1024
SS = 4  # supersample; PIL has no antialiased drawing of its own
N = BASE * SS

BG_TOP = (31, 31, 58)
BG_BOTTOM = (20, 20, 42)
ACCENT = (76, 175, 80, 255)

CORNER = 224
STROKE = 80


def s(v: float) -> int:
    return round(v * SS)


def cap(draw: ImageDraw.ImageDraw, x: float, y: float) -> None:
    """Round line cap. PIL's line() has none."""
    r = STROKE / 2
    draw.ellipse([s(x - r), s(y - r), s(x + r), s(y + r)], fill=ACCENT)


def stroke(draw: ImageDraw.ImageDraw, x1: float, y1: float, x2: float, y2: float) -> None:
    draw.line([s(x1), s(y1), s(x2), s(y2)], fill=ACCENT, width=s(STROKE))
    cap(draw, x1, y1)
    cap(draw, x2, y2)


def build() -> Image.Image:
    # Vertical gradient, then a rounded-rect mask. Drawn full-bleed so a
    # circular or squircle platform mask never exposes a transparent corner.
    bg = Image.new('RGB', (1, BASE))
    for y in range(BASE):
        t = y / (BASE - 1)
        bg.putpixel((0, y), tuple(
            round(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM)
        ))
    canvas = bg.resize((N, N), Image.BILINEAR).convert('RGBA')

    mask = Image.new('L', (N, N), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, N - 1, N - 1], radius=s(CORNER), fill=255)

    draw = ImageDraw.Draw(canvas)
    stroke(draw, 256, 352, 768, 352)   # the bar
    stroke(draw, 400, 352, 400, 704)   # left leg
    stroke(draw, 624, 352, 624, 640)   # right leg, down to the elbow

    # Elbow: quarter turn of radius 64 centred at (688, 640). PIL measures
    # clockwise from 3 o'clock with y pointing down, so 90..180 is the
    # bottom-left quarter — left end at (624,640), bottom end at (688,704).
    draw.arc(
        [s(688 - 64 - STROKE / 2), s(640 - 64 - STROKE / 2),
         s(688 + 64 + STROKE / 2), s(640 + 64 + STROKE / 2)],
        90, 180, fill=ACCENT, width=s(STROKE),
    )
    stroke(draw, 688, 704, 736, 704)   # the spout

    canvas.putalpha(mask)
    return canvas.resize((BASE, BASE), Image.LANCZOS)


def main() -> None:
    icon = build()
    for size in (1024, 512, 192, 180):
        out = f'public/icon-{size}.png'
        (icon if size == BASE else icon.resize((size, size), Image.LANCZOS)).save(out)
        print(f'wrote {out}')


if __name__ == '__main__':
    main()
