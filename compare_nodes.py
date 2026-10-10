"""
Image Compare (LHS): compare two images (or two lists of images) with clear A / B
labels. Slider, side by side, flip and difference views; full screen with zoom.
The images are only previewed (saved to ComfyUI's temp folder).
"""

import os
import random

import numpy as np
from PIL import Image

import folder_paths

CATEGORY = "LHS/Image Compare"


def _frames(images):
    out = []
    for batch in images or []:
        for b in range(batch.shape[0]):
            out.append(batch[b])
    return out


def _save(t, prefix, idx):
    arr = t.cpu().numpy()
    if arr.ndim == 3 and arr.shape[-1] == 1:
        arr = np.repeat(arr, 3, axis=-1)
    arr = (np.clip(arr[..., :4], 0, 1) * 255 + 0.5).astype(np.uint8)
    name = f"{prefix}_{idx:04d}.png"
    Image.fromarray(arr).save(os.path.join(folder_paths.get_temp_directory(), name), compress_level=1)
    return {"filename": name, "subfolder": "", "type": "temp",
            "w": int(arr.shape[1]), "h": int(arr.shape[0])}


class ImageCompare:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image_a": ("IMAGE", {"tooltip": "Image A (blue). A list or batch is compared pair by pair."}),
                "image_b": ("IMAGE", {"tooltip": "Image B (orange)."}),
                "label_a": ("STRING", {"default": "", "tooltip": "Name shown for A. Empty = name of the "
                                                                 "connected node / file."}),
                "label_b": ("STRING", {"default": "", "tooltip": "Name shown for B. Empty = name of the "
                                                                 "connected node / file."}),
            },
            "optional": {
                "labels": ("STRING", {"forceInput": True,
                                      "tooltip": "Optional name per pair (e.g. 'filenames' from "
                                                 "Multi Image Loader). Connected automatically."}),
            },
        }

    INPUT_IS_LIST = True
    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = "run"
    CATEGORY = CATEGORY
    DESCRIPTION = ("Compare A and B with clear labels: slider, side by side, flip (A/B toggle) "
                   "and difference views. Double-click the view for full screen with zoom.")

    def run(self, image_a, image_b, label_a=None, label_b=None, labels=None):
        a, b = _frames(image_a), _frames(image_b)
        n = max(len(a), len(b))
        prefix = f"lhs_cmp_{random.randrange(16 ** 8):08x}"
        pairs = []
        per_input = len(image_a or []) == n or len(image_b or []) == n
        for i in range(n):
            fa = a[min(i, len(a) - 1)] if a else None
            fb = b[min(i, len(b) - 1)] if b else None
            name = ""
            if labels and per_input and i < len(labels):
                name = str(labels[i])
            elif labels and len(labels) == 1:
                name = str(labels[0])
            pairs.append({
                "a": _save(fa, prefix + "_a", i) if fa is not None else None,
                "b": _save(fb, prefix + "_b", i) if fb is not None else None,
                "name": name,
            })
        la = (label_a or [""])[0] or ""
        lb = (label_b or [""])[0] or ""
        return {"ui": {"lhs_compare": pairs, "lhs_compare_labels": [la, lb]}}


NODE_CLASS_MAPPINGS = {"LHS_ImageCompare": ImageCompare}
NODE_DISPLAY_NAME_MAPPINGS = {"LHS_ImageCompare": "💎 Image Compare (LHS)"}
