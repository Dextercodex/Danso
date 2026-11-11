/* Danso — page-world script (runs in the page's JS context at document_start)
 * - hooks fetch / XHR / URL.createObjectURL to sniff 3D files (by magic bytes) and keep a copy
 * - observes three.js scenes (via the __THREE_DEVTOOLS__ protocol) and exports what is rendered
 * - exposes <model-viewer> exportScene()
 */
(() => {
  'use strict';
  if (window.__dansoMain) return;
  try { Object.defineProperty(window, '__dansoMain', { value: true, enumerable: false }); } catch { return; }
  const IO = globalThis.__DansoIO;
  if (!IO) return;
  const TAG = '__danso';
  const toIso = (type, data) => window.postMessage({ [TAG]: 1, dir: 'm2i', type, ...data }, '*');
  const tick = () => new Promise(r => setTimeout(r, 0));

  const EXT3D = /\.(glb|gltf|obj|fbx|stl|usdz|ply|splat|ksplat|3mf|dae|vrm|drc|3ds|stp|step)(?:$|[?#])/i;
  const ext3d = url => { const m = String(url).split(/[?#]/)[0].match(/\.(glb|gltf|obj|fbx|stl|usdz|ply|splat|ksplat|3mf|dae|vrm|drc|3ds|stp|step)$/i); return m ? m[1].toLowerCase() : null; };
  const MAXBLOB = 400 * 1024 * 1024;
  const stats = { fetch: 0, xhr: 0, blob: 0, assets: 0, workers: 0, offscreen: 0 };
  try {
    const _tco = HTMLCanvasElement.prototype.transferControlToOffscreen;
    if (_tco) HTMLCanvasElement.prototype.transferControlToOffscreen = function () { stats.offscreen++; return _tco.apply(this, arguments); };
    if (window.Worker) window.Worker = new Proxy(window.Worker, { construct(t, a, n) { stats.workers++; return Reflect.construct(t, a, n); } });
  } catch { /* ignore */ }

  /* ---------- captured 3D assets ---------- */
  const seen = new Set();
  const blobStore = new Map();
  function record(url, format, size, source, blob) {
    if (!url || seen.has(url)) return;
    seen.add(url);
    stats.assets++;
    if (blob) {
      blobStore.set(url, blob);
      if (blobStore.size > 12) blobStore.delete(blobStore.keys().next().value);
    }
    toIso('asset3d', { url, format, size, source, cached: !!blob });
  }

  const _fetch = window.fetch;
  if (typeof _fetch === 'function') {
    window.fetch = function (...args) {
      const p = _fetch.apply(this, args);
      p.then(inspectResponse).catch(() => {});
      return p;
    };
  }
  async function inspectResponse(res) {
    try {
      stats.fetch++;
      if (!res || !res.ok || res.type === 'opaque') return;
      const url = res.url;
      if (!url || seen.has(url)) return;
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      const len = +res.headers.get('content-length') || 0;
      const byExt = ext3d(url);
      const byType = /model\/|gltf/.test(ct);
      const generic = !ct || /octet-stream|binary|application\/zip/.test(ct);
      if (len > MAXBLOB) return;
      if (!(byExt || byType || (generic && (len === 0 || len > 2000)))) return;
      const c1 = res.clone(), c2 = res.clone();
      let fmt = byExt || (byType ? (/binary/.test(ct) ? 'glb' : 'gltf') : null);
      if (!fmt && c1.body) {
        const r = c1.body.getReader();
        const { value } = await r.read();
        r.cancel().catch(() => {});
        if (value) fmt = IO.sniff(value);
      } else if (c1.body) c1.body.cancel().catch(() => {});
      if (!fmt) { if (c2.body) c2.body.cancel().catch(() => {}); return; }
      const blob = await c2.blob();
      record(url, fmt, blob.size, 'fetch', blob);
    } catch { /* ignore */ }
  }

  const xo = XMLHttpRequest.prototype.open, xs = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__dansoUrl = u; return xo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', () => {
      try {
        stats.xhr++;
        const url = this.responseURL || this.__dansoUrl;
        if (!url || seen.has(String(url))) return;
        const r = this.response;
        if (r instanceof ArrayBuffer && r.byteLength > 2000 && r.byteLength < MAXBLOB) {
          const f = ext3d(url) || IO.sniff(new Uint8Array(r, 0, Math.min(4096, r.byteLength)));
          if (f) record(String(url), f, r.byteLength, 'xhr', new Blob([r]));
        } else if (r instanceof Blob && r.size > 2000 && r.size < MAXBLOB) {
          r.slice(0, 4096).arrayBuffer().then(b => {
            const f = ext3d(url) || IO.sniff(new Uint8Array(b));
            if (f) record(String(url), f, r.size, 'xhr', r);
          });
        }
      } catch { /* ignore */ }
    });
    return xs.apply(this, arguments);
  };

  const _cou = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    const url = _cou.apply(this, arguments);
    stats.blob++;
    try {
      if (obj instanceof Blob && obj.size > 2000 && obj.size < MAXBLOB) {
        const byType = /model\/|gltf/.test(obj.type || '');
        obj.slice(0, 4096).arrayBuffer().then(b => {
          const f = IO.sniff(new Uint8Array(b)) || (byType ? (/binary/.test(obj.type) ? 'glb' : 'gltf') : null);
          if (f) record(url, f, obj.size, 'blob', obj);
        }).catch(() => {});
      }
    } catch { /* ignore */ }
    return url;
  };

  /* ---------- three.js scene observation ---------- */
  const sceneRefs = [];
  try {
    let dev = window.__THREE_DEVTOOLS__;
    if (!dev) {
      dev = new EventTarget();
      Object.defineProperty(window, '__THREE_DEVTOOLS__', { value: dev, configurable: true, writable: true });
    }
    dev.addEventListener('observe', e => {
      const o = e.detail;
      if (o && o.isScene) sceneRefs.push(new WeakRef(o));
    });
  } catch { /* ignore */ }

  const sceneIds = new WeakMap();
  let sidc = 0;
  const idOf = s => { let i = sceneIds.get(s); if (!i) { i = ++sidc; sceneIds.set(s, i); } return i; };
  function liveScenes() {
    const out = new Set();
    for (let i = sceneRefs.length - 1; i >= 0; i--) {
      const s = sceneRefs[i].deref();
      if (!s) sceneRefs.splice(i, 1); else out.add(s);
    }
    return [...out];
  }

  const HELPER_RE = /(^|[\s_\-.])(helper|gizmo|axes|axis|grid|shadow|outline|collider|hitbox|bounding|bbox|selection|measure)/i;
  function* walk(o) {
    if (o.visible === false) return;
    yield o;
    for (const c of o.children) yield* walk(c);
  }
  function renderable(o, clean) {
    if (!(o.isMesh || o.isSkinnedMesh)) return false;
    const g = o.geometry;
    if (!g || !g.attributes || !g.attributes.position || !g.attributes.position.count) return false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!mats.some(m => m && m.visible !== false && !(m.transparent && m.opacity === 0))) return false;
    if (clean) {
      if (mats.every(m => m && m.isShadowMaterial)) return false;
      if (HELPER_RE.test(o.name || '') || mats.some(m => m && HELPER_RE.test(m.name || ''))) return false;
      if (o.userData && o.userData.isHelper) return false;
    }
    return true;
  }

  function summarize(scene, clean) {
    scene.updateMatrixWorld(true);
    let meshes = 0, tris = 0, verts = 0, hasTex = false;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const o of walk(scene)) {
      if (!renderable(o, clean)) continue;
      const g = o.geometry;
      meshes++;
      verts += g.attributes.position.count;
      tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (mat && mat.map) hasTex = true;
      try {
        if (!g.boundingBox) g.computeBoundingBox();
        const b = g.boundingBox, e = o.matrixWorld.elements;
        for (let k = 0; k < 8; k++) {
          const x = k & 1 ? b.max.x : b.min.x, y = k & 2 ? b.max.y : b.min.y, z = k & 4 ? b.max.z : b.min.z;
          const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
          if (wx < mn[0]) mn[0] = wx; if (wy < mn[1]) mn[1] = wy; if (wz < mn[2]) mn[2] = wz;
          if (wx > mx[0]) mx[0] = wx; if (wy > mx[1]) mx[1] = wy; if (wz > mx[2]) mx[2] = wz;
        }
      } catch { /* ignore */ }
    }
    const size = meshes && isFinite(mn[0]) ? [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]].map(v => +v.toPrecision(4)) : null;
    return { id: idOf(scene), name: scene.name || 'Scene', meshes, tris: Math.round(tris), verts, size, hasTex };
  }

  /* ---------- three.js -> intermediate model ---------- */
  const texCache = new Map();
  function texToPng(tex) {
    if (!tex) return Promise.resolve(null);
    if (texCache.has(tex)) return texCache.get(tex);
    const p = (async () => {
      try {
        const img = tex.image || (tex.source && tex.source.data);
        if (!img) return null;
        const w0 = img.width || img.videoWidth || img.naturalWidth, h0 = img.height || img.videoHeight || img.naturalHeight;
        if (!w0 || !h0) return null;
        const k = Math.min(1, 4096 / Math.max(w0, h0));
        const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        if (img.data && img.data.length && !(img instanceof Element)) {
          if (img.data.length !== w0 * h0 * 4) return null;
          const id = new ImageData(new Uint8ClampedArray(img.data), w0, h0);
          cv.width = w0; cv.height = h0;
          ctx.putImageData(id, 0, 0);
        } else if (typeof ImageData !== 'undefined' && img instanceof ImageData) {
          cv.width = w0; cv.height = h0;
          ctx.putImageData(img, 0, 0);
        } else {
          if (tex.flipY) { ctx.translate(0, h); ctx.scale(1, -1); }
          ctx.drawImage(img, 0, 0, w, h);
        }
        const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
        if (!blob) return null;
        return { mime: 'image/png', bytes: new Uint8Array(await blob.arrayBuffer()) };
      } catch { return null; }
    })();
    texCache.set(tex, p);
    return p;
  }

  const matCache = new Map();
  function convMat(m) {
    if (!m) return Promise.resolve(null);
    if (matCache.has(m)) return matCache.get(m);
    const p = (async () => {
      const c = m.color || { r: 1, g: 1, b: 1 };
      const em = m.emissive ? (m.emissiveIntensity == null ? 1 : m.emissiveIntensity) : 0;
      const out = {
        name: m.name || '',
        color: [c.r, c.g, c.b, typeof m.opacity === 'number' ? m.opacity : 1],
        metallic: typeof m.metalness === 'number' ? Math.min(1, Math.max(0, m.metalness)) : 0,
        roughness: typeof m.roughness === 'number' ? Math.min(1, Math.max(0, m.roughness)) : 1,
        emissive: m.emissive ? [m.emissive.r * em, m.emissive.g * em, m.emissive.b * em] : [0, 0, 0],
        doubleSided: m.side === 2,
        normalScale: m.normalScale ? m.normalScale.x : 1,
        textures: {}
      };
      if (m.alphaTest > 0) { out.alphaMode = 'MASK'; out.alphaCutoff = m.alphaTest; }
      const [base, normal, emissive] = await Promise.all([texToPng(m.map), texToPng(m.normalMap), texToPng(m.emissiveMap)]);
      if (base) out.textures.base = base;
      if (normal) out.textures.normal = normal;
      if (emissive) out.textures.emissive = emissive;
      const orm = m.metalnessMap && m.metalnessMap === m.roughnessMap ? m.metalnessMap : (m.roughnessMap || m.metalnessMap);
      if (orm) { const t = await texToPng(orm); if (t) out.textures.orm = t; }
      return out;
    })();
    matCache.set(m, p);
    return p;
  }

  const pixCache = new Map(), lightCache = new Map();
  function texPixels(tex) {
    if (pixCache.has(tex)) return pixCache.get(tex);
    const p = (async () => {
      try {
        const img = tex.image || (tex.source && tex.source.data);
        if (!img || (img.data && !(img instanceof Element))) return null;
        const w0 = img.width || img.videoWidth || img.naturalWidth, h0 = img.height || img.videoHeight || img.naturalHeight;
        if (!w0 || !h0) return null;
        const k = Math.min(1, 256 / Math.max(w0, h0));
        const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        if (tex.flipY) { ctx.translate(0, h); ctx.scale(1, -1); }
        ctx.drawImage(img, 0, 0, w, h);
        return { w, h, data: ctx.getImageData(0, 0, w, h).data };
      } catch { return null; }
    })();
    pixCache.set(tex, p);
    return p;
  }
  function convMatLight(m) {
    if (!m) return Promise.resolve(null);
    if (lightCache.has(m)) return lightCache.get(m);
    const p = (async () => {
      const c = m.color || { r: 1, g: 1, b: 1 };
      return { color: [c.r, c.g, c.b, 1], pix: m.map ? await texPixels(m.map) : null };
    })();
    lightCache.set(m, p);
    return p;
  }

  function attrToF32(attr, size) {
    const n = attr.count;
    const out = new Float32Array(n * size);
    if (!attr.isInterleavedBufferAttribute && !attr.normalized && attr.array instanceof Float32Array && attr.itemSize === size) {
      out.set(attr.array.subarray(0, n * size));
      return out;
    }
    for (let i = 0; i < n; i++) {
      out[i * size] = attr.getX(i);
      if (size > 1) out[i * size + 1] = attr.getY(i);
      if (size > 2) out[i * size + 2] = attr.getZ(i);
      if (size > 3) out[i * size + 3] = attr.getW(i);
    }
    return out;
  }

  async function addMesh(model, o, light) {
    const g = o.geometry;
    const pos = g.attributes.position;
    const n = pos.count;
    const posed = (o.isSkinnedMesh || (o.morphTargetInfluences && o.morphTargetInfluences.length && g.morphAttributes && g.morphAttributes.position)) && typeof o.getVertexPosition === 'function';
    let P;
    if (posed) {
      P = new Float32Array(n * 3);
      const v = new (o.position.constructor)();
      for (let i = 0; i < n; i++) { o.getVertexPosition(i, v); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z; }
    } else P = attrToF32(pos, 3);
    const N = !posed && g.attributes.normal ? attrToF32(g.attributes.normal, 3) : null;
    const UV = g.attributes.uv ? attrToF32(g.attributes.uv, 2) : null;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const colAttr = g.attributes.color;
    const useVC = !!(colAttr && mats.some(m => m && m.vertexColors));
    const C = useVC ? attrToF32(colAttr, colAttr.itemSize >= 4 ? 4 : 3) : null;
    const CS = C ? (colAttr.itemSize >= 4 ? 4 : 3) : 0;
    if (C && colAttr.itemSize !== CS) return; // unsupported layout
    const index = g.index ? g.index.array : null;

    const slices = [];
    if (Array.isArray(o.material) && g.groups && g.groups.length) {
      const total = index ? index.length : n;
      for (const gr of g.groups) {
        const start = gr.start, count = Math.min(gr.count, total - start);
        if (count <= 0) continue;
        const m = mats[gr.materialIndex];
        if (!m || m.visible === false) continue;
        const idx = new Uint32Array(count);
        for (let i = 0; i < count; i++) idx[i] = index ? index[start + i] : start + i;
        slices.push({ idx, mat: m });
      }
    } else {
      const m = mats[0];
      slices.push({ idx: index ? (index instanceof Uint32Array ? index : Uint32Array.from(index)) : null, mat: m });
    }

    let worlds;
    if (o.isInstancedMesh) {
      const M = o.matrixWorld.constructor;
      const mtx = new M();
      worlds = [];
      for (let i = 0; i < Math.min(o.count, 3000); i++) {
        o.getMatrixAt(i, mtx);
        mtx.premultiply(o.matrixWorld);
        worlds.push(Array.from(mtx.elements));
      }
    } else worlds = [Array.from(o.matrixWorld.elements)];

    for (const e of worlds) {
      const Pw = IO.transformPositions(P, e);
      const Nw = N ? IO.transformNormals(N, e) : null;
      for (const s of slices) {
        model.meshes.push({
          name: o.name || g.name || 'mesh',
          positions: Pw, normals: Nw, uvs: UV, colors: C || undefined, colorSize: CS || undefined,
          indices: s.idx || undefined, material: await (light ? convMatLight(s.mat) : convMat(s.mat))
        });
      }
    }
  }

  async function extractScene(scene, clean, light) {
    scene.updateMatrixWorld(true);
    const model = { meshes: [] };
    let c = 0;
    for (const o of walk(scene)) {
      if (!renderable(o, clean)) continue;
      await addMesh(model, o, light);
      if (++c % 15 === 0) await tick();
    }
    if (!model.meshes.length) throw new Error('empty');
    return model;
  }

  /* ---------- <model-viewer> ---------- */
  const mvList = () => Array.from(document.querySelectorAll('model-viewer'));

  /* ---------- scanning ---------- */
  let lastScan = '';
  function scanNow(force) {
    try {
      const scenes = liveScenes().map(s => summarize(s, true)).filter(s => s.meshes > 0).sort((a, b) => b.tris - a.tris);
      const mvs = mvList().map((el, i) => ({ id: i, src: el.getAttribute('src') || el.src || '', alt: el.getAttribute('alt') || '', loaded: !!el.loaded }));
      const sig = JSON.stringify([scenes, mvs]);
      if (!force && sig === lastScan) return;
      lastScan = sig;
      toIso('scan', { scenes, mvs });
    } catch { /* ignore */ }
  }
  setInterval(() => {
    if (document.visibilityState === 'visible' && (sceneRefs.length || document.querySelector('model-viewer'))) scanNow(false);
  }, 4000);

  /* ---------- export ---------- */
  const nameFromUrl = url => {
    try { const s = decodeURIComponent(new URL(url, location.href).pathname.split('/').pop() || ''); return s || 'model'; } catch { return 'model'; }
  };
  const pageBase = () => IO.safeName((document.title || location.hostname).slice(0, 40)) || 'danso';
  async function getBlobFor(url) {
    const b = blobStore.get(url);
    if (b) return b;
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error('fetch ' + r.status);
    return r.blob();
  }

  async function runExport(d) {
    const { kind, format, clean } = d;
    if (kind === 'scene') {
      const s = liveScenes().find(x => idOf(x) === d.id);
      if (!s) throw new Error('scene-gone');
      const model = await extractScene(s, clean !== false);
      return IO.exportModel(model, format, pageBase() + '-' + (IO.safeName(s.name) || 'scene'));
    }
    if (kind === 'cached') {
      const blob = await getBlobFor(d.url);
      if (format === 'original') return { blob, filename: nameFromUrl(d.url) };
      const model = await IO.parseGLTF(await blob.arrayBuffer(), d.url);
      return IO.exportModel(model, format, IO.safeName(nameFromUrl(d.url).replace(/\.[^.]+$/, '')) || pageBase());
    }
    if (kind === 'mv') {
      const el = mvList()[d.id];
      if (!el || typeof el.exportScene !== 'function') throw new Error('mv-unavailable');
      const blob = await el.exportScene({ binary: true });
      const base = IO.safeName(el.getAttribute('alt') || nameFromUrl(el.getAttribute('src') || '').replace(/\.[^.]+$/, '')) || pageBase();
      if (format === 'glb') return { blob, filename: base + '.glb' };
      const model = await IO.parseGLTF(await blob.arrayBuffer(), location.href);
      return IO.exportModel(model, format, base);
    }
    throw new Error('bad-kind');
  }

  function diag() {
    const w = window;
    let scenes = [];
    try { scenes = liveScenes().map(s => summarize(s, true)); } catch { /* ignore */ }
    return {
      frame: location.origin + location.pathname, top: window === window.top,
      threeObserved: sceneRefs.length, threeScenes: scenes,
      globals: { THREE: !!w.THREE, BABYLON: !!w.BABYLON, PIXI: !!w.PIXI, playcanvas: !!w.pc, AFRAME: !!w.AFRAME, Cesium: !!w.Cesium, modelViewerDefined: !!(window.customElements && customElements.get('model-viewer')) },
      modelViewers: document.querySelectorAll('model-viewer').length,
      canvases: Array.from(document.querySelectorAll('canvas')).slice(0, 8).map(c => c.width + 'x' + c.height),
      iframes: document.querySelectorAll('iframe').length,
      stats, assetsCaptured: blobStore.size, seenAssets: Array.from(seen).slice(0, 10).map(u => String(u).split('?')[0].slice(0, 160))
    };
  }

  async function runPreview(d) {
    let model;
    if (d.kind === 'scene') {
      const s = liveScenes().find(x => idOf(x) === d.id);
      if (!s) throw new Error('scene-gone');
      model = await extractScene(s, d.clean !== false, true);
    } else {
      let blob;
      if (d.kind === 'cached') blob = await getBlobFor(d.url);
      else if (d.kind === 'mv') {
        const el = mvList()[d.id];
        if (!el || typeof el.exportScene !== 'function') throw new Error('mv-unavailable');
        blob = await el.exportScene({ binary: true });
      } else throw new Error('bad-kind');
      model = await IO.parseGLTF(await blob.arrayBuffer(), d.url || location.href);
      await IO.attachPix(model);
    }
    const pv = IO.buildPreview(model, d.max || 30000);
    return { pos: IO.b64(new Uint8Array(pv.pos.buffer)), col: IO.b64(pv.col), n: pv.n, total: pv.total };
  }

  window.addEventListener('message', async e => {
    const d = e.data;
    if (e.source !== window || !d || d[TAG] !== 1 || d.dir !== 'i2m') return;
    if (d.type === 'scan') { scanNow(true); return; }
    if (d.type === 'preview') {
      try { toIso('res', { reqId: d.reqId, ok: true, data: await runPreview(d) }); }
      catch (err) { toIso('res', { reqId: d.reqId, ok: false, error: (err && (err.code || err.message)) || String(err) }); }
      return;
    }
    if (d.type === 'diag') { toIso('res', { reqId: d.reqId, ok: true, data: diag() }); return; }
    if (d.type === 'export') {
      try {
        const r = await runExport(d);
        toIso('res', { reqId: d.reqId, ok: true, blob: r.blob, filename: r.filename });
      } catch (err) {
        toIso('res', { reqId: d.reqId, ok: false, error: (err && (err.code || err.message)) || String(err) });
      }
    }
  });

  toIso('hello', {});
})();
