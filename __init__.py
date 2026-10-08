"""ComfyUI LHS image nodes: Multi Image Batch (load many, pick & save), Image Guide Painter,
Image Compare."""

import os
import shutil

import numpy as np
from PIL import Image

import folder_paths
from aiohttp import web
from server import PromptServer

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS, SAVE_DIRS, safe_name, unique_path
from .writers import EXTENSIONS, FORMATS, write_image

WEB_DIRECTORY = "./js"


def _is_inside(base, path):
    base = os.path.abspath(base)
    path = os.path.abspath(path)
    try:
        return os.path.commonpath([base, path]) == base
    except ValueError:
        return False


def _load_float(png_path, raw_path):
    if raw_path and os.path.isfile(raw_path):
        return np.load(raw_path).astype(np.float32)
    img = Image.open(png_path)
    return np.asarray(img.convert("RGBA" if "A" in img.getbands() else "RGB"),
                      dtype=np.float32) / 255.0


@PromptServer.instance.routes.post("/lhs_multi_image_batch/save")
async def _mit_save_selected(request):
    """Write picked preview images into the output folder in the chosen format."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)

    items = data.get("images") or []
    prefix = (data.get("prefix") or "MultiImageBatch").strip() or "MultiImageBatch"
    fmt = data.get("format") if data.get("format") in FORMATS else "png"
    try:
        quality = max(1, min(100, int(data.get("jpg_quality", 95))))
    except (TypeError, ValueError):
        quality = 95
    linear = bool(data.get("exr_linear", True))

    output_dir = folder_paths.get_output_directory()
    try:
        full_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
            prefix, output_dir, 0, 0)
    except Exception as e:
        return web.json_response({"error": f"invalid filename_prefix: {e}"}, status=400)

    saved, skipped = [], []
    for it in items:
        kind = it.get("type", "temp")
        if kind not in ("temp", "output"):
            skipped.append(it.get("filename"))
            continue
        base = folder_paths.get_directory_by_type(kind)
        folder = os.path.join(base, it.get("subfolder") or "")
        src = os.path.join(folder, it.get("filename") or "")
        raw = os.path.join(folder, it["raw"]) if it.get("raw") else None
        if not _is_inside(base, src) or not os.path.isfile(src) or (raw and not _is_inside(base, raw)):
            skipped.append(it.get("filename"))
            continue
        save_dir = os.path.abspath(it.get("save_dir") or "")
        if it.get("save_dir") and save_dir in SAVE_DIRS:
            # folder chosen by the run (version folder / custom output folder)
            os.makedirs(save_dir, exist_ok=True)
            dst_base = os.path.join(save_dir, safe_name(it.get("save_name"), "image"))
            dst = unique_path(dst_base, EXTENSIONS[fmt])
            dst_base = dst[: -(len(EXTENSIONS[fmt]) + 1)]
            shown = dst
        else:
            dst_base = os.path.join(full_folder, f"{filename}_{counter:05}_")
            counter += 1
            shown = None
        try:
            if fmt == "png" and src.lower().endswith(".png"):
                dst = dst_base + ".png"
                shutil.copy2(src, dst)  # keeps the embedded workflow
            else:
                dst = write_image(_load_float(src, raw), dst_base, fmt,
                                  quality=quality, linear_exr=linear)
        except Exception as e:
            print(f"[LHS MultiImageBatch] save failed for {src}: {e}")
            skipped.append(it.get("filename"))
            continue
        saved.append({"filename": os.path.basename(dst), "subfolder": subfolder, "type": "output",
                      "path": shown or os.path.join(subfolder, os.path.basename(dst))})

    return web.json_response({"saved": saved, "skipped": skipped})


from . import compare_nodes as _compare, guide_nodes as _guide

for _m in (_guide, _compare):
    NODE_CLASS_MAPPINGS.update(_m.NODE_CLASS_MAPPINGS)
    NODE_DISPLAY_NAME_MAPPINGS.update(_m.NODE_DISPLAY_NAME_MAPPINGS)

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
