"""Render guide shapes onto an image.

Shapes are stored resolution-independent:
  - points are normalized (0..1) to image width / height
  - "width" (stroke) is a fraction of the image width
  - "size" (text height) is a fraction of the image height

Every shape is drawn opaque into its own mask and then composited with its
opacity, so overlapping parts of one pen stroke don't get darker. The canvas
preview in the editor uses exactly the same rule.
"""

import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

_FONT_CACHE = {}
_FONT_CANDIDATES = [
    os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", "malgun.ttf"),
    os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", "malgunbd.ttf"),
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def _font(px):
    px = max(6, int(px))
    if px in _FONT_CACHE:
        return _FONT_CACHE[px]
    font = None
    for path in _FONT_CANDIDATES:
        if os.path.isfile(path):
            try:
                font = ImageFont.truetype(path, px)
                break
            except Exception:
                continue
    if font is None:
        try:
            font = ImageFont.load_default(size=px)
        except TypeError:  # Pillow < 10.1
            font = ImageFont.load_default()
    _FONT_CACHE[px] = font
    return font


def _hex_rgb(color):
    c = str(color or "#ff0000").lstrip("#")
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    try:
        return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return (255, 0, 0)


def _clamp01(v, default):
    try:
        return max(0.0, min(1.0, float(v)))
    except (TypeError, ValueError):
        return default


def _arrow_head(x0, y0, x1, y1, w, W):
    """Triangle at (x1, y1) pointing away from (x0, y0)."""
    ang = math.atan2(y1 - y0, x1 - x0)
    length = max(w * 4.0, 0.012 * W)
    spread = math.radians(28)
    left = (x1 - length * math.cos(ang - spread), y1 - length * math.sin(ang - spread))
    right = (x1 - length * math.cos(ang + spread), y1 - length * math.sin(ang + spread))
    base = (x1 - length * 0.8 * math.cos(ang), y1 - length * 0.8 * math.sin(ang))
    return [(x1, y1), left, right], base


def _draw_shape(draw_vis, draw_reg, shape, W, H):
    """Draw one shape (opaque, 255) into the visible mask and the region mask."""
    t = shape.get("type")
    pts = [(float(p[0]) * W, float(p[1]) * H) for p in shape.get("pts") or []]
    w = max(1.0, float(shape.get("width", 0.006)) * W)
    wi = int(round(w))
    if not pts:
        return

    if t in ("rect", "ellipse") and len(pts) >= 2:
        (x0, y0), (x1, y1) = pts[0], pts[-1]
        box = [min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)]
        fn_v = draw_vis.rectangle if t == "rect" else draw_vis.ellipse
        fn_r = draw_reg.rectangle if t == "rect" else draw_reg.ellipse
        if shape.get("fill", True):
            fn_v(box, fill=255)
        else:
            fn_v(box, outline=255, width=max(1, wi))
        fn_r(box, fill=255)  # mask always covers the whole marked area

    elif t == "pen":
        for d in (draw_vis, draw_reg):
            if len(pts) > 1:
                d.line(pts, fill=255, width=wi, joint="curve")
            r = w / 2.0
            for (x, y) in (pts[0], pts[-1]) if len(pts) > 1 else pts:
                d.ellipse([x - r, y - r, x + r, y + r], fill=255)

    elif t == "arrow" and len(pts) >= 2:
        (x0, y0), (x1, y1) = pts[0], pts[-1]
        head, base = _arrow_head(x0, y0, x1, y1, w, W)
        for d in (draw_vis, draw_reg):
            d.line([(x0, y0), base], fill=255, width=wi)
            r = w / 2.0
            d.ellipse([x0 - r, y0 - r, x0 + r, y0 + r], fill=255)
            d.polygon(head, fill=255)

    elif t == "text":
        text = str(shape.get("text") or "")
        if not text:
            return
        px = max(6.0, float(shape.get("size", 0.05)) * H)
        font = _font(px)
        x, y = pts[0]
        try:
            ascent = font.getmetrics()[0]
        except Exception:
            ascent = px * 0.9
        # same layout as the editor: first baseline at top + ascent, 1.2 x size per line
        for i, line in enumerate(text.split("\n")):
            if not line:
                continue
            base = (x, y + ascent + i * px * 1.2)
            try:
                draw_vis.text(base, line, font=font, fill=255, anchor="ls")
                draw_reg.rectangle(draw_vis.textbbox(base, line, font=font, anchor="ls"), fill=255)
            except (ValueError, TypeError):  # bitmap fallback font: no anchors
                draw_vis.text((x, y + i * px * 1.2), line, font=font, fill=255)
                draw_reg.rectangle(draw_vis.textbbox((x, y + i * px * 1.2), line, font=font), fill=255)


def render_guides(image, shapes):
    """image: float32 (H, W, C) 0..1.  Returns (guided image, mask float (H, W))."""
    img = np.clip(np.asarray(image, dtype=np.float32), 0.0, 1.0)
    H, W = img.shape[:2]
    out = img[:, :, :3].copy()
    region = np.zeros((H, W), dtype=np.float32)
    if not shapes:
        if img.shape[2] > 3:
            out = np.concatenate([out, img[:, :, 3:]], axis=2)
        return out, region

    # draw masks at 2x for smooth edges (1x for very large images)
    s = 2 if max(W, H) <= 3072 else 1
    for shape in shapes:
        vis = Image.new("L", (W * s, H * s), 0)
        reg = Image.new("L", (W * s, H * s), 0)
        _draw_shape(ImageDraw.Draw(vis), ImageDraw.Draw(reg), shape, W * s, H * s)
        if s != 1:
            vis = vis.resize((W, H), Image.LANCZOS)
            reg = reg.resize((W, H), Image.LANCZOS)
        a = np.asarray(vis, dtype=np.float32) / 255.0 * _clamp01(shape.get("opacity"), 0.45)
        rgb = np.array(_hex_rgb(shape.get("color")), dtype=np.float32) / 255.0
        out = out * (1.0 - a[:, :, None]) + rgb[None, None, :] * a[:, :, None]
        region = np.maximum(region, np.asarray(reg, dtype=np.float32) / 255.0)

    if img.shape[2] > 3:
        out = np.concatenate([out, img[:, :, 3:]], axis=2)
    return np.clip(out, 0.0, 1.0), np.clip(region, 0.0, 1.0)
