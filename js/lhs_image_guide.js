import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE = "LHS_ImageGuidePainter";
const UPLOAD_SUBFOLDER = "image_guide";
const COLORS = ["#ff2d2d", "#ff9f1a", "#facc15", "#22c55e", "#3b82f6", "#a855f7", "#ffffff", "#000000"];
const TOOLS = [
  { id: "rect", icon: "▭", name: "Box", key: "r" },
  { id: "ellipse", icon: "◯", name: "Circle", key: "e" },
  { id: "pen", icon: "✎", name: "Pen", key: "p" },
  { id: "arrow", icon: "↗", name: "Arrow", key: "a" },
  { id: "text", icon: "T", name: "Text", key: "t" },
  { id: "eraser", icon: "⌫", name: "Erase (click a shape)", key: "x" },
];
const FONT = '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans CJK KR","Noto Sans KR",sans-serif';

// ------------------------------------------------------------------ style
function injectStyle() {
  if (document.getElementById("lhs-guide-style")) return;
  const s = document.createElement("style");
  s.id = "lhs-guide-style";
  s.textContent = `
  .lhsg-wrap{display:flex;flex-direction:column;gap:4px;height:100%;box-sizing:border-box;font-family:sans-serif}
  .lhsg-bar{display:flex;gap:4px;align-items:center;flex-wrap:wrap;font-size:12px}
  .lhsg-bar button,.lhsg-ed button{background:#333;color:#ddd;border:1px solid #555;border-radius:4px;padding:3px 9px;cursor:pointer;font-size:12px}
  .lhsg-bar button:hover,.lhsg-ed button:hover{background:#444}
  .lhsg-ed button.on{background:#2563eb;border-color:#3b82f6;color:#fff}
  .lhsg-bar button.pri,.lhsg-ed button.pri{background:#2e6b34;border-color:#3d8b45;color:#fff}
  .lhsg-info{flex:1;color:#bbb;min-width:90px}
  .lhsg-grid{flex:1;min-height:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:4px;
    overflow-y:auto;padding:4px;background:rgba(0,0,0,.25);border-radius:6px;align-content:start}
  .lhsg-cell{position:relative;border-radius:4px;overflow:hidden;background:#1b1b1b;cursor:pointer;aspect-ratio:1/1;
    display:flex;align-items:center;justify-content:center;border:2px solid transparent;box-sizing:border-box}
  .lhsg-cell canvas{max-width:100%;max-height:100%}
  .lhsg-cell.has{border-color:#3b82f6}
  .lhsg-cell .lbl{position:absolute;left:0;right:0;bottom:0;font-size:10px;color:#fff;background:rgba(0,0,0,.6);
    padding:1px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lhsg-empty{grid-column:1/-1;color:#999;font-size:12px;text-align:center;padding:22px 6px;line-height:1.5}
  .lhsg-ed{position:fixed;inset:0;z-index:100000;background:#141414;display:flex;flex-direction:column;font-family:sans-serif;color:#ddd;user-select:none}
  .lhsg-top{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:8px 10px;background:#1e1e1e;border-bottom:1px solid #333;font-size:12px}
  .lhsg-top .grp{display:flex;gap:3px;align-items:center;padding-right:8px;margin-right:2px;border-right:1px solid #333}
  .lhsg-top .tool{font-size:16px;min-width:34px}
  .lhsg-sw{width:20px;height:20px;border-radius:50%;border:2px solid #555;cursor:pointer;box-sizing:border-box}
  .lhsg-sw.on{border-color:#fff;box-shadow:0 0 0 2px #2563eb}
  .lhsg-top input[type=range]{width:90px}
  .lhsg-top input[type=color]{width:26px;height:22px;border:none;background:none;padding:0;cursor:pointer}
  .lhsg-stage{flex:1;min-height:0;position:relative;overflow:hidden}
  .lhsg-stage canvas{position:absolute;inset:0;touch-action:none}
  .lhsg-hint{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#888;font-size:14px;text-align:center;line-height:1.6}
  .lhsg-bottom{display:flex;gap:8px;align-items:center;padding:6px 10px;background:#1e1e1e;border-top:1px solid #333;font-size:12px}
  .lhsg-strip{flex:1;display:flex;gap:4px;overflow-x:auto;padding:2px}
  .lhsg-th{position:relative;flex:0 0 auto;height:56px;border:2px solid transparent;border-radius:4px;cursor:pointer;background:#111}
  .lhsg-th canvas{height:100%;display:block}
  .lhsg-th.cur{border-color:#facc15}
  .lhsg-th .ck{position:absolute;top:2px;right:2px;background:#3b82f6;color:#fff;border-radius:50%;width:15px;height:15px;font-size:10px;line-height:15px;text-align:center}
  .lhsg-txt{position:absolute;z-index:3;background:rgba(0,0,0,.7);color:#fff;border:1px dashed #facc15;outline:none;padding:2px 4px;font-family:${FONT};resize:none}
  `;
  document.head.appendChild(s);
}

// ------------------------------------------------------------------ helpers
const viewURL = ({ filename, subfolder = "", type = "input" }) =>
  api.apiURL("/view?" + new URLSearchParams({ filename, subfolder, type }).toString());

const stem = (p) => { const f = String(p).replace(/\\/g, "/").split("/").pop(); const i = f.lastIndexOf("."); return i > 0 ? f.slice(0, i) : f; };
const splitPath = (line) => {
  const n = String(line).replace(/\\/g, "/"); const i = n.lastIndexOf("/");
  return i < 0 ? { subfolder: "", filename: n } : { subfolder: n.slice(0, i), filename: n.slice(i + 1) };
};
const W = (node, name) => node.widgets?.find((w) => w.name === name);

function toast(severity, summary, detail) {
  const t = app.extensionManager?.toast;
  if (t?.add) t.add({ severity, summary, detail, life: 3500 });
}

function btn(text, title, onClick, cls) {
  const b = document.createElement("button");
  b.textContent = text; if (title) b.title = title; if (cls) b.className = cls;
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(e); });
  return b;
}

function parseGuides(text) {
  try {
    const d = JSON.parse(text || "{}");
    return { shared: !!d.shared, items: d.items && typeof d.items === "object" ? d.items : {} };
  } catch { return { shared: false, items: {} }; }
}

// Same lookup as the Python side: shared set, else by name, else by position.
function shapesFor(data, src, presentKeys) {
  if (data.shared) return data.items["*"]?.shapes || [];
  if (data.items[src.key]) return data.items[src.key].shapes || [];
  for (const [k, e] of Object.entries(data.items)) {
    if (k !== "*" && !presentKeys.has(k) && e?.i === src.i) return e.shapes || [];
  }
  return [];
}

function setShapesFor(data, src, shapes, presentKeys) {
  if (data.shared) { data.items["*"] = { i: -1, shapes }; return; }
  for (const [k, e] of Object.entries(data.items)) {          // drop a position-matched entry
    if (k !== "*" && !presentKeys.has(k) && e?.i === src.i) delete data.items[k];
  }
  if (shapes.length) data.items[src.key] = { i: src.i, shapes };
  else delete data.items[src.key];
}

// ------------------------------------------------------------------ drawing (mirrors render.py)
function shapeGeom(s, iw, ih, k) {
  const pts = (s.pts || []).map(([x, y]) => [x * iw * k, y * ih * k]);
  const w = Math.max(1, (s.width ?? 0.006) * iw) * k;
  return { pts, w };
}

function drawShapeOpaque(ctx, s, iw, ih, k) {
  const { pts, w } = shapeGeom(s, iw, ih, k);
  if (!pts.length) return;
  ctx.fillStyle = ctx.strokeStyle = s.color || "#ff0000";
  ctx.lineWidth = w; ctx.lineCap = "round"; ctx.lineJoin = "round";
  if ((s.type === "rect" || s.type === "ellipse") && pts.length >= 2) {
    const [[x0, y0], [x1, y1]] = [pts[0], pts[pts.length - 1]];
    const x = Math.min(x0, x1), y = Math.min(y0, y1), bw = Math.abs(x1 - x0), bh = Math.abs(y1 - y0);
    ctx.beginPath();
    if (s.type === "rect") ctx.rect(x, y, bw, bh);
    else ctx.ellipse(x + bw / 2, y + bh / 2, bw / 2, bh / 2, 0, 0, Math.PI * 2);
    if (s.fill !== false) ctx.fill();
    else { ctx.lineJoin = "miter"; ctx.lineCap = "butt"; ctx.stroke(); }
  } else if (s.type === "pen") {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
    for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
    ctx.stroke();
  } else if (s.type === "arrow" && pts.length >= 2) {
    const [[x0, y0], [x1, y1]] = [pts[0], pts[pts.length - 1]];
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const len = Math.max(w * 4, 0.012 * iw * k), sp = (28 * Math.PI) / 180;
    const bx = x1 - len * 0.8 * Math.cos(ang), by = y1 - len * 0.8 * Math.sin(ang);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(bx, by); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - len * Math.cos(ang - sp), y1 - len * Math.sin(ang - sp));
    ctx.lineTo(x1 - len * Math.cos(ang + sp), y1 - len * Math.sin(ang + sp));
    ctx.closePath(); ctx.fill();
  } else if (s.type === "text" && s.text) {
    const px = Math.max(6, (s.size ?? 0.05) * ih) * k;
    ctx.font = `${px}px ${FONT}`; ctx.textBaseline = "alphabetic";
    const asc = ctx.measureText("Ag").fontBoundingBoxAscent ?? px * 0.9;
    String(s.text).split("\n").forEach((line, i) => ctx.fillText(line, pts[0][0], pts[0][1] + asc + i * px * 1.2));
  }
}

let _layer = null;
function drawShapes(ctx, shapes, iw, ih, k) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  if (!_layer) _layer = document.createElement("canvas");
  if (_layer.width !== cw || _layer.height !== ch) { _layer.width = cw; _layer.height = ch; }
  const lc = _layer.getContext("2d");
  for (const s of shapes) {
    lc.setTransform(1, 0, 0, 1, 0, 0); lc.clearRect(0, 0, cw, ch);
    lc.setTransform(ctx.getTransform());
    drawShapeOpaque(lc, s, iw, ih, k);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = Math.max(0, Math.min(1, s.opacity ?? 0.45));
    ctx.drawImage(_layer, 0, 0); ctx.restore();
  }
}

const _imgCache = new Map();
function loadImg(url) {
  if (_imgCache.has(url)) return _imgCache.get(url);
  const p = new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
  _imgCache.set(url, p); return p;
}

async function thumbCanvas(src, shapes, h) {
  const im = await loadImg(src.url);
  const c = document.createElement("canvas");
  if (!im) { c.width = h; c.height = h; return c; }
  const k = h / im.naturalHeight;
  c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = h;
  const ctx = c.getContext("2d");
  ctx.drawImage(im, 0, 0, c.width, c.height);
  drawShapes(ctx, shapes, im.naturalWidth, im.naturalHeight, k);
  return c;
}

// ------------------------------------------------------------------ sources
function linkedOrigin(node) {
  const idx = node.inputs?.findIndex((i) => i.name === "image");
  if (idx == null || idx < 0 || node.inputs[idx].link == null) return null;
  return node.getInputNode?.(idx) || null;
}

function getSources(node) {
  const origin = linkedOrigin(node);
  if (origin) {
    if (origin.type === "MIT_MultiImageLoader") {
      const lines = (W(origin, "images")?.value || "").split(/\r?\n/).map((s) => s.trim())
        .filter((s) => s && !s.startsWith("#"));            // "#" = turned off in the loader
      const folder = (W(origin, "folder")?.value || "").trim();
      if (!folder) {
        const start = Math.max(0, +W(origin, "start_index")?.value || 0);
        const max = +W(origin, "max_images")?.value || 0;
        let sel = lines.slice(start); if (max > 0) sel = sel.slice(0, max);
        return { list: sel.map((l, i) => ({ url: viewURL({ ...splitPath(l), type: "input" }), key: stem(l), i, name: splitPath(l).filename })), from: "loader" };
      }
    }
    if (origin.type === "LoadImage") {
      const v = W(origin, "image")?.value;
      if (v) return { list: [{ url: viewURL({ ...splitPath(v), type: "input" }), key: stem(v), i: 0, name: splitPath(v).filename }], from: "loadimage" };
    }
    const last = node.lhsSources || [];
    return { list: last.map((s) => ({ url: viewURL(s), key: s.key, i: s.i, name: s.key })), from: last.length ? "lastrun" : "needrun" };
  }
  const src = W(node, "source_image")?.value;
  if (src) return { list: [{ url: viewURL({ ...splitPath(src), type: "input" }), key: stem(src), i: 0, name: splitPath(src).filename }], from: "own" };
  return { list: [], from: "none" };
}


// ------------------------------------------------------------------ auto labels
// Find the nearest Multi Image Loader upstream of the given input.
function findUpstreamLoader(node, inputName) {
  const start = node.inputs?.findIndex((i) => i.name === inputName);
  if (start == null || start < 0 || node.inputs[start].link == null) return null;
  const queue = [node.getInputNode?.(start)].filter(Boolean), seen = new Set([node.id]);
  while (queue.length) {
    const n = queue.shift();
    if (seen.has(n.id)) continue; seen.add(n.id);
    if (n.type === "MIT_MultiImageLoader") return n;
    (n.inputs || []).forEach((inp, i) => { if (inp.link != null) { const o = n.getInputNode?.(i); if (o) queue.push(o); } });
  }
  return null;
}

// Connect the loader's 'filenames' to our 'labels' once (not again if the user removes it).
function autoConnectLabels(node, inputName) {
  const li = node.inputs?.findIndex((i) => i.name === "labels");
  if (li == null || li < 0 || node.inputs[li].link != null) return false;
  const loader = findUpstreamLoader(node, inputName);
  if (!loader) return false;
  node.properties = node.properties || {};
  if (node.properties.lhs_auto_labels === loader.id) return false;
  const oi = loader.outputs?.findIndex((o) => o.name === "filenames");
  if (oi == null || oi < 0) return false;
  loader.connect(oi, node, li);
  node.properties.lhs_auto_labels = loader.id;
  return true;
}

// Workflows saved with the first version had outputs (image, mask, original); the new
// order is (org_image, guide_image, mask). Rewrite the saved workflow data before ComfyUI
// loads it so every connection keeps going to the same kind of output.
const OUTPUTS_V = 2;
const OLD_TO_NEW = { 0: 1, 1: 2, 2: 0 };
const NEW_OUTPUTS = [["org_image", "IMAGE"], ["guide_image", "IMAGE"], ["mask", "MASK"]];

function migrateGraphData(graph) {
  if (!graph || !Array.isArray(graph.nodes)) return;
  const moved = new Map();                               // node id -> true
  for (const n of graph.nodes) {
    if (n?.type !== NODE) continue;
    n.properties = n.properties || {};
    const names = (n.outputs || []).map((o) => o.name).join(",");
    if (n.properties.lhs_outputs_v >= OUTPUTS_V || names !== "image,mask,original") {
      n.properties.lhs_outputs_v = OUTPUTS_V; continue;
    }
    const next = [];
    n.outputs.forEach((o, i) => {
      const j = OLD_TO_NEW[i];
      next[j] = { ...o, name: NEW_OUTPUTS[j][0], localized_name: NEW_OUTPUTS[j][0], type: NEW_OUTPUTS[j][1], slot_index: j };
      delete next[j].label;
    });
    n.outputs = next;
    n.properties.lhs_outputs_v = OUTPUTS_V;
    moved.set(String(n.id), true);
  }
  if (!moved.size) return;
  for (const l of graph.links || []) {                  // [id, from, fromSlot, to, toSlot, type] or {..}
    if (Array.isArray(l)) { if (moved.has(String(l[1]))) l[2] = OLD_TO_NEW[l[2]] ?? l[2]; }
    else if (l && moved.has(String(l.origin_id))) l.origin_slot = OLD_TO_NEW[l.origin_slot] ?? l.origin_slot;
  }
  for (const sg of graph.definitions?.subgraphs || []) migrateGraphData(sg);
}

// ------------------------------------------------------------------ editor
function openEditor(node, startIndex = 0) {
  const { list: sources, from } = getSources(node);
  if (!sources.length) {
    toast("warn", "No image yet", from === "needrun"
      ? "Run the workflow once so the images reach this node, then draw."
      : "Connect an image or use Load image.");
    return;
  }
  const gW = W(node, "guides");
  const data = parseGuides(gW?.value);
  const present = new Set(sources.map((s) => s.key));
  let cur = Math.min(startIndex, sources.length - 1);
  const st = { tool: "rect", color: "#ff2d2d", opacity: 0.45, width: 6, fill: true, size: 5 };
  const undo = [], redo = [];
  const snap = () => JSON.stringify(data);
  const pushUndo = () => { undo.push(snap()); if (undo.length > 200) undo.shift(); redo.length = 0; };
  let dirty = false;

  // --- layout
  const ed = document.createElement("div"); ed.className = "lhsg-ed";
  const top = document.createElement("div"); top.className = "lhsg-top";
  const stage = document.createElement("div"); stage.className = "lhsg-stage";
  const cv = document.createElement("canvas"); stage.appendChild(cv);
  const bottom = document.createElement("div"); bottom.className = "lhsg-bottom";
  ed.append(top, stage, bottom);

  // tools
  const gTools = document.createElement("div"); gTools.className = "grp";
  const toolBtns = {};
  for (const t of TOOLS) {
    const b = btn(t.icon, `${t.name} (${t.key.toUpperCase()})`, () => setTool(t.id), "tool");
    toolBtns[t.id] = b; gTools.appendChild(b);
  }
  const setTool = (id) => { st.tool = id; for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle("on", k === id); cv.style.cursor = id === "eraser" ? "not-allowed" : id === "text" ? "text" : "crosshair"; };

  // colors
  const gCol = document.createElement("div"); gCol.className = "grp";
  const sw = [];
  for (const c of COLORS) {
    const d = document.createElement("div"); d.className = "lhsg-sw"; d.style.background = c; d.title = c;
    d.onclick = () => setColor(c); sw.push(d); gCol.appendChild(d);
  }
  const picker = document.createElement("input"); picker.type = "color"; picker.title = "Custom color";
  picker.oninput = () => setColor(picker.value); gCol.appendChild(picker);
  const setColor = (c) => { st.color = c; picker.value = c; sw.forEach((d) => d.classList.toggle("on", d.title === c)); };

  const slider = (label, min, max, step, val, fmt, onIn) => {
    const g = document.createElement("label"); g.style.cssText = "display:flex;align-items:center;gap:4px";
    const r = document.createElement("input"); r.type = "range"; r.min = min; r.max = max; r.step = step; r.value = val;
    const v = document.createElement("span"); v.style.minWidth = "30px"; v.textContent = fmt(val);
    r.oninput = () => { v.textContent = fmt(+r.value); onIn(+r.value); };
    g.append(label, r, v); return { g, r, v };
  };
  const gOpt = document.createElement("div"); gOpt.className = "grp";
  const sOp = slider("Opacity", 5, 100, 5, st.opacity * 100, (x) => `${x}%`, (x) => (st.opacity = x / 100));
  const sW = slider("Size", 1, 50, 1, st.width, (x) => `${x}`, (x) => (st.width = x));
  const sT = slider("Text", 1, 20, 1, st.size, (x) => `${x}`, (x) => (st.size = x));
  const fillB = btn("Fill", "Fill boxes / circles (off = outline only)", () => { st.fill = !st.fill; fillB.classList.toggle("on", st.fill); });
  fillB.classList.add("on");
  gOpt.append(sOp.g, sW.g, sT.g, fillB);

  const gHist = document.createElement("div"); gHist.className = "grp";
  gHist.append(
    btn("↶", "Undo (Ctrl+Z)", () => doUndo()),
    btn("↷", "Redo (Ctrl+Y)", () => doRedo()),
    btn("Clear image", "Remove all guides from this image", () => { pushUndo(); setShapes([]); }),
  );
  const spacer = document.createElement("div"); spacer.style.flex = "1";
  const cancelB = btn("Cancel", "Close without saving", () => close(false));
  const saveB = btn("✔ Save", "Save guides and close", () => close(true), "pri");
  top.append(gTools, gCol, gOpt, gHist, spacer, cancelB, saveB);

  // bottom: nav + strip + shared
  const prevB = btn("◀", "Previous image (←)", () => go(cur - 1));
  const nextB = btn("▶", "Next image (→)", () => go(cur + 1));
  const counter = document.createElement("span"); counter.style.minWidth = "48px";
  const strip = document.createElement("div"); strip.className = "lhsg-strip";
  const sharedL = document.createElement("label"); sharedL.style.cssText = "display:flex;gap:4px;align-items:center;white-space:nowrap";
  const sharedC = document.createElement("input"); sharedC.type = "checkbox"; sharedC.checked = data.shared;
  sharedL.append(sharedC, "Same guides on all images");
  sharedC.onchange = () => {
    pushUndo();
    if (sharedC.checked && !data.items["*"]) {
      const s = shapesFor({ ...data, shared: false }, sources[cur], present);
      data.items["*"] = { i: -1, shapes: JSON.parse(JSON.stringify(s)) };
    }
    data.shared = sharedC.checked; dirty = true; refreshStrip(); draw();
  };
  bottom.append(prevB, counter, nextB, strip, sharedL);
  if (sources.length < 2) { prevB.style.display = nextB.style.display = "none"; sharedL.style.display = "none"; }

  // --- state helpers
  const shapes = () => shapesFor(data, sources[cur], present);
  const setShapes = (arr) => { setShapesFor(data, sources[cur], arr, present); dirty = true; draw(); refreshThumb(cur); };
  const doUndo = () => { if (!undo.length) return; redo.push(snap()); Object.assign(data, JSON.parse(undo.pop())); sharedC.checked = data.shared; dirty = true; draw(); refreshStrip(); };
  const doRedo = () => { if (!redo.length) return; undo.push(snap()); Object.assign(data, JSON.parse(redo.pop())); sharedC.checked = data.shared; dirty = true; draw(); refreshStrip(); };

  // --- view
  let im = null, view = { k: 1, ox: 0, oy: 0, iw: 1, ih: 1 }, draft = null;
  const dpr = () => window.devicePixelRatio || 1;
  function layout() {
    const r = stage.getBoundingClientRect(), d = dpr();
    cv.width = Math.max(1, Math.round(r.width * d)); cv.height = Math.max(1, Math.round(r.height * d));
    cv.style.width = r.width + "px"; cv.style.height = r.height + "px";
    if (im) {
      const pad = 16, k = Math.min((r.width - pad * 2) / im.naturalWidth, (r.height - pad * 2) / im.naturalHeight);
      view = { k, iw: im.naturalWidth, ih: im.naturalHeight,
        ox: (r.width - im.naturalWidth * k) / 2, oy: (r.height - im.naturalHeight * k) / 2 };
    }
  }
  function draw() {
    const ctx = cv.getContext("2d"), d = dpr();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    if (!im) return;
    ctx.setTransform(d, 0, 0, d, d * view.ox, d * view.oy);
    ctx.drawImage(im, 0, 0, view.iw * view.k, view.ih * view.k);
    drawShapes(ctx, draft ? [...shapes(), draft] : shapes(), view.iw, view.ih, view.k);
    ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = 1;
    ctx.strokeRect(-0.5, -0.5, view.iw * view.k + 1, view.ih * view.k + 1);
  }
  async function go(i) {
    if (i < 0 || i >= sources.length) return;
    cur = i; counter.textContent = `${cur + 1} / ${sources.length}`;
    [...strip.children].forEach((c, j) => c.classList.toggle("cur", j === cur));
    strip.children[cur]?.scrollIntoView({ block: "nearest", inline: "nearest" });
    im = await loadImg(sources[cur].url);
    if (!im) toast("error", "Could not load image", sources[cur].name);
    layout(); draw();
  }
  async function refreshThumb(i) {
    const el = strip.children[i]; if (!el) return;
    const s = shapesFor(data, sources[i], present);
    const c = await thumbCanvas(sources[i], s, 52);
    el.replaceChildren(c);
    if (s.length) { const ck = document.createElement("div"); ck.className = "ck"; ck.textContent = "✓"; el.appendChild(ck); }
  }
  function refreshStrip() {
    if (strip.children.length !== sources.length) {
      strip.replaceChildren(...sources.map((s, i) => {
        const t = document.createElement("div"); t.className = "lhsg-th"; t.title = s.name;
        t.onclick = () => go(i); return t;
      }));
    }
    sources.forEach((_, i) => refreshThumb(i));
    [...strip.children].forEach((c, j) => c.classList.toggle("cur", j === cur));
  }

  // --- pointer
  const toImg = (e) => {
    const r = cv.getBoundingClientRect();
    return [((e.clientX - r.left - view.ox) / view.k) / view.iw, ((e.clientY - r.top - view.oy) / view.k) / view.ih];
  };
  const clamp = ([x, y]) => [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
  const base = () => ({ color: st.color, opacity: st.opacity, width: st.width / 1000 });

  function hit(s, [x, y]) {
    const tolX = Math.max(8 / (view.k * view.iw), (s.width || 0.006) / 2), tolY = tolX * view.iw / view.ih;
    const p = s.pts || [];
    if (s.type === "rect" || s.type === "ellipse") {
      const [a, b] = [p[0], p[p.length - 1]];
      return x >= Math.min(a[0], b[0]) - tolX && x <= Math.max(a[0], b[0]) + tolX && y >= Math.min(a[1], b[1]) - tolY && y <= Math.max(a[1], b[1]) + tolY;
    }
    if (s.type === "text") {
      const lines = String(s.text || "").split("\n"), h = (s.size || 0.05);
      const wN = Math.max(...lines.map((l) => l.length)) * h * 0.6 * view.ih / view.iw;
      return x >= p[0][0] - tolX && x <= p[0][0] + wN + tolX && y >= p[0][1] - tolY && y <= p[0][1] + lines.length * h * 1.2 + tolY;
    }
    for (let i = 0; i < p.length; i++) {               // pen / arrow: near any segment
      const a = p[i], b = p[Math.min(i + 1, p.length - 1)];
      const dx = (b[0] - a[0]) * view.iw, dy = (b[1] - a[1]) * view.ih;
      const px = (x - a[0]) * view.iw, py = (y - a[1]) * view.ih;
      const t = dx || dy ? Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy))) : 0;
      if (Math.hypot(px - t * dx, py - t * dy) <= tolX * view.iw) return true;
    }
    return false;
  }

  let txtBox = null;
  function startText(pt, e) {
    commitText();
    const r = stage.getBoundingClientRect();
    const px = Math.max(10, st.size / 100 * view.ih * view.k);
    const ta = document.createElement("textarea"); ta.className = "lhsg-txt"; ta.rows = 1;
    ta.style.left = (e.clientX - r.left) + "px"; ta.style.top = (e.clientY - r.top) + "px";
    ta.style.fontSize = px + "px"; ta.style.color = st.color; ta.placeholder = "Type, Enter = done";
    stage.appendChild(ta); setTimeout(() => ta.focus(), 0);
    txtBox = { ta, pt };
    ta.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); commitText(); }
      else if (ev.key === "Escape") { ta.remove(); txtBox = null; }
    });
  }
  function commitText() {
    if (!txtBox) return;
    const { ta, pt } = txtBox; txtBox = null;
    const text = ta.value.replace(/\s+$/, ""); ta.remove();
    if (!text) return;
    pushUndo();
    setShapes([...shapes(), { type: "text", pts: [pt], text, size: st.size / 100, ...base() }]);
  }

  cv.addEventListener("pointerdown", (e) => {
    if (!im || e.button !== 0) return;
    const pt = toImg(e);
    if (st.tool === "text") { if (pt[0] >= 0 && pt[0] <= 1 && pt[1] >= 0 && pt[1] <= 1) startText(pt, e); return; }
    commitText();
    if (st.tool === "eraser") {
      const arr = shapes();
      for (let i = arr.length - 1; i >= 0; i--) if (hit(arr[i], pt)) { pushUndo(); setShapes(arr.filter((_, j) => j !== i)); break; }
      return;
    }
    const p = clamp(pt);
    draft = { type: st.tool, pts: [p, p], ...base() };
    if (st.tool === "pen") draft.pts = [p];
    if (st.tool === "rect" || st.tool === "ellipse") draft.fill = st.fill;
    cv.setPointerCapture(e.pointerId); draw();
  });
  cv.addEventListener("pointermove", (e) => {
    if (!draft) return;
    const p = clamp(toImg(e));
    if (draft.type === "pen") {
      const l = draft.pts[draft.pts.length - 1];
      if (Math.hypot((p[0] - l[0]) * view.iw * view.k, (p[1] - l[1]) * view.ih * view.k) >= 2) draft.pts.push(p);
    } else draft.pts[1] = p;
    draw();
  });
  const endDraw = () => {
    if (!draft) return;
    const s = draft; draft = null;
    const a = s.pts[0], b = s.pts[s.pts.length - 1];
    const tiny = Math.hypot((b[0] - a[0]) * view.iw * view.k, (b[1] - a[1]) * view.ih * view.k) < 3;
    if (s.type !== "pen" && tiny) { draw(); return; }
    s.pts = s.pts.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]);
    pushUndo(); setShapes([...shapes(), s]);
  };
  cv.addEventListener("pointerup", endDraw);
  cv.addEventListener("pointercancel", endDraw);

  // --- keys
  const onKey = (e) => {
    if (txtBox) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z") { e.shiftKey ? doRedo() : doUndo(); }
    else if ((e.ctrlKey || e.metaKey) && k === "y") doRedo();
    else if (k === "arrowleft") go(cur - 1);
    else if (k === "arrowright") go(cur + 1);
    else if (k === "[") { sW.r.value = Math.max(1, st.width - 1); sW.r.oninput(); }
    else if (k === "]") { sW.r.value = Math.min(50, st.width + 1); sW.r.oninput(); }
    else if (!e.ctrlKey && !e.metaKey && !e.altKey && TOOLS.some((t) => t.key === k)) setTool(TOOLS.find((t) => t.key === k).id);
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  const onResize = () => { layout(); draw(); };

  function close(save) {
    commitText();
    if (save) {
      if (gW) {
        gW.value = JSON.stringify({ v: 1, shared: data.shared, items: data.items });
        gW.callback?.(gW.value);
      }
      node.graph?.setDirtyCanvas?.(true, true);
      app.graph?.change?.();
      node.lhsRender?.();
    } else if (dirty && !confirm("Discard the changes to the guides?")) return;
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onResize);
    ed.remove();
  }

  document.body.appendChild(ed);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onResize);
  setTool("rect"); setColor(st.color);
  refreshStrip(); go(cur);
}

// ------------------------------------------------------------------ node UI
function setupNode(node) {
  for (const n of ["guides", "source_image"]) { const w = W(node, n); if (w) w.hidden = true; }

  const wrap = document.createElement("div"); wrap.className = "lhsg-wrap";
  const bar = document.createElement("div"); bar.className = "lhsg-bar";
  const info = document.createElement("span"); info.className = "lhsg-info";
  const grid = document.createElement("div"); grid.className = "lhsg-grid";

  const fileInput = document.createElement("input");
  fileInput.type = "file"; fileInput.accept = "image/*"; fileInput.style.display = "none";
  document.body.appendChild(fileInput);
  fileInput.onchange = async () => {
    const f = fileInput.files?.[0]; fileInput.value = ""; if (!f) return;
    const body = new FormData();
    body.append("image", f, f.name); body.append("subfolder", UPLOAD_SUBFOLDER); body.append("type", "input");
    try {
      const r = await api.fetchApi("/upload/image", { method: "POST", body });
      if (r.status !== 200) throw new Error(`${r.status} ${r.statusText}`);
      const d = await r.json();
      const w = W(node, "source_image");
      if (w) { w.value = d.subfolder ? `${d.subfolder}/${d.name}` : d.name; w.callback?.(w.value); }
      app.graph?.change?.(); render();
    } catch (e) { toast("error", "Upload failed", String(e)); }
  };

  bar.append(
    info,
    btn("✏️ Draw guides", "Open the drawing editor", () => openEditor(node), "pri"),
    btn("📂 Load image", "Load an image directly (used when nothing is connected to 'image')", () => {
      if (linkedOrigin(node)) toast("info", "Image input is connected", "Disconnect 'image' to use a loaded image instead.");
      else fileInput.click();
    }),
    btn("Clear all", "Remove every guide", () => {
      const gW = W(node, "guides");
      if (!gW?.value || gW.value === "{}" || !confirm("Remove all guides from every image?")) return;
      gW.value = ""; gW.callback?.(""); app.graph?.change?.(); render();
    }),
  );
  wrap.append(bar, grid);
  node.addDOMWidget("lhs_guide_view", "lhs_guide_view", wrap, { serialize: false, hideOnZoom: false, getMinHeight: () => 150 });

  let token = 0;
  async function render() {
    const my = ++token;
    const { list, from } = getSources(node);
    const data = parseGuides(W(node, "guides")?.value);
    const present = new Set(list.map((s) => s.key));
    const marked = list.filter((s) => shapesFor(data, s, present).length).length;
    info.textContent = list.length ? `${list.length} image(s) · ${marked} with guides` : "No image";
    if (!list.length) {
      const e = document.createElement("div"); e.className = "lhsg-empty";
      e.innerHTML = from === "needrun"
        ? "Run the workflow once to bring the images here,<br>then press <b>Draw guides</b>."
        : "Connect an image (Multi Image Loader, Load Image, …)<br>or press <b>Load image</b>.";
      grid.replaceChildren(e); return;
    }
    const cells = await Promise.all(list.map(async (s, i) => {
      const sh = shapesFor(data, s, present);
      const cell = document.createElement("div"); cell.className = "lhsg-cell" + (sh.length ? " has" : ""); cell.title = s.name;
      cell.appendChild(await thumbCanvas(s, sh, 160));
      const l = document.createElement("div"); l.className = "lbl"; l.textContent = `${i + 1}. ${s.name}`; cell.appendChild(l);
      cell.onclick = () => openEditor(node, i);
      return cell;
    }));
    if (my === token) grid.replaceChildren(...cells);
  }
  node.lhsRender = render;

  // refresh when the connection or the upstream loader changes
  const onConn = node.onConnectionsChange;
  node.onConnectionsChange = function () {
    const r = onConn?.apply(this, arguments);
    setTimeout(() => { autoConnectLabels(node, "image"); render(); }, 0);
    return r;
  };
  let lastSig = "";
  const timer = setInterval(() => {
    if (!node.graph) return;
    autoConnectLabels(node, "image");
    const o = linkedOrigin(node);
    const sig = o ? `${o.id}|${o.type}|${W(o, "images")?.value ?? ""}|${W(o, "image")?.value ?? ""}|${W(o, "start_index")?.value}|${W(o, "max_images")?.value}` : `own|${W(node, "source_image")?.value}`;
    if (sig !== lastSig) { lastSig = sig; render(); }
  }, 1000);
  const onRemoved = node.onRemoved;
  node.onRemoved = function () { clearInterval(timer); fileInput.remove(); return onRemoved?.apply(this, arguments); };

  render();
  node.setSize([Math.max(node.size[0], 380), Math.max(node.size[1], 360)]);
}

app.registerExtension({
  name: "LHS.ImageGuide",
  beforeConfigureGraph(graphData) {
    try { migrateGraphData(graphData); } catch (e) { console.warn("[LHS ImageGuide] migration failed", e); }
  },
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE) return;
    injectStyle();
    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onCreated?.apply(this, arguments);
      this.properties = this.properties || {};
      this.properties.lhs_outputs_v = OUTPUTS_V;   // new node: already in the new output order
      setupNode(this); return r;
    };
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = onConfigure?.apply(this, arguments);
      setTimeout(() => {
        for (const n of ["guides", "source_image"]) { const w = W(this, n); if (w) w.hidden = true; }
        this.lhsRender?.();
      }, 0);
      return r;
    };
    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (msg) {
      const r = onExecuted?.apply(this, arguments);
      if (msg?.lhs_sources) { this.lhsSources = msg.lhs_sources; this.lhsRender?.(); }
      try {   // no stray image preview under the node
        const o = app.nodeOutputs, k = String(this.id);
        if (o?.[k]?.images) { delete o[k].images; app.nodeOutputs = o; }
      } catch { /* ignore */ }
      this.imgs = undefined;
      return r;
    };
  },
});
