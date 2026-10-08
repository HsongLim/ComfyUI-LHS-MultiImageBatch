import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE = "LHS_ImageCompare";
const LOADER = "MIT_MultiImageLoader";
const COL = { A: "#2f7bf6", B: "#f2862b" };
const MODES = [["slider", "Slider"], ["side", "Side by side"], ["flip", "Flip A/B"], ["diff", "Difference"]];
const HELP = "Wheel zoom · Drag pan · Double-click fit · 1-4 views · ←/→ pairs · Space flip A/B · S swap · Esc close";

function injectStyle() {
  if (document.getElementById("lhscmp-style")) return;
  const s = document.createElement("style");
  s.id = "lhscmp-style";
  s.textContent = `
  .lhscmp{display:flex;flex-direction:column;gap:5px;height:100%;box-sizing:border-box;font-family:sans-serif;font-size:12px;color:#ddd}
  .lhscmp-bar{display:flex;gap:4px;align-items:center;flex-wrap:wrap}
  .lhscmp-bar button{background:#333;color:#ddd;border:1px solid #555;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:12px}
  .lhscmp-bar button:hover{background:#444}
  .lhscmp-bar button.on{background:#555;border-color:#999;color:#fff}
  .lhscmp-bar button:disabled{opacity:.4;cursor:default}
  .lhscmp-seg{display:flex}
  .lhscmp-seg button{border-radius:0;margin-left:-1px}
  .lhscmp-seg button:first-child{border-radius:4px 0 0 4px;margin-left:0}
  .lhscmp-seg button:last-child{border-radius:0 4px 4px 0}
  .lhscmp-nav{display:flex;gap:4px;align-items:center;margin-left:auto;min-width:0}
  .lhscmp-nav span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;color:#ccc}
  .lhscmp-view{position:relative;flex:1 1 auto;min-height:0;height:360px;background:#141414;border-radius:6px;overflow:hidden;resize:vertical}
  .lhscmp-view canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:crosshair}
  .lhscmp-fs{position:fixed;inset:0;z-index:10000;background:#0e0e0e;display:flex;flex-direction:column;padding:10px;gap:8px;box-sizing:border-box}
  .lhscmp-fs .lhscmp-view{height:auto;flex:1;resize:none;border-radius:4px}
  .lhscmp-fs .help{color:#888;font-size:12px;text-align:center}
  `;
  document.head.appendChild(s);
}

const viewURL = (im) => api.apiURL("/view?" + new URLSearchParams({
  filename: im.filename, subfolder: im.subfolder || "", type: im.type || "temp" }).toString());
const W = (node, name) => node.widgets?.find((w) => w.name === name);

// ------------------------------------------------------------------ images
const cache = new Map();
function getImg(im, onload) {
  if (!im) return null;
  const url = viewURL(im);
  let e = cache.get(url);
  if (!e) {
    e = new Image();
    e.onload = () => { for (const f of e._waiters || []) f(); e._waiters = []; };
    e._waiters = [];
    e.src = url;
    cache.set(url, e);
    if (cache.size > 200) cache.delete(cache.keys().next().value);
  }
  if (!e.complete && onload) e._waiters.push(onload);
  return e.complete && e.naturalWidth ? e : null;
}

const diffCache = new Map();
function getDiff(a, b, key) {
  if (diffCache.has(key)) return diffCache.get(key);
  const w = a.naturalWidth, h = a.naturalHeight;
  const c1 = document.createElement("canvas"); c1.width = w; c1.height = h;
  const x = c1.getContext("2d");
  x.drawImage(a, 0, 0, w, h);
  x.globalCompositeOperation = "difference";
  x.drawImage(b, 0, 0, w, h);
  const c2 = document.createElement("canvas"); c2.width = w; c2.height = h;
  const y = c2.getContext("2d");
  y.filter = "brightness(400%)";
  y.drawImage(c1, 0, 0);
  diffCache.set(key, c2);
  if (diffCache.size > 20) diffCache.delete(diffCache.keys().next().value);
  return c2;
}

// ------------------------------------------------------------------ labels
function originOf(node, name) {
  const i = node.inputs?.findIndex((x) => x.name === name);
  if (i == null || i < 0 || node.inputs[i].link == null) return null;
  return node.getInputNode?.(i) || null;
}

function autoLabel(node, which) {
  const custom = (W(node, `label_${which.toLowerCase()}`)?.value || "").trim();
  if (custom) return custom;
  const o = originOf(node, `image_${which.toLowerCase()}`);
  if (!o) return which === "A" ? "image A" : "image B";
  if (o.type === LOADER) return "";   // use the file name of each pair
  if (o.type === "LoadImage") {
    const v = String(W(o, "image")?.value || "");
    if (v) return v.replace(/\\/g, "/").split("/").pop();
  }
  return o.title || o.type;
}

function findUpstreamLoader(node, inputName) {
  const start = originOf(node, inputName);
  const queue = start ? [start] : [], seen = new Set([node.id]);
  while (queue.length) {
    const n = queue.shift();
    if (seen.has(n.id)) continue; seen.add(n.id);
    if (n.type === LOADER) return n;
    (n.inputs || []).forEach((inp, i) => { if (inp.link != null) { const o = n.getInputNode?.(i); if (o) queue.push(o); } });
  }
  return null;
}

function autoConnectLabels(node) {
  const li = node.inputs?.findIndex((i) => i.name === "labels");
  if (li == null || li < 0 || node.inputs[li].link != null) return;
  const loader = findUpstreamLoader(node, "image_a") || findUpstreamLoader(node, "image_b");
  if (!loader) return;
  node.properties = node.properties || {};
  if (node.properties.lhs_auto_labels === loader.id) return;
  const oi = loader.outputs?.findIndex((o) => o.name === "filenames");
  if (oi == null || oi < 0) return;
  loader.connect(oi, node, li);
  node.properties.lhs_auto_labels = loader.id;
}

// ------------------------------------------------------------------ drawing
function roundRect(x, l, t, w, h, r) {
  x.beginPath(); x.moveTo(l + r, t); x.arcTo(l + w, t, l + w, t + h, r); x.arcTo(l + w, t + h, l, t + h, r);
  x.arcTo(l, t + h, l, t, r); x.arcTo(l, t, l + w, t, r); x.closePath();
}

function badge(x, text, color, px, py, align, dpr, big) {
  const fs = (big ? 16 : 12) * dpr, pad = (big ? 9 : 6) * dpr, h = fs + pad * 1.4;
  x.font = `bold ${fs}px sans-serif`;
  const w = Math.min(x.measureText(text).width + pad * 2, x.canvas.width * (align === "center" ? 0.94 : 0.48));
  const l = align === "right" ? px - w : align === "center" ? px - w / 2 : px;
  x.save();
  x.shadowColor = "rgba(0,0,0,.6)"; x.shadowBlur = 6 * dpr;
  x.fillStyle = color; roundRect(x, l, py, w, h, 5 * dpr); x.fill();
  x.restore();
  x.save();
  roundRect(x, l, py, w, h, 5 * dpr); x.clip();
  x.fillStyle = "#fff"; x.textBaseline = "middle"; x.font = `bold ${fs}px sans-serif`;
  x.fillText(text, l + pad, py + h / 2);
  x.restore();
  return h;
}

function fitRect(aw, ah, iw, ih, view, ox = 0) {
  const s = Math.min(aw / iw, ah / ih) * view.z;
  const w = iw * s, h = ih * s;
  return { x: ox + (aw - w) / 2 + view.x, y: (ah - h) / 2 + view.y, w, h, s };
}

function drawView(cv, st, view, redraw) {
  const dpr = window.devicePixelRatio || 1;
  const cw = Math.max(1, Math.round(cv.clientWidth * dpr)), ch = Math.max(1, Math.round(cv.clientHeight * dpr));
  if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
  const x = cv.getContext("2d");
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.fillStyle = "#141414"; x.fillRect(0, 0, cw, ch);
  x.imageSmoothingEnabled = view.z < 3;
  const pair = st.pairs[st.idx];
  if (!pair) {
    x.fillStyle = "#888"; x.font = `${13 * dpr}px sans-serif`; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText("Connect image_a / image_b and run to compare", cw / 2, ch / 2);
    x.textAlign = "left";
    return;
  }
  const sw = st.swap;
  const ia = sw ? pair.b : pair.a, ib = sw ? pair.a : pair.b;
  const A = getImg(ia, redraw), B = getImg(ib, redraw);
  const nameA = st.labelA || pair.name || "image A", nameB = st.labelB || pair.name || "image B";
  const la = sw ? nameB : nameA, lb = sw ? nameA : nameB;
  const tagA = sw ? "B" : "A", tagB = sw ? "A" : "B";
  const colA = COL[tagA], colB = COL[tagB];
  const base = ia || ib;
  const iw = base.w || A?.naturalWidth || 1, ih = base.h || A?.naturalHeight || 1;
  const sizeTxt = (im) => (im ? `${im.w}×${im.h}` : "missing");
  const diffSize = ia && ib && (ia.w !== ib.w || ia.h !== ib.h);
  const textA = `${tagA} · ${la} · ${sizeTxt(ia)}`;
  const textB = `${tagB} · ${lb} · ${sizeTxt(ib)}${diffSize ? " (scaled to fit)" : ""}`;
  const m = 8 * dpr;
  const vz = { z: view.z, x: view.x * dpr, y: view.y * dpr };

  if (st.mode === "side") {
    const half = cw / 2;
    for (const [img, tx, col, ox] of [[A, textA, colA, 0], [B, textB, colB, half]]) {
      x.save(); x.beginPath(); x.rect(ox, 0, half, ch); x.clip();
      const r = fitRect(half, ch, iw, ih, vz, ox);
      if (img) x.drawImage(img, r.x, r.y, r.w, r.h);
      x.strokeStyle = col; x.lineWidth = 3 * dpr; x.strokeRect(ox + 1.5 * dpr, 1.5 * dpr, half - 3 * dpr, ch - 3 * dpr);
      badge(x, tx, col, ox + m, m, "left", dpr);
      x.restore();
    }
    return;
  }

  const r = fitRect(cw, ch, iw, ih, vz);
  if (st.mode === "flip") {
    const showB = st.flipB;
    const img = showB ? B : A;
    if (img) x.drawImage(img, r.x, r.y, r.w, r.h);
    const col = showB ? colB : colA;
    x.strokeStyle = col; x.lineWidth = 5 * dpr; x.strokeRect(2.5 * dpr, 2.5 * dpr, cw - 5 * dpr, ch - 5 * dpr);
    badge(x, showB ? textB : textA, col, cw / 2, m, "center", dpr, true);
    x.font = `${11 * dpr}px sans-serif`; x.fillStyle = "rgba(255,255,255,.75)"; x.textAlign = "center";
    x.fillText("click / Space = flip A ⇄ B", cw / 2, ch - 10 * dpr); x.textAlign = "left";
    return;
  }

  if (st.mode === "diff") {
    if (A && B) x.drawImage(getDiff(A, B, `${viewURL(ia)}|${viewURL(ib)}`), r.x, r.y, r.w, r.h);
    const h = badge(x, "Difference |A − B| ×4  (black = same)", "#555", cw / 2, m, "center", dpr);
    badge(x, textA, colA, m, m + h + 4 * dpr, "left", dpr);
    badge(x, textB, colB, cw - m, m + h + 4 * dpr, "right", dpr);
    return;
  }

  // slider
  const sx = Math.round(st.split * cw);
  if (A) x.drawImage(A, r.x, r.y, r.w, r.h);
  x.save(); x.beginPath(); x.rect(sx, 0, cw - sx, ch); x.clip();
  if (B) x.drawImage(B, r.x, r.y, r.w, r.h);
  x.restore();
  x.fillStyle = "#fff"; x.fillRect(sx - 1 * dpr, 0, 2 * dpr, ch);
  x.fillStyle = colA; x.fillRect(sx - 4 * dpr, 0, 3 * dpr, ch);
  x.fillStyle = colB; x.fillRect(sx + 1 * dpr, 0, 3 * dpr, ch);
  const cy = ch / 2;
  x.beginPath(); x.arc(sx, cy, 13 * dpr, 0, Math.PI * 2); x.fillStyle = "#fff"; x.fill();
  x.fillStyle = "#222"; x.font = `bold ${11 * dpr}px sans-serif`; x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText("◀▶", sx, cy + 0.5 * dpr); x.textAlign = "left";
  badge(x, textA, colA, m, m, "left", dpr);
  badge(x, textB, colB, cw - m, m, "right", dpr);
  // small A/B tags next to the line
  const ty = ch - 30 * dpr;
  if (sx > 40 * dpr) badge(x, tagA, colA, sx - 8 * dpr, ty, "right", dpr);
  if (sx < cw - 40 * dpr) badge(x, tagB, colB, sx + 8 * dpr, ty, "left", dpr);
}

// ------------------------------------------------------------------ UI
function buildBar(st, onChange, extra) {
  const bar = document.createElement("div"); bar.className = "lhscmp-bar";
  const seg = document.createElement("div"); seg.className = "lhscmp-seg";
  const modeBtns = MODES.map(([k, l], i) => {
    const b = document.createElement("button"); b.textContent = l; b.title = `${l} (${i + 1})`;
    b.onclick = (e) => { e.stopPropagation(); st.mode = k; onChange(); };
    seg.appendChild(b); return [k, b];
  });
  const swap = document.createElement("button"); swap.textContent = "⇄ Swap"; swap.title = "Swap A and B (S)";
  swap.onclick = (e) => { e.stopPropagation(); st.swap = !st.swap; onChange(); };
  const nav = document.createElement("div"); nav.className = "lhscmp-nav";
  const prev = document.createElement("button"); prev.textContent = "‹"; prev.title = "Previous pair (←)";
  const next = document.createElement("button"); next.textContent = "›"; next.title = "Next pair (→)";
  const info = document.createElement("span");
  prev.onclick = (e) => { e.stopPropagation(); st.go(-1); };
  next.onclick = (e) => { e.stopPropagation(); st.go(1); };
  nav.append(prev, info, next);
  bar.append(seg, swap, nav, ...(extra || []));
  bar.update = () => {
    for (const [k, b] of modeBtns) b.classList.toggle("on", st.mode === k);
    swap.classList.toggle("on", st.swap);
    const n = st.pairs.length;
    nav.style.display = n > 1 ? "" : "none";
    prev.disabled = st.idx <= 0; next.disabled = st.idx >= n - 1;
    const name = st.pairs[st.idx]?.name;
    info.textContent = n ? `${st.idx + 1} / ${n}${name ? `  ${name}` : ""}` : "";
    info.title = name || "";
  };
  return bar;
}

function attachPointer(cv, st, view, redraw, opts) {
  let drag = null;
  cv.addEventListener("pointermove", (e) => {
    const rect = cv.getBoundingClientRect();
    if (drag) {
      view.x = drag.vx + (e.clientX - drag.x); view.y = drag.vy + (e.clientY - drag.y);
      drag.moved = drag.moved || Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3;
      redraw(); return;
    }
    if (st.mode === "slider") { st.split = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)); redraw(); }
  });
  cv.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    if (e.button !== 0 && e.button !== 1) return;
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, pan: opts.pan };
    if (!opts.pan) drag = { ...drag, nopan: true };
    cv.setPointerCapture?.(e.pointerId);
  });
  const end = (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved && st.mode === "flip") { st.flipB = !st.flipB; redraw(); }
    if (d.nopan) { view.x = 0; view.y = 0; redraw(); }
  };
  cv.addEventListener("pointerup", end);
  cv.addEventListener("pointercancel", end);
  if (opts.pan) {
    cv.addEventListener("wheel", (e) => {
      e.preventDefault(); e.stopPropagation();
      const rect = cv.getBoundingClientRect();
      const mx = e.clientX - rect.left - rect.width / 2, my = e.clientY - rect.top - rect.height / 2;
      const f = Math.exp(-e.deltaY * 0.0015);
      const z = Math.min(40, Math.max(0.2, view.z * f)), k = z / view.z;
      view.x = mx - (mx - view.x) * k; view.y = my - (my - view.y) * k; view.z = z;
      redraw();
    }, { passive: false });
  }
}

function openFullscreen(node) {
  const st = node.cmpState;
  const view = { z: 1, x: 0, y: 0 };
  const fs = document.createElement("div"); fs.className = "lhscmp lhscmp-fs";
  const close = document.createElement("button"); close.textContent = "✕ Close"; close.title = "Close (Esc)";
  const fit = document.createElement("button"); fit.textContent = "Fit"; fit.title = "Fit to screen (F / double-click)";
  const box = document.createElement("div"); box.className = "lhscmp-view";
  const cv = document.createElement("canvas"); box.appendChild(cv);
  const help = document.createElement("div"); help.className = "help"; help.textContent = HELP;
  let raf = 0;
  const redraw = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { bar.update(); drawView(cv, st, view, redraw); }); };
  const bar = buildBar(st, () => { st.changed(); redraw(); }, [fit, close]);
  fs.append(bar, box, help);
  document.body.appendChild(fs);
  attachPointer(cv, st, view, redraw, { pan: true });
  const doFit = () => { view.z = 1; view.x = 0; view.y = 0; redraw(); };
  fit.onclick = doFit;
  cv.addEventListener("dblclick", doFit);
  const onKey = (e) => {
    const k = e.key;
    let used = true;
    if (k === "Escape") done();
    else if (k >= "1" && k <= "4") { st.mode = MODES[+k - 1][0]; st.changed(); }
    else if (k === "ArrowLeft") st.go(-1);
    else if (k === "ArrowRight") st.go(1);
    else if (k === " ") { if (st.mode !== "flip") st.mode = "flip"; st.flipB = !st.flipB; st.changed(); }
    else if (k === "s" || k === "S") { st.swap = !st.swap; st.changed(); }
    else if (k === "f" || k === "F" || k === "0") doFit();
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); redraw(); }
  };
  window.addEventListener("keydown", onKey, true);
  const ro = new ResizeObserver(redraw); ro.observe(box);
  const prevHook = st.onExternal;
  st.onExternal = () => { prevHook?.(); redraw(); };
  close.onclick = () => done();
  function done() {
    window.removeEventListener("keydown", onKey, true); ro.disconnect(); fs.remove();
    st.onExternal = prevHook;
  }
  redraw();
}

function setupNode(node) {
  node.properties = node.properties || {};
  const st = node.cmpState = {
    pairs: [], idx: 0, mode: node.properties.lhs_cmp_mode || "slider", split: 0.5,
    swap: false, flipB: false, labelA: "image A", labelB: "image B",
    go(d) { const n = this.pairs.length; this.idx = Math.max(0, Math.min(n - 1, this.idx + d)); this.flipB = false; this.changed(); },
    changed() { node.properties.lhs_cmp_mode = this.mode; render(); this.onExternal?.(); },
    onExternal: null,
  };
  const wrap = document.createElement("div"); wrap.className = "lhscmp";
  const full = document.createElement("button"); full.textContent = "⛶"; full.title = "Full screen (or double-click the image)";
  full.onclick = (e) => { e.stopPropagation(); openFullscreen(node); };
  const bar = buildBar(st, () => st.changed(), [full]);
  const box = document.createElement("div"); box.className = "lhscmp-view";
  const cv = document.createElement("canvas"); box.appendChild(cv);
  wrap.append(bar, box);
  const view = { z: 1, x: 0, y: 0 };
  let raf = 0;
  function render() {
    st.labelA = autoLabel(node, "A"); st.labelB = autoLabel(node, "B");
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { bar.update(); drawView(cv, st, view, render); });
  }
  attachPointer(cv, st, view, render, { pan: false });
  cv.addEventListener("dblclick", (e) => { e.stopPropagation(); openFullscreen(node); });
  const applyH = () => { box.style.height = `${Math.max(140, Math.min(2000, node.properties.lhs_cmp_h || 360))}px`; };
  applyH();
  box.addEventListener("pointerup", () => { const h = parseInt(box.style.height, 10); if (h) node.properties.lhs_cmp_h = h; });
  const ro = new ResizeObserver(() => render()); ro.observe(box);

  node.addDOMWidget("lhs_compare_view", "lhs_compare_view", wrap, { serialize: false, hideOnZoom: false, getMinHeight: () => 220 });
  node.cmpRender = () => { applyH(); render(); };

  const onConn = node.onConnectionsChange;
  node.onConnectionsChange = function () {
    const r = onConn?.apply(this, arguments);
    setTimeout(() => { autoConnectLabels(node); render(); }, 0);
    return r;
  };
  for (const n of ["label_a", "label_b"]) {
    const w = W(node, n);
    if (w) { const cb = w.callback; w.callback = function () { const r = cb?.apply(this, arguments); render(); return r; }; }
  }
  const timer = setInterval(() => { if (node.graph) autoConnectLabels(node); }, 1500);
  const onRemoved = node.onRemoved;
  node.onRemoved = function () { clearInterval(timer); ro.disconnect(); return onRemoved?.apply(this, arguments); };
  render();
  node.setSize([Math.max(node.size[0], 480), Math.max(node.size[1], 480)]);
}

app.registerExtension({
  name: "LHS.ImageCompare",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE) return;
    injectStyle();
    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () { const r = onCreated?.apply(this, arguments); setupNode(this); return r; };
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      setTimeout(() => { if (this.cmpState) this.cmpState.mode = this.properties?.lhs_cmp_mode || "slider"; this.cmpRender?.(); }, 0);
      return r;
    };
    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (msg) {
      const r = onExecuted?.apply(this, arguments);
      if (msg?.lhs_compare && this.cmpState) {
        const st = this.cmpState;
        st.pairs = msg.lhs_compare;
        if (st.idx >= st.pairs.length) st.idx = 0;
        st.flipB = false;
        st.changed();
      }
      return r;
    };
  },
});
