import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const LOADER = "MIT_MultiImageLoader";
const PICKER = "MIT_MultiImagePicker";
const UPLOAD_SUBFOLDER = "multi_image_batch";

// ------------------------------------------------------------------ styles
function injectStyle() {
  if (document.getElementById("mit-style")) return;
  const s = document.createElement("style");
  s.id = "mit-style";
  s.textContent = `
  .mit-wrap{display:flex;flex-direction:column;gap:4px;height:100%;box-sizing:border-box;font-family:sans-serif}
  .mit-bar{display:flex;gap:4px;align-items:center;flex-wrap:wrap;font-size:12px}
  .mit-bar button{background:#333;color:#ddd;border:1px solid #555;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:12px}
  .mit-bar button:hover{background:#444}
  .mit-bar button.mit-primary{background:#2e6b34;border-color:#3d8b45;color:#fff}
  .mit-bar button.mit-primary:hover{background:#3d8b45}
  .mit-info{flex:1;color:#bbb;min-width:80px}
  .mit-grid{flex:1;min-height:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:4px;
    overflow-y:auto;padding:4px;background:rgba(0,0,0,.25);border-radius:6px;align-content:start}
  .mit-cell{position:relative;aspect-ratio:1/1;border-radius:4px;overflow:hidden;background:#1b1b1b;cursor:pointer;
    border:2px solid transparent;box-sizing:border-box}
  .mit-cell img{width:100%;height:100%;object-fit:contain;display:block}
  .mit-cell.mit-sel{border-color:#4caf50}
  .mit-cell.mit-sel::before{content:"\\2713";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;
    background:#4caf50;color:#fff;font-size:12px;line-height:18px;text-align:center;z-index:2}
  .mit-cell .mit-btn{position:absolute;top:2px;right:2px;width:20px;height:20px;border:none;border-radius:50%;
    background:rgba(0,0,0,.65);color:#fff;font-size:12px;line-height:20px;padding:0;cursor:pointer;opacity:0;z-index:2}
  .mit-cell:hover .mit-btn{opacity:1}
  .mit-cell .mit-label{position:absolute;left:0;right:0;bottom:0;font-size:10px;color:#fff;background:rgba(0,0,0,.6);
    padding:1px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mit-empty{grid-column:1/-1;color:#999;font-size:12px;text-align:center;padding:24px 6px;line-height:1.5}
  .mit-drop .mit-grid{outline:2px dashed #4caf50}
  .mit-lightbox{position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:100000;display:flex;flex-direction:column;
    align-items:center;justify-content:center;user-select:none}
  .mit-lightbox img{max-width:92vw;max-height:84vh;object-fit:contain;border:3px solid transparent;cursor:pointer}
  .mit-lightbox img.mit-sel{border-color:#4caf50}
  .mit-lb-cap{color:#fff;margin-top:10px;font-size:14px;font-family:sans-serif;text-align:center}
  .mit-lb-help{color:#999;margin-top:4px;font-size:12px;font-family:sans-serif}
  `;
  document.head.appendChild(s);
}

// ------------------------------------------------------------------ utils
function viewURL({ filename, subfolder = "", type = "input" }) {
  const p = new URLSearchParams({ filename, subfolder, type });
  return api.apiURL("/view?" + p.toString());
}

function splitPath(line) {
  const norm = line.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i < 0
    ? { subfolder: "", filename: norm }
    : { subfolder: norm.slice(0, i), filename: norm.slice(i + 1) };
}

function toast(severity, summary, detail) {
  const t = app.extensionManager?.toast;
  if (t?.add) t.add({ severity, summary, detail, life: 4000 });
  else alert(summary + (detail ? "\n" + detail : ""));
}

function button(text, onClick, cls) {
  const b = document.createElement("button");
  b.textContent = text;
  if (cls) b.className = cls;
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return b;
}

// Full-screen viewer. Arrow keys = navigate, Space/Enter/click = toggle select, Esc = close
function openLightbox(items, start, opts = {}) {
  let i = start;
  const ov = document.createElement("div");
  ov.className = "mit-lightbox";
  const img = document.createElement("img");
  const cap = document.createElement("div");
  cap.className = "mit-lb-cap";
  const help = document.createElement("div");
  help.className = "mit-lb-help";
  help.textContent = opts.toggle
    ? "← → move · Space / click = select · Esc = close"
    : "← → move · Esc = close";
  ov.append(img, cap, help);

  const show = () => {
    img.src = items[i].url;
    const sel = opts.isSelected ? opts.isSelected(i) : false;
    img.classList.toggle("mit-sel", sel);
    cap.textContent = `${i + 1} / ${items.length}   ${items[i].label || ""}${opts.toggle ? (sel ? "   ✓ selected" : "") : ""}`;
  };
  const close = () => { ov.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = (e) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight") { i = (i + 1) % items.length; show(); }
    else if (e.key === "ArrowLeft") { i = (i - 1 + items.length) % items.length; show(); }
    else if ((e.key === " " || e.key === "Enter") && opts.toggle) { opts.toggle(i); show(); }
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
  img.addEventListener("click", (e) => { e.stopPropagation(); if (opts.toggle) { opts.toggle(i); show(); } });
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(ov);
  show();
}

// These nodes never output an "images" preview. ComfyUI keys previews by node id,
// so a preview from another workflow's node with the same id can leak onto ours.
function clearStalePreview(node) {
  try {
    const outputs = app.nodeOutputs;
    const key = String(node.id);
    if (outputs?.[key]?.images) {
      delete outputs[key].images;
      app.nodeOutputs = outputs;
    }
  } catch (e) {
    /* older frontends: nothing to clear */
  }
  node.imgs = undefined;
  node.setDirtyCanvas?.(true, true);
}

// Show format-specific options only when that format is selected.
const FORMAT_OPTIONS = { jpg_quality: ["jpg"], exr_linear: ["exr"] };

function updateFormatOptions(node) {
  const fmt = node.widgets?.find((w) => w.name === "format")?.value;
  let changed = false;
  for (const [name, formats] of Object.entries(FORMAT_OPTIONS)) {
    const w = node.widgets?.find((x) => x.name === name);
    if (!w) continue;
    const hide = !formats.includes(fmt);
    if (!!w.hidden !== hide) { w.hidden = hide; changed = true; }
  }
  if (changed) node.setDirtyCanvas?.(true, true);
}

function addGridWidget(node, name, element, minHeight) {
  return node.addDOMWidget(name, name, element, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => minHeight,
  });
}

// ------------------------------------------------------------------ loader
function setupLoader(node) {
  const textW = node.widgets?.find((w) => w.name === "images");
  if (!textW) return;

  const wrap = document.createElement("div");
  wrap.className = "mit-wrap";
  const bar = document.createElement("div");
  bar.className = "mit-bar";
  const info = document.createElement("span");
  info.className = "mit-info";
  const grid = document.createElement("div");
  grid.className = "mit-grid";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.multiple = true;
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);

  const getLines = () => (textW.value || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const setLines = (lines) => {
    textW.value = lines.join("\n");
    render();
    node.setDirtyCanvas?.(true, true);
  };

  const render = () => {
    grid.replaceChildren();
    const lines = getLines();
    info.textContent = lines.length ? `${lines.length} image(s)` : "No images";
    if (!lines.length) {
      const e = document.createElement("div");
      e.className = "mit-empty";
      e.innerHTML = "Drag &amp; drop images onto this node<br>or click <b>Upload images</b>";
      grid.appendChild(e);
      return;
    }
    const items = lines.map((l) => {
      const p = splitPath(l);
      return { url: viewURL({ ...p, type: "input" }), label: p.filename };
    });
    items.forEach((it, i) => {
      const cell = document.createElement("div");
      cell.className = "mit-cell";
      cell.title = lines[i];
      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = it.url;
      const del = button("×", () => { const ls = getLines(); ls.splice(i, 1); setLines(ls); }, "mit-btn");
      del.title = "Remove from list";
      const label = document.createElement("div");
      label.className = "mit-label";
      label.textContent = `${i + 1}. ${it.label}`;
      cell.append(img, del, label);
      cell.addEventListener("click", () => openLightbox(items, i));
      grid.appendChild(cell);
    });
  };

  async function uploadFiles(fileList) {
    const files = [...fileList]
      .filter((f) => f.type.startsWith("image/"))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!files.length) return;
    const lines = getLines();
    let ok = 0;
    info.textContent = `Uploading 0 / ${files.length}...`;
    for (const f of files) {
      const body = new FormData();
      body.append("image", f, f.name);
      body.append("subfolder", UPLOAD_SUBFOLDER);
      body.append("type", "input");
      try {
        const r = await api.fetchApi("/upload/image", { method: "POST", body });
        if (r.status !== 200) throw new Error(`${r.status} ${r.statusText}`);
        const d = await r.json();
        lines.push(d.subfolder ? `${d.subfolder}/${d.name}` : d.name);
        ok++;
        info.textContent = `Uploading ${ok} / ${files.length}...`;
      } catch (err) {
        console.error("[LHS MultiImageBatch] upload failed", f.name, err);
      }
    }
    setLines(lines);
    if (ok === files.length) toast("success", `Added ${ok} image(s)`);
    else toast("warn", `Added ${ok} of ${files.length} image(s)`, "Some uploads failed - see console.");
  }

  fileInput.addEventListener("change", () => { uploadFiles(fileInput.files); fileInput.value = ""; });

  bar.append(
    info,
    button("📂 Upload images", () => fileInput.click(), "mit-primary"),
    button("Clear", () => setLines([])),
  );
  wrap.append(bar, grid);
  addGridWidget(node, "mit_loader_grid", wrap, 160);

  // drag & drop directly on the grid element
  wrap.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); e.stopPropagation(); wrap.classList.add("mit-drop"); }
  });
  wrap.addEventListener("dragleave", () => wrap.classList.remove("mit-drop"));
  wrap.addEventListener("drop", (e) => {
    wrap.classList.remove("mit-drop");
    if (e.dataTransfer?.files?.length) { e.preventDefault(); e.stopPropagation(); uploadFiles(e.dataTransfer.files); }
  });
  // drag & drop anywhere on the node (canvas)
  node.onDragOver = (e) => !!e.dataTransfer?.types?.includes("Files");
  node.onDragDrop = (e) => {
    const f = e.dataTransfer?.files;
    if (f?.length) { uploadFiles(f); return true; }
    return false;
  };

  // re-render when the text box is edited by hand
  const origCb = textW.callback;
  textW.callback = function () { const r = origCb?.apply(this, arguments); render(); return r; };
  let t = null;
  textW.inputEl?.addEventListener("input", () => { clearTimeout(t); t = setTimeout(render, 300); });

  const onRemoved = node.onRemoved;
  node.onRemoved = function () { fileInput.remove(); return onRemoved?.apply(this, arguments); };

  node.mitRender = render;
  render();
  node.setSize([Math.max(node.size[0], 360), Math.max(node.size[1], 460)]);
}

// ------------------------------------------------------------------ picker
function setupPicker(node) {
  node.mitResults = [];
  node.mitSelected = new Set();

  const wrap = document.createElement("div");
  wrap.className = "mit-wrap";
  const bar = document.createElement("div");
  bar.className = "mit-bar";
  const info = document.createElement("span");
  info.className = "mit-info";
  const grid = document.createElement("div");
  grid.className = "mit-grid";

  const items = () => node.mitResults.map((r) => ({ url: viewURL(r), label: r.label }));
  const toggle = (i) => {
    if (node.mitSelected.has(i)) node.mitSelected.delete(i);
    else node.mitSelected.add(i);
    render();
  };

  async function saveSelected() {
    const picked = [...node.mitSelected].sort((a, b) => a - b).map((i) => node.mitResults[i]).filter(Boolean);
    if (!picked.length) { toast("warn", "No images selected", "Click images to select them first."); return; }
    const wv = (name, dflt) => {
      const w = node.widgets?.find((x) => x.name === name);
      return w && w.value !== undefined && w.value !== "" ? w.value : dflt;
    };
    try {
      const r = await api.fetchApi("/lhs_multi_image_batch/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prefix: wv("project_name", wv("filename_prefix", "MultiImageBatch")),
          format: wv("format", "png"),
          jpg_quality: wv("jpg_quality", 95),
          exr_linear: wv("exr_linear", true),
          images: picked.map(({ filename, subfolder, type, raw, save_dir, save_name }) =>
            ({ filename, subfolder, type, raw, save_dir, save_name })),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || r.statusText);
      const names = d.saved.map((s) => s.path || (s.subfolder ? s.subfolder + "/" : "") + s.filename);
      toast("success", `Saved ${d.saved.length} image(s) to output`, names.join("\n"));
      if (d.skipped?.length) toast("warn", `${d.skipped.length} image(s) could not be found`,
        "Preview files are temporary - re-run the workflow if ComfyUI was restarted.");
    } catch (e) {
      toast("error", "Save failed", String(e));
    }
  }

  const render = () => {
    grid.replaceChildren();
    const res = node.mitResults;
    info.textContent = res.length ? `${node.mitSelected.size} / ${res.length} selected` : "Run the workflow to see results";
    if (!res.length) {
      const e = document.createElement("div");
      e.className = "mit-empty";
      e.innerHTML = "Results will appear here.<br>Click = select · 🔍 = enlarge";
      grid.appendChild(e);
      return;
    }
    const list = items();
    list.forEach((it, i) => {
      const cell = document.createElement("div");
      cell.className = "mit-cell" + (node.mitSelected.has(i) ? " mit-sel" : "");
      cell.title = it.label || "";
      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = it.url;
      const zoom = button("🔍", () => openLightbox(list, i, { toggle, isSelected: (k) => node.mitSelected.has(k) }), "mit-btn");
      zoom.title = "Enlarge";
      const label = document.createElement("div");
      label.className = "mit-label";
      label.textContent = `${i + 1}. ${it.label || ""}`;
      cell.append(img, zoom, label);
      cell.addEventListener("click", () => toggle(i));
      cell.addEventListener("dblclick", (e) => { e.stopPropagation(); openLightbox(list, i, { toggle, isSelected: (k) => node.mitSelected.has(k) }); });
      grid.appendChild(cell);
    });
  };

  bar.append(
    info,
    button("All", () => { node.mitResults.forEach((_, i) => node.mitSelected.add(i)); render(); }),
    button("None", () => { node.mitSelected.clear(); render(); }),
    button("💾 Save selected", saveSelected, "mit-primary"),
  );
  wrap.append(bar, grid);
  addGridWidget(node, "mit_picker_grid", wrap, 200);

  const fmtW = node.widgets?.find((w) => w.name === "format");
  if (fmtW) {
    const cb = fmtW.callback;
    fmtW.callback = function () { const r = cb?.apply(this, arguments); updateFormatOptions(node); return r; };
  }
  updateFormatOptions(node);

  node.mitRender = render;
  render();
  node.setSize([Math.max(node.size[0], 420), Math.max(node.size[1], 480)]);
}

// ------------------------------------------------------------------ register
app.registerExtension({
  name: "LHS.MultiImageBatch",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== LOADER && nodeData.name !== PICKER) return;
    injectStyle();

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated?.apply(this, arguments);
      if (nodeData.name === LOADER) setupLoader(this);
      else setupPicker(this);
      setTimeout(() => clearStalePreview(this), 0);
      return r;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      setTimeout(() => { clearStalePreview(this); updateFormatOptions(this); this.mitRender?.(); }, 0);
      return r;
    };

    if (nodeData.name === PICKER) {
      const onExecuted = nodeType.prototype.onExecuted;
      nodeType.prototype.onExecuted = function (message) {
        const r = onExecuted?.apply(this, arguments);
        if (message?.mit_images) {
          this.mitResults = message.mit_images;
          this.mitSelected = new Set();
          this.mitRender?.();
        }
        const dir = message?.mit_saved_dir?.[0];
        if (dir && message?.mit_saved?.length) {
          toast("success", `Saved ${message.mit_saved.length} image(s)`, dir);
        }
        clearStalePreview(this);
        return r;
      };
    }
  },
});
