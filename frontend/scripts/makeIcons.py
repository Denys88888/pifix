#!/usr/bin/env python3
"""
Renders the PiFix app icon to PNG.

The mark is the same one as `public/favicon.svg` — an open-ended spanner —
redrawn here because the Developer Portal and Android both want raster icons
and neither will take the SVG. Keeping one geometry in two files is a real
risk, so the coordinates below are the favicon's 64-unit grid multiplied by 16;
change one and change the other.

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

# The spanner, drawn upright and then turned. Head is a ring with a wedge
# missing (the jaw); the handle runs down from inside it so the join needs no
# extra geometry. Everything stays within 281px of the centre, well inside the
# 40 % radius Android crops a maskable icon to.
HEAD_CY = 387
HEAD_R = 118        # centreline radius of the ring
STROKE = 76         # ring thickness, and the handle's width
JAW_DEG = 62        # angular size of the opening, centred on 12 o'clock
HANDLE_END = 793
# PIL turns anticlockwise on a positive angle and SVG turns clockwise, so this
# is `rotate(-45 …)` in favicon.svg for the same picture: jaw at the top left.
TILT = 45


def s(v: float) -> int:
    return round(v * SS)


def glyph() -> Image.Image:
    layer = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    # PIL measures clockwise from 3 o'clock with y pointing down, so 270 is the
    # top; the arc runs the long way round and leaves JAW_DEG uncovered there.
    half = JAW_DEG / 2
    draw.arc(
        [s(512 - HEAD_R), s(HEAD_CY - HEAD_R), s(512 + HEAD_R), s(HEAD_CY + HEAD_R)],
        270 + half, 270 - half, fill=ACCENT, width=s(STROKE),
    )

    # Starts at the ring's inner edge: the rounded cap on that end lands inside
    # the ring's own stroke and disappears into it.
    draw.rounded_rectangle(
        [s(512 - STROKE / 2), s(HEAD_CY + HEAD_R - STROKE / 2),
         s(512 + STROKE / 2), s(HANDLE_END)],
        radius=s(STROKE / 2), fill=ACCENT,
    )

    return layer.rotate(TILT, resample=Image.BICUBIC, center=(N / 2, N / 2))


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
    canvas.alpha_composite(glyph())

    mask = Image.new('L', (N, N), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, N - 1, N - 1], radius=s(CORNER), fill=255)
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
