"""Dependency-free image writers for PNG / JPG / 16-bit TIFF / half-float EXR.

All functions take a float array shaped (H, W, C) with C in {1, 3, 4} and values
nominally in 0..1 (EXR keeps values outside that range).
"""

import struct
import zlib

import numpy as np
from PIL import Image

FORMATS = ["png", "png16", "jpg", "tiff", "exr"]
EXTENSIONS = {"png": "png", "png16": "png", "jpg": "jpg", "tiff": "tif", "exr": "exr"}


def _as_hwc(arr):
    arr = np.asarray(arr, dtype=np.float32)
    if arr.ndim == 2:
        arr = arr[:, :, None]
    return arr


def srgb_to_linear(arr):
    arr = np.asarray(arr, dtype=np.float32)
    rgb = arr[..., :3]
    low = rgb / 12.92
    high = np.power(np.clip((rgb + 0.055) / 1.055, 0, None), 2.4)
    out = arr.copy()
    out[..., :3] = np.where(rgb <= 0.04045, low, high)
    return out


def _to_uint8(arr):
    return (np.clip(arr, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)


def write_png(arr, path, pnginfo=None, compress_level=4):
    arr = _as_hwc(arr)
    img = Image.fromarray(_to_uint8(arr if arr.shape[2] != 1 else arr[:, :, 0]))
    img.save(path, pnginfo=pnginfo, compress_level=compress_level)


def _png_chunk(cid, data):
    return (struct.pack(">I", len(data)) + cid + data
            + struct.pack(">I", zlib.crc32(cid + data) & 0xFFFFFFFF))


def write_png16(arr, path, pnginfo=None, compress_level=6):
    """16-bit-per-channel PNG (gray / RGB / RGBA), 'Up' row filter, text chunks kept."""
    arr = _as_hwc(arr)
    h, w, c = arr.shape
    color_type = {1: 0, 3: 2, 4: 6}.get(c)
    if color_type is None:
        arr, c, color_type = arr[:, :, :3], 3, 2
    rows = (np.clip(arr, 0.0, 1.0) * 65535.0 + 0.5).astype(">u2").reshape(h, w * c)
    rows = rows.view(np.uint8).reshape(h, w * c * 2)
    up = rows.copy()
    up[1:] = rows[1:] - rows[:-1]  # uint8 arithmetic wraps mod 256, as the filter requires
    raw = np.concatenate([np.full((h, 1), 2, np.uint8), up], axis=1).tobytes()

    out = [b"\x89PNG\r\n\x1a\n",
           _png_chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 16, color_type, 0, 0, 0))]
    for chunk in getattr(pnginfo, "chunks", None) or []:
        cid, data = chunk[0], chunk[1]
        if cid in (b"tEXt", b"zTXt", b"iTXt"):
            out.append(_png_chunk(cid, data))
    out.append(_png_chunk(b"IDAT", zlib.compress(raw, compress_level)))
    out.append(_png_chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(b"".join(out))


def write_jpg(arr, path, quality=95):
    arr = _as_hwc(arr)
    if arr.shape[2] == 4:
        arr = arr[:, :, :3]
    img = Image.fromarray(_to_uint8(arr if arr.shape[2] != 1 else arr[:, :, 0]))
    img.save(path, quality=int(quality), subsampling=0 if quality >= 90 else 2)


def write_tiff16(arr, path):
    """Uncompressed 16-bit-per-channel baseline TIFF (little endian)."""
    arr = _as_hwc(arr)
    h, w, c = arr.shape
    data = (np.clip(arr, 0.0, 1.0) * 65535.0 + 0.5).astype("<u2").tobytes()

    entries = []  # (tag, type, count, value_or_offset_payload)
    # layout: header(8) | bits array | image data | IFD
    bits_offset = 8
    bits_bytes = struct.pack("<%dH" % c, *([16] * c)) if c > 2 else b""
    data_offset = bits_offset + len(bits_bytes)
    ifd_offset = data_offset + len(data)
    if ifd_offset % 2:
        data += b"\0"
        ifd_offset += 1

    SHORT, LONG = 3, 4
    entries.append((256, LONG, 1, w))
    entries.append((257, LONG, 1, h))
    entries.append((258, SHORT, c, bits_offset if c > 2 else 16))
    entries.append((259, SHORT, 1, 1))                       # no compression
    entries.append((262, SHORT, 1, 2 if c >= 3 else 1))     # RGB / min-is-black
    entries.append((273, LONG, 1, data_offset))
    entries.append((277, SHORT, 1, c))
    entries.append((278, LONG, 1, h))
    entries.append((279, LONG, 1, w * h * c * 2))
    entries.append((284, SHORT, 1, 1))                       # chunky
    if c == 4:
        entries.append((338, SHORT, 1, 2))                   # unassociated alpha

    ifd = struct.pack("<H", len(entries))
    for tag, typ, count, value in entries:
        if typ == SHORT and count == 1:
            ifd += struct.pack("<HHIHH", tag, typ, count, value, 0)
        else:
            ifd += struct.pack("<HHII", tag, typ, count, value)
    ifd += struct.pack("<I", 0)

    with open(path, "wb") as f:
        f.write(b"II*\0" + struct.pack("<I", ifd_offset))
        f.write(bits_bytes)
        f.write(data)
        f.write(ifd)


def _exr_attr(name, typ, payload):
    return name.encode() + b"\0" + typ.encode() + b"\0" + struct.pack("<i", len(payload)) + payload


def write_exr(arr, path, linear=True):
    """Uncompressed scanline OpenEXR with HALF channels (R, G, B[, A])."""
    arr = _as_hwc(arr)
    if linear:
        arr = srgb_to_linear(arr)
    h, w, c = arr.shape
    if c == 1:
        names, planes = ["Y"], [arr[:, :, 0]]
    else:
        names = ["R", "G", "B"] + (["A"] if c == 4 else [])
        planes = [arr[:, :, i] for i in range(len(names))]
    order = sorted(range(len(names)), key=lambda i: names[i])  # EXR wants alphabetical
    names = [names[i] for i in order]
    planes = [planes[i].astype("<f2") for i in order]

    HALF = 1
    chlist = b"".join(n.encode() + b"\0" + struct.pack("<iB3xii", HALF, 0, 1, 1) for n in names) + b"\0"
    box = struct.pack("<iiii", 0, 0, w - 1, h - 1)
    header = (
        b"\x76\x2f\x31\x01" + struct.pack("<i", 2)
        + _exr_attr("channels", "chlist", chlist)
        + _exr_attr("compression", "compression", b"\0")
        + _exr_attr("dataWindow", "box2i", box)
        + _exr_attr("displayWindow", "box2i", box)
        + _exr_attr("lineOrder", "lineOrder", b"\0")
        + _exr_attr("pixelAspectRatio", "float", struct.pack("<f", 1.0))
        + _exr_attr("screenWindowCenter", "v2f", struct.pack("<ff", 0.0, 0.0))
        + _exr_attr("screenWindowWidth", "float", struct.pack("<f", 1.0))
        + b"\0"
    )
    line_bytes = w * 2 * len(names)
    block = 8 + line_bytes
    first = len(header) + 8 * h
    offsets = struct.pack("<%dQ" % h, *[first + y * block for y in range(h)])

    with open(path, "wb") as f:
        f.write(header)
        f.write(offsets)
        for y in range(h):
            f.write(struct.pack("<ii", y, line_bytes))
            for p in planes:
                f.write(p[y].tobytes())


def write_image(arr, path_no_ext, fmt, pnginfo=None, quality=95, linear_exr=True,
                png_compress=4):
    """Write arr in `fmt`; returns the file name with extension."""
    fmt = fmt if fmt in FORMATS else "png"
    path = f"{path_no_ext}.{EXTENSIONS[fmt]}"
    if fmt == "png":
        write_png(arr, path, pnginfo=pnginfo, compress_level=png_compress)
    elif fmt == "png16":
        write_png16(arr, path, pnginfo=pnginfo)
    elif fmt == "jpg":
        write_jpg(arr, path, quality=quality)
    elif fmt == "tiff":
        write_tiff16(arr, path)
    else:
        write_exr(arr, path, linear=linear_exr)
    return path
