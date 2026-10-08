"""
ComfyUI LHS Image Guide

Image Guide Painter (LHS): draw semi-transparent boxes, circles, pen strokes,
arrows and text on top of images (one or many) to show an edit model where and
what to change. The source images are never modified; the node outputs
  - org_image   : the untouched images
  - guide_image : copy of each image with the guides drawn on it
  - mask        : white where guides were drawn (boxes / circles fully filled)
"""

import json
import os
import random

import numpy as np
import torch
from PIL import Image, ImageOps

import folder_paths

from .guide_render import render_guides

CATEGORY = "LHS/Image Guide"


def _is_inside(base, path):
    base = os.path.abspath(base)
    path = os.path.abspath(path)
    try:
        return os.path.commonpath([base, path]) == base
    except ValueError:
        return False


def _load_source(rel):
    rel = (rel or "").strip().strip('"')
    base = folder_paths.get_input_directory()
    path = rel if os.path.isabs(rel) else os.path.join(base, rel)
    if not os.path.isabs(rel) and not _is_inside(base, path):
        raise ValueError(f"[Image Guide Painter] Invalid path: {rel}")
    if not os.path.isfile(path):
        raise FileNotFoundError(f"[Image Guide Painter] Image not found: {rel}")
    img = ImageOps.exif_transpose(Image.open(path))
    if img.mode == "I":
        img = img.point(lambda i: i * (1 / 255))
    arr = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
    return torch.from_numpy(arr)[None], os.path.splitext(os.path.basename(path))[0]


def parse_guides(text):
    try:
        data = json.loads(text) if text else {}
    except (TypeError, ValueError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    items = data.get("items") if isinstance(data.get("items"), dict) else {}
    return bool(data.get("shared")), items


def shapes_for(items, shared, key, index, present_keys):
    """Guides for one image: shared set, else by name, else by position."""
    if shared:
        return (items.get("*") or {}).get("shapes") or []
    entry = items.get(key)
    if entry:
        return entry.get("shapes") or []
    for k, entry in items.items():
        if k != "*" and k not in present_keys and entry.get("i") == index:
            return entry.get("shapes") or []
    return []


class ImageGuidePainter:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "guides": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "tooltip": "Drawn guides (edited with the Draw guides button).",
                }),
            },
            "optional": {
                "image": ("IMAGE", {"tooltip": "Images to draw on (a single image, a batch "
                                               "or the list from Multi Image Loader)."}),
                "labels": ("STRING", {"forceInput": True,
                                      "tooltip": "Optional names for the images (connect "
                                                 "'filenames' from Multi Image Loader) so "
                                                 "guides stay with the right image even if "
                                                 "the order changes."}),
                "source_image": ("STRING", {
                    "default": "",
                    "tooltip": "Used when nothing is connected to 'image'. Filled by the "
                               "Load image button (path relative to ComfyUI/input).",
                }),
            },
        }

    INPUT_IS_LIST = True
    RETURN_TYPES = ("IMAGE", "IMAGE", "MASK")
    RETURN_NAMES = ("org_image", "guide_image", "mask")
    OUTPUT_IS_LIST = (True, True, True)
    OUTPUT_TOOLTIPS = (
        "The original images, untouched.",
        "Images with the guides drawn on them.",
        "White where guides were drawn (boxes and circles fully filled).",
    )
    FUNCTION = "run"
    CATEGORY = CATEGORY
    DESCRIPTION = ("Draw boxes, circles, pen strokes, arrows and text on images to mark "
                   "what an edit model should change. Originals are never modified.")

    def run(self, guides, image=None, labels=None, source_image=None):
        shared, items = parse_guides(guides[0] if guides else "")

        frames, keys = [], []
        if image:
            for i, batch in enumerate(image):
                base = str(labels[i]) if labels and i < len(labels) else f"#{i + 1}"
                for b in range(batch.shape[0]):
                    frames.append(batch[b])
                    keys.append(base if batch.shape[0] == 1 else f"{base} [{b + 1}]")
        else:
            src = source_image[0] if source_image else ""
            if not src:
                raise ValueError("[Image Guide Painter] No image. Connect an image or "
                                 "use the Load image button.")
            tensor, name = _load_source(src)
            frames.append(tensor[0])
            keys.append(name)

        present = set(keys)
        temp_dir = folder_paths.get_temp_directory()
        tag = "lhs_guide_" + "".join(random.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(6))
        out_imgs, out_masks, originals, sources = [], [], [], []
        for idx, (frame, key) in enumerate(zip(frames, keys)):
            arr = frame.cpu().numpy().astype(np.float32)
            shapes = shapes_for(items, shared, key, idx, present)
            guided, mask = render_guides(arr, shapes)
            out_imgs.append(torch.from_numpy(guided)[None])
            out_masks.append(torch.from_numpy(mask)[None])
            originals.append(frame[None])

            # small copy of the source so the editor can show it after a run
            fname = f"{tag}_{idx:04d}.png"
            prev = Image.fromarray((np.clip(arr[:, :, :3], 0, 1) * 255 + 0.5).astype(np.uint8))
            prev.save(os.path.join(temp_dir, fname), compress_level=1)
            sources.append({"filename": fname, "subfolder": "", "type": "temp",
                            "key": key, "i": idx})

        return {"ui": {"lhs_sources": sources},
                "result": (originals, out_imgs, out_masks)}


NODE_CLASS_MAPPINGS = {"LHS_ImageGuidePainter": ImageGuidePainter}
NODE_DISPLAY_NAME_MAPPINGS = {"LHS_ImageGuidePainter": "Image Guide Painter (LHS)"}
