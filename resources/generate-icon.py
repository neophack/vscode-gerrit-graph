#!/usr/bin/env python3
"""Generate the Gerrit Graph extension icon (resources/icon.png).

Combines the Git Graph identity (three colored branch spines + green merge
line + commit nodes, same palette as resources/webview-icon.svg) with the
Gerrit identity used across this repo's icons (orange #e08c38 badge with a
white ring, see resources/gerrit-webview-icon.svg): the tip commit of the
graph becomes a Gerrit review badge with a white checkmark.

Usage: python resources/generate-icon.py
"""
import math

from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024          # final icon size
SS = 6               # supersampling factor for anti-aliasing
N = SIZE * SS        # working canvas size

# Palette (matches resources/webview-icon.svg / gerrit-*.svg)
BLUE = (0, 133, 217)      # #0085d9
PINK = (217, 0, 143)      # #d9008f
GRAY = (128, 128, 128)    # #808080
GREEN = (0, 217, 10)      # #00d90a
ORANGE = (224, 140, 56)   # #e08c38
BG_TOP = (42, 51, 70)     # #2A3346
BG_BOTTOM = (20, 26, 38)  # #141A26
WHITE = (255, 255, 255)

LW = 46 * SS              # branch line width
NODE_R = 80 * SS          # commit node radius
BADGE_R = 150 * SS        # gerrit badge radius

# Branch column x positions
X1, X2, X3 = 270 * SS, 530 * SS, 790 * SS


def vgradient(size, top, bottom):
    """Vertical gradient built small and upscaled (smooth + cheap)."""
    w = 8
    g = Image.new("RGB", (w, size[1]))
    d = ImageDraw.Draw(g)
    for y in range(size[1]):
        t = y / max(size[1] - 1, 1)
        d.line([(0, y), (w, y)], fill=tuple(
            round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return g.resize(size, Image.BICUBIC)


def bezier(p0, p1, p2, p3, n=240):
    """Sample a cubic bezier curve."""
    pts = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        pts.append((
            mt**3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t**3 * p3[0],
            mt**3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t**3 * p3[1],
        ))
    return pts


def stroke_path(draw, pts, width, fill):
    """Round-capped, round-joined thick path.

    Drawn as a normal-offset polygon plus join/cap circles instead of
    ImageDraw.line(width=...), whose per-segment parallelograms leave seams
    on dense polylines (visible as jagged edges after downscaling).
    """
    w2 = width / 2.0
    n = len(pts)
    left, right = [], []
    for i in range(n):
        a = pts[i - 1] if i > 0 else pts[i]
        b = pts[i + 1] if i < n - 1 else pts[i]
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy)
        nx, ny = (-dy / length * w2, dx / length * w2) if length else (0.0, 0.0)
        left.append((pts[i][0] + nx, pts[i][1] + ny))
        right.append((pts[i][0] - nx, pts[i][1] - ny))
    draw.polygon(left + right[::-1], fill=fill)
    # round joins and caps along the path
    step = max(1, n // 80)
    for i in list(range(0, n, step)) + ([n - 1] if (n - 1) % step else []):
        x, y = pts[i]
        draw.ellipse([x - w2, y - w2, x + w2, y + w2], fill=fill)


def add_shadow(layer, center, radius):
    """Blob on the (low-res) shadow layer: offset ellipse, blurred later."""
    d = ImageDraw.Draw(layer)
    x, y = center
    r = radius / SS_Q
    d.ellipse([x / SS_Q - r, (y + 20 * SS) / SS_Q - r,
               x / SS_Q + r, (y + 20 * SS) / SS_Q + r], fill=(0, 0, 0, 110))


SS_Q = 4  # shadow layer downscale factor (blurry content, no detail needed)


def main():
    # --- Background: rounded square with vertical gradient ---
    bg = vgradient((N, N), BG_TOP, BG_BOTTOM).convert("RGBA")
    mask = Image.new("L", (N, N), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, N - 1, N - 1], radius=170 * SS, fill=255)
    icon = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    icon.paste(bg, (0, 0), mask)
    d = ImageDraw.Draw(icon)

    # subtle inner highlight border
    inset = 14 * SS
    d.rounded_rectangle([inset, inset, N - 1 - inset, N - 1 - inset],
                        radius=(170 - 14) * SS, outline=(255, 255, 255, 22), width=5 * SS)

    # --- Soft drop shadows for the nodes and the gerrit badge ---
    badge_c = (X3, 800 * SS)
    shadows = Image.new("RGBA", (N // SS_Q, N // SS_Q), (0, 0, 0, 0))
    add_shadow(shadows, (X1, 560 * SS), NODE_R)
    add_shadow(shadows, (X2, 170 * SS), NODE_R)
    add_shadow(shadows, badge_c, BADGE_R)
    shadows = shadows.filter(ImageFilter.GaussianBlur(7)).resize((N, N), Image.BICUBIC)
    icon.alpha_composite(shadows)

    # --- Git graph ---
    # gray spine (old branch, column 1)
    stroke_path(d, [(X1, 130 * SS), (X1, 420 * SS)], LW, GRAY)
    # blue spine (column 1)
    stroke_path(d, [(X1, 640 * SS), (X1, 900 * SS)], LW, BLUE)
    # pink spine (column 2)
    stroke_path(d, [(X2, 170 * SS), (X2, 620 * SS)], LW, PINK)
    stroke_path(d, [(X2, 770 * SS), (X2, 900 * SS)], LW, PINK)
    # green spine (column 3) runs into the gerrit badge
    stroke_path(d, [(X3, 700 * SS), (X3, 800 * SS)], LW, GREEN)
    # green merge line from blue branch across to column 3
    merge = bezier((X1, 655 * SS), (X1, 760 * SS), (X3, 700 * SS), (X3, 735 * SS))
    stroke_path(d, merge, LW, GREEN)

    # --- Commit nodes ---
    d.ellipse([X1 - NODE_R, 560 * SS - NODE_R, X1 + NODE_R, 560 * SS + NODE_R], fill=BLUE)
    d.ellipse([X2 - NODE_R, 170 * SS - NODE_R, X2 + NODE_R, 170 * SS + NODE_R], fill=PINK)

    # --- Gerrit badge: tip commit under review (orange, white ring, check) ---
    d.ellipse([badge_c[0] - BADGE_R, badge_c[1] - BADGE_R,
               badge_c[0] + BADGE_R, badge_c[1] + BADGE_R], fill=ORANGE)
    d.ellipse([badge_c[0] - BADGE_R + 16 * SS, badge_c[1] - BADGE_R + 16 * SS,
               badge_c[0] + BADGE_R - 16 * SS, badge_c[1] + BADGE_R - 16 * SS],
              outline=WHITE, width=14 * SS)
    check = [(badge_c[0] - 62 * SS, badge_c[1] - 2 * SS),
             (badge_c[0] - 14 * SS, badge_c[1] + 48 * SS),
             (badge_c[0] + 70 * SS, badge_c[1] - 52 * SS)]
    stroke_path(d, check, 34 * SS, WHITE)

    icon = icon.resize((SIZE, SIZE), Image.LANCZOS)
    icon.save("resources/icon.png")
    print("written resources/icon.png", icon.size)


if __name__ == "__main__":
    main()
