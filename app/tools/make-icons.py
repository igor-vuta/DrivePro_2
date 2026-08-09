#!/usr/bin/env python3
"""DrivePro icon pipeline - renders the brand mark and every size the app
ships: Expo native icon, Android adaptive foreground, PWA icons, apple-touch
icon and favicon.

The mark: neon cyan portal ring interlocked with a perspective road (behind
the ring at the horizon, in front at the bottom), gold center dashes, magenta
echo trail, deep night #06070d. Supersampled 2x for smooth edges.

Usage: python3 tools/make-icons.py   (from app/; needs Pillow + numpy)
"""
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter
import numpy as np

APP = Path(__file__).resolve().parents[1]

F = 2                          # supersample factor
S = 1024 * F
BG = (6, 7, 13, 255)           # #06070d
CYAN = (0, 229, 255)           # #00e5ff
MAGENTA = (255, 43, 214)       # #ff2bd6
GOLD = (245, 197, 24)          # #f5c518
GRID = (28, 36, 56)            # #1c2438

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
    fill = (16, 24, 44, 235)
    rd.polygon([(lb, S), (rb, S), (rt, ROAD_TOP_Y), (lt, ROAD_TOP_Y)], fill=fill)
    rd.ellipse([lt, ROAD_TOP_Y - ROAD_HALF_TOP, rt, ROAD_TOP_Y + ROAD_HALF_TOP], fill=fill)

    edges = layer()
    ed = ImageDraw.Draw(edges)
    w = 9 * F
    capped_line(ed, (lb, S + w), (lt + 2 * F, ROAD_TOP_Y), CYAN + (215,), w)
    capped_line(ed, (rb, S + w), (rt - 2 * F, ROAD_TOP_Y), CYAN + (215,), w)
    road.alpha_composite(edges.filter(ImageFilter.GaussianBlur(9 * F)))
    road.alpha_composite(edges)

    dash = layer()
    dd = ImageDraw.Draw(dash)
    for y_bot, h in ((984, 88), (844, 64), (722, 46), (620, 30)):
        y_bot, h = y_bot * F, h * F
        w = min(19 * F, max(8 * F, int(road_half(y_bot) * 0.095)))
        dd.rounded_rectangle([512 * F - w, y_bot - h, 512 * F + w, y_bot],
                             radius=w, fill=GOLD + (255,))
    road.alpha_composite(dash.filter(ImageFilter.GaussianBlur(8 * F)).point(lambda p: p * 0.55))
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

    if not fg_only:
        img.alpha_composite(radial_glow((512 * F, 600 * F), 780 * F, CYAN, 26))
        img.alpha_composite(radial_glow((790 * F, 210 * F), 500 * F, MAGENTA, 18))
        g = layer()
        gd = ImageDraw.Draw(g)
        for t in (-1.0, -0.55, 0.55, 1.0):
            gd.line([(512 * F, 470 * F), (int((512 + t * 980) * F), S)],
                    fill=GRID + (60,), width=3 * F)
        for i, yy in enumerate((700, 810, 930)):
            gd.line([(0, yy * F), (S, yy * F)], fill=GRID + (46 - i * 12,), width=2 * F)
        img.alpha_composite(g.filter(ImageFilter.GaussianBlur(F)))

    road = build_road()
    img.alpha_composite(road)

    echo = ring_layer(MAGENTA + (175,))
    echo = echo.transform((S, S), Image.AFFINE, (1, 0, -28 * F, 0, 1, -15 * F))
    img.alpha_composite(echo.filter(ImageFilter.GaussianBlur(6 * F)))
    for blur, alpha in ((54, 95), (20, 125)):
        img.alpha_composite(ring_layer(CYAN + (alpha,)).filter(ImageFilter.GaussianBlur(blur * F)))
    img.alpha_composite(ring_layer(CYAN + (255,)))
    img.alpha_composite(ring_layer((240, 255, 255, 195), width=14 * F)
                        .filter(ImageFilter.GaussianBlur(F)))

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
