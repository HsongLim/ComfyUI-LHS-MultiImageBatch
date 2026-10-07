"""
ComfyUI LHS Multi Image Batch

- MultiImageLoader : load many images at once and output them as a LIST,
                     so every downstream node runs once per image (sequentially).
- MultiImagePicker : collect all results in one grid, pick the ones you like
                     and save only those (or save everything).
"""

import hashlib
import json
import os
import random
import re

import numpy as np
import torch
from PIL import Image, ImageOps
from PIL.PngImagePlugin import PngInfo

import folder_paths

from .writers import FORMATS, write_image

try:
    from comfy.cli_args import args as _comfy_args
except Exception:  # pragma: no cover
    _comfy_args = None

CATEGORY = "LHS/Multi Image Batch"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif"}

# Folders a run is allowed to 'Save selected' into (filled by the picker, checked
# by the /lhs_multi_image_batch/save route so the HTTP endpoint can't write elsewhere).
SAVE_DIRS = set()
_RESERVED_VERSIONS = set()
_INVALID_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _natural_key(text):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", text)]


def _is_inside(base, path):
    base = os.path.abspath(base)
    path = os.path.abspath(path)
    try:
        return os.path.commonpath([base, path]) == base
    except ValueError:  # different drives on Windows
        return False


def _paths_from_list(images_text):
    """Lines are paths relative to ComfyUI/input (what the upload button writes)."""
    base = folder_paths.get_input_directory()
    paths = []
    for line in (images_text or "").splitlines():
        line = line.strip().strip('"')
        if not line:
            continue
        if os.path.isabs(line):
            path = line
        else:
            path = os.path.join(base, line)
            if not _is_inside(base, path):
                raise ValueError(f"[Multi Image Loader] Invalid path: {line}")
        if not os.path.isfile(path):
            raise FileNotFoundError(f"[Multi Image Loader] Image not found: {line}")
        paths.append(path)
    return paths


def _paths_from_folder(folder):
    folder = (folder or "").strip().strip('"')
    if not folder:
        return []
    if not os.path.isabs(folder):
        folder = os.path.join(folder_paths.get_input_directory(), folder)
    if not os.path.isdir(folder):
        raise FileNotFoundError(f"[Multi Image Loader] Folder not found: {folder}")
    names = [
        n for n in os.listdir(folder)
        if os.path.splitext(n)[1].lower() in IMAGE_EXTENSIONS
        and os.path.isfile(os.path.join(folder, n))
    ]
    names.sort(key=_natural_key)
    return [os.path.join(folder, n) for n in names]


def _collect_paths(images, folder, start_index, max_images):
    paths = _paths_from_list(images) + _paths_from_folder(folder)
    start_index = max(0, int(start_index or 0))
    paths = paths[start_index:]
    if max_images and max_images > 0:
        paths = paths[: int(max_images)]
    return paths


def safe_name(text, fallback="image"):
    text = _INVALID_CHARS.sub("_", str(text)).strip(" .")
    return text[:120] or fallback


def unique_path(path_no_ext, ext):
    path = f"{path_no_ext}.{ext}"
    n = 2
    while os.path.exists(path):
        path = f"{path_no_ext}_{n}.{ext}"
        n += 1
    return path


def _resolve_base(output_folder, prefix):
    """Root folder (custom or ComfyUI output) + sanitized prefix sub-folders."""
    root = (output_folder or "").strip().strip('"')
    out_dir = folder_paths.get_output_directory()
    if not root:
        root = out_dir
    elif not os.path.isabs(root):
        root = os.path.join(out_dir, root)
    parts = [safe_name(p, "") for p in re.split(r"[\\/]", prefix or "")]
    parts = [p for p in parts if p and p != ".."]
    return os.path.abspath(root), parts


def _next_version_dir(base):
    nums = []
    if os.path.isdir(base):
        for n in os.listdir(base):
            m = re.fullmatch(r"v(\d{3,})", n)
            if m and os.path.isdir(os.path.join(base, n)):
                nums.append(int(m.group(1)))
    nums += [v for b, v in _RESERVED_VERSIONS if b == base]
    v = max(nums, default=0) + 1
    _RESERVED_VERSIONS.add((base, v))
    return os.path.join(base, f"v{v:03d}")


def _next_flat_index(folder, name):
    pat = re.compile(re.escape(name) + r"_(\d{5})_")
    nums = [int(m.group(1)) for f in (os.listdir(folder) if os.path.isdir(folder) else [])
            for m in [pat.match(f)] if m]
    return max(nums, default=0) + 1


def _load_image(path):
    img = Image.open(path)
    img = ImageOps.exif_transpose(img)
    if img.mode == "I":
        img = img.point(lambda i: i * (1 / 255))

    rgb = img.convert("RGB")
    image = torch.from_numpy(np.array(rgb).astype(np.float32) / 255.0)[None,]

    alpha = None
    if "A" in img.getbands():
        alpha = img.getchannel("A")
    elif img.mode == "P" and "transparency" in img.info:
        alpha = img.convert("RGBA").getchannel("A")

    if alpha is not None:
        mask = 1.0 - torch.from_numpy(np.array(alpha).astype(np.float32) / 255.0)
    else:
        mask = torch.zeros((64, 64), dtype=torch.float32)
    return image, mask.unsqueeze(0)


# --------------------------------------------------------------------------- #
# nodes
# --------------------------------------------------------------------------- #
class MultiImageLoader:
    """Upload/drop many images; outputs a list so the workflow runs once per image."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "tooltip": "One image per line (relative to ComfyUI/input). "
                               "Filled automatically by the Upload button / drag & drop.",
                }),
            },
            "optional": {
                "folder": ("STRING", {
                    "default": "",
                    "tooltip": "Optional: also load every image in this folder "
                               "(absolute path or relative to ComfyUI/input).",
                }),
                "start_index": ("INT", {"default": 0, "min": 0, "max": 100000,
                                        "tooltip": "Skip the first N images."}),
                "max_images": ("INT", {"default": 0, "min": 0, "max": 100000,
                                       "tooltip": "0 = all images."}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "INT")
    RETURN_NAMES = ("images", "masks", "filenames", "count")
    OUTPUT_IS_LIST = (True, True, True, False)
    OUTPUT_TOOLTIPS = (
        "List of images - downstream nodes run once per image.",
        "List of masks (from alpha channel).",
        "List of file names (connect to Image Picker 'labels').",
        "Number of images.",
    )
    FUNCTION = "load"
    CATEGORY = CATEGORY
    DESCRIPTION = ("Load many images at once. The output is a list, so every node "
                   "after this one runs sequentially for each image.")

    def load(self, images, folder="", start_index=0, max_images=0):
        paths = _collect_paths(images, folder, start_index, max_images)
        if not paths:
            raise ValueError("[Multi Image Loader] No images. Upload some images "
                             "or set a folder.")
        out_images, out_masks, out_names = [], [], []
        for path in paths:
            image, mask = _load_image(path)
            out_images.append(image)
            out_masks.append(mask)
            out_names.append(os.path.splitext(os.path.basename(path))[0])
        return (out_images, out_masks, out_names, len(out_images))

    @classmethod
    def IS_CHANGED(cls, images, folder="", start_index=0, max_images=0):
        h = hashlib.sha256()
        try:
            for path in _collect_paths(images, folder, start_index, max_images):
                st = os.stat(path)
                h.update(f"{path}|{st.st_mtime_ns}|{st.st_size}".encode())
        except Exception as e:
            h.update(str(e).encode())
        return h.hexdigest()


class MultiImagePicker:
    """Shows every result in one grid. Click to select, then 'Save selected'."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE", {"tooltip": "Results to review (list or batch)."}),
                "project_name": ("STRING", {
                    "default": "MultiImageBatch",
                    "tooltip": "Name of the folder results are saved in (version folders go "
                               "inside it). In 'all in one folder' mode it is the file name prefix.",
                }),
                "save_all": ("BOOLEAN", {
                    "default": True,
                    "label_on": "save all to output",
                    "label_off": "preview only (pick & save)",
                    "tooltip": "On: every result is saved to the output folder when the "
                               "workflow runs. Off: results are only previewed; use "
                               "'Save selected' to keep the ones you pick.",
                }),
                "format": (FORMATS, {
                    "default": "png",
                    "tooltip": "File format for saved images (save all and Save selected). Options for the "
                               "chosen format appear below it. "
                               "png16 / tiff = 16-bit, exr = half float. png and png16 keep the workflow.",
                }),
                "jpg_quality": ("INT", {"default": 95, "min": 1, "max": 100,
                                        "tooltip": "Only used for jpg."}),
                "exr_linear": ("BOOLEAN", {
                    "default": True,
                    "label_on": "sRGB -> linear",
                    "label_off": "keep values",
                    "tooltip": "Only used for exr. Convert sRGB values to linear, as "
                               "compositing apps expect.",
                }),
                "output_folder": ("STRING", {
                    "default": "",
                    "tooltip": "Where to save. Empty = ComfyUI output folder. Absolute path "
                               "(e.g. D:\\renders\\project) or a path relative to output.",
                }),
                "version_folders": ("BOOLEAN", {
                    "default": True,
                    "label_on": "new v001, v002... per run",
                    "label_off": "all in one folder",
                    "tooltip": "On: each run saves into <output_folder>/<project_name>/vNNN/ with "
                               "files named after the source images.",
                }),
            },
            "optional": {
                "labels": ("STRING", {"forceInput": True,
                                      "tooltip": "Optional names shown under each image "
                                                 "(e.g. 'filenames' from Multi Image Loader)."}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    INPUT_IS_LIST = True
    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = "run"
    CATEGORY = CATEGORY
    DESCRIPTION = ("Collects all results into one grid. Click images to select them "
                   "and press 'Save selected' to copy them to the output folder.")

    def run(self, images, project_name, save_all, format=None, jpg_quality=None,
            exr_linear=None, output_folder=None, version_folders=None, labels=None,
            prompt=None, extra_pnginfo=None):
        first = lambda v, d: v[0] if v else d  # noqa: E731  (INPUT_IS_LIST)
        prefix = first(project_name, "MultiImageBatch")
        save_all = bool(first(save_all, True))
        fmt = first(format, "png")
        quality = int(first(jpg_quality, 95))
        linear = bool(first(exr_linear, True))
        out_folder = first(output_folder, "")
        versioned = bool(first(version_folders, True))
        prompt = first(prompt, None)
        extra_pnginfo = first(extra_pnginfo, None)

        frames, frame_labels = [], []
        for i, batch in enumerate(images):
            base_label = str(labels[i]) if labels and i < len(labels) else f"#{i + 1}"
            for b in range(batch.shape[0]):
                frames.append(batch[b])
                frame_labels.append(base_label if batch.shape[0] == 1
                                    else f"{base_label} [{b + 1}]")
        if not frames:
            return {"ui": {"mit_images": []}}

        h, w = frames[0].shape[0], frames[0].shape[1]
        # previews always go to temp as PNG (browsers can't show tiff/exr) plus a
        # float32 .npy copy so 'Save selected' can write full-precision tiff/exr later
        temp_prefix = prefix + "_mit_" + "".join(random.choice("abcdefghijklmnopqrstuvwxyz")
                                                 for _ in range(5))
        t_folder, t_name, t_counter, t_sub, _ = folder_paths.get_save_image_path(
            safe_name(temp_prefix.replace("/", "_").replace("\\", "_")),
            folder_paths.get_temp_directory(), w, h)

        # where this run saves: <root>/<prefix>/vNNN/001_name.ext  or  <root>/<prefix>_00001_.ext
        root, parts = _resolve_base(out_folder, prefix)
        if versioned:
            run_dir = _next_version_dir(os.path.join(root, *parts) if parts else root)
            selected_dir = os.path.join(run_dir, "selected") if save_all else run_dir
            flat_name = None
        else:
            run_dir = os.path.join(root, *parts[:-1])
            flat_name = parts[-1] if parts else "MultiImageBatch"
            selected_dir = run_dir
        SAVE_DIRS.add(os.path.abspath(selected_dir))
        flat_idx = _next_flat_index(run_dir, flat_name) if flat_name else 0
        if save_all:
            os.makedirs(run_dir, exist_ok=True)

        metadata = None
        if not (_comfy_args and getattr(_comfy_args, "disable_metadata", False)):
            metadata = PngInfo()
            if prompt is not None:
                metadata.add_text("prompt", json.dumps(prompt))
            if extra_pnginfo:
                for k, v in extra_pnginfo.items():
                    metadata.add_text(k, json.dumps(v))

        results, saved = [], []
        for idx, (frame, label) in enumerate(zip(frames, frame_labels), start=1):
            arr = frame.cpu().numpy().astype(np.float32)
            base = f"{t_name}_{t_counter:05}_"
            write_image(arr, os.path.join(t_folder, base), "png", pnginfo=metadata,
                        png_compress=1)
            np.save(os.path.join(t_folder, base + ".npy"), arr)
            t_counter += 1

            if flat_name:
                save_name = f"{flat_name}_{flat_idx:05}_"
                flat_idx += 1
            else:
                save_name = f"{idx:03d}_{safe_name(label, f'{idx:03d}')}" if labels else f"{idx:03d}"
            results.append({"filename": base + ".png", "subfolder": t_sub, "type": "temp",
                            "raw": base + ".npy", "label": label,
                            "save_dir": selected_dir, "save_name": save_name})
            if save_all:
                path = write_image(arr, os.path.join(run_dir, save_name), fmt,
                                   pnginfo=metadata, quality=quality, linear_exr=linear)
                saved.append(os.path.basename(path))

        return {"ui": {"mit_images": results, "mit_saved": saved,
                       "mit_saved_dir": [run_dir if save_all else ""]}}


NODE_CLASS_MAPPINGS = {
    "MIT_MultiImageLoader": MultiImageLoader,
    "MIT_MultiImagePicker": MultiImagePicker,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MIT_MultiImageLoader": "Multi Image Loader (LHS)",
    "MIT_MultiImagePicker": "Image Picker & Save (LHS)",
}
