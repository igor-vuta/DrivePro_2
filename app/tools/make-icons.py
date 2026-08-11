#!/usr/bin/env python3
"""DrivePro icon pipeline - renders the brand mark and every size the app
ships: Expo native icon, Android adaptive foreground, PWA icons, apple-touch
icon and favicon.

The mark: a blue portal ring interlocked with a perspective road (behind the
ring at the horizon, in front at the bottom), yellow centre dashes, a crimson
echo trail, on white. Colours are Almaty's own - taken from the city's coat of
arms. Supersampled 2x for smooth edges.

Light ground, so the glow layers the first version relied on are gone: glow
over near-white reads as blur rather than light. Depth comes from the slate
road against the white instead.

Usage: python3 tools/make-icons.py   (from app/; needs Pillow + numpy)
"""
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter
import numpy as np

APP = Path(__file__).resolve().parents[1]

F = 2                          # supersample factor
S = 1024 * F
BG = (255, 254, 255, 255)      # #FFFEFF
BLUE = (0, 143, 210)           # #008FD2
CRIMSON = (232, 51, 121)       # #E83379
YELLOW = (255, 239, 1)         # #FFEF01
SLATE = (68, 84, 108)          # #44546C

# Kept as aliases so the drawing code below reads unchanged.
CYAN = BLUE
MAGENTA = CRIMSON
GOLD = YELLOW
GRID = SLATE

RC = (512 * F, 452 * F)        # ring center
R_MID = 264 * F                # ring centerline radius
RW = 70 * F                    # ring stroke width

ROAD_HALF_BOT, ROAD_HALF_TOP = 250 * F, 30 * F
ROAD_TOP_Y = 448 * F
CROSS_Y = 744 * F              # below this the road repaints in front
FEATHER = 40 * F


def layer():
    return Image.new('RGBA', (S, S), (0, 0, 0, 0))


def ring_layer(color, width=RW):
    im = layer()
    d = ImageDraw.Draw(im)
    r = R_MID + width // 2
    d.ellipse([RC[0] - r, RC[1] - r, RC[0] + r, RC[1] + r], outline=color, width=width)
    return im


def road_half(y):
    t = (S - y) / (S - ROAD_TOP_Y)
    return ROAD_HALF_BOT + (ROAD_HALF_TOP - ROAD_HALF_BOT) * t


def capped_line(d, p0, p1, color, w):
    d.line([p0, p1], fill=color, width=w)
    for (x, y) in (p0, p1):
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=color)


def build_road():
    road = layer()
    rd = ImageDraw.Draw(road)
    lb, rb = 512 * F - ROAD_HALF_BOT, 512 * F + ROAD_HALF_BOT
    lt, rt = 512 * F - ROAD_HALF_TOP, 512 * F + ROAD_HALF_TOP
    fill = SLATE + (255,)
    rd.polygon([(lb, S), (rb, S), (rt, ROAD_TOP_Y), (lt, ROAD_TOP_Y)], fill=fill)
    rd.ellipse([lt, ROAD_TOP_Y - ROAD_HALF_TOP, rt, ROAD_TOP_Y + ROAD_HALF_TOP], fill=fill)

    edges = layer()
    ed = ImageDraw.Draw(edges)
    w = 9 * F
    capped_line(ed, (lb, S + w), (lt + 2 * F, ROAD_TOP_Y), BLUE + (255,), w)
    capped_line(ed, (rb, S + w), (rt - 2 * F, ROAD_TOP_Y), BLUE + (255,), w)
    road.alpha_composite(edges)

    dash = layer()
    dd = ImageDraw.Draw(dash)
    for y_bot, h in ((984, 88), (844, 64), (722, 46), (620, 30)):
        y_bot, h = y_bot * F, h * F
        w = min(19 * F, max(8 * F, int(road_half(y_bot) * 0.095)))
        dd.rounded_rectangle([512 * F - w, y_bot - h, 512 * F + w, y_bot],
                             radius=w, fill=GOLD + (255,))
    road.alpha_composite(dash)
    return road


def radial_glow(center, radius, color, max_alpha):
    yy, xx = np.mgrid[0:S, 0:S]
    r = np.sqrt((xx - center[0]) ** 2 + (yy - center[1]) ** 2) / radius
    a = np.clip(1 - r, 0, 1) ** 2 * max_alpha
    im = np.zeros((S, S, 4), dtype=np.uint8)
    im[..., 0], im[..., 1], im[..., 2] = color
    im[..., 3] = a.astype(np.uint8)
    return Image.fromarray(im, 'RGBA')


def build(size=1024, fg_only=False):
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0) if fg_only else BG)

    # No background glow or grid on a light ground - it only muddies the white.

    road = build_road()
    img.alpha_composite(road)

    echo = ring_layer(CRIMSON + (200,))
    echo = echo.transform((S, S), Image.AFFINE, (1, 0, -30 * F, 0, 1, -16 * F))
    img.alpha_composite(echo)
    # A soft drop shadow gives the ring depth without glow.
    shadow = ring_layer(SLATE + (70,)).transform((S, S), Image.AFFINE, (1, 0, 0, 0, 1, -8 * F))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(10 * F)))
    img.alpha_composite(ring_layer(BLUE + (255,)))

    front = road.copy()
    fade = Image.new('L', (S, S), 0)
    fd = ImageDraw.Draw(fade)
    fd.rectangle([0, CROSS_Y + FEATHER, S, S], fill=255)
    for i in range(FEATHER):
        fd.line([(0, CROSS_Y + i), (S, CROSS_Y + i)], fill=int(255 * i / FEATHER))
    a = np.array(front.getchannel('A'), dtype=np.uint16)
    m = np.array(fade, dtype=np.uint16)
    front.putalpha(Image.fromarray((a * m // 255).astype(np.uint8)))
    img.alpha_composite(front)

    return img.resize((size, size), Image.LANCZOS)


def main():
    assets = APP / 'assets'
    icons = APP / 'public' / 'icons'
    os.makedirs(assets, exist_ok=True)
    os.makedirs(icons, exist_ok=True)

    master = build(1024)
    flat = Image.new('RGB', master.size, BG[:3])      # opaque (iOS requires)
    flat.paste(master, (0, 0), master)

    flat.save(assets / 'icon.png')                    # expo native icon
    build(1024, fg_only=True).save(assets / 'adaptive-icon.png')
    flat.resize((48, 48), Image.LANCZOS).save(assets / 'favicon.png')

    for sz in (192, 512):
        flat.resize((sz, sz), Image.LANCZOS).save(icons / f'icon-{sz}.png')
    flat.resize((180, 180), Image.LANCZOS).save(APP / 'public' / 'apple-touch-icon.png')
    flat.resize((48, 48), Image.LANCZOS).save(
        APP / 'public' / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
    print('icons written to app/assets and app/public')


if __name__ == '__main__':
    main()
