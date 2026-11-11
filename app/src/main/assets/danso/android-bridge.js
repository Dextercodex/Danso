/* Danso Android — page bridge (runs in the page world, top frame only, after model-io.js + main.js) */
(() => {
  'use strict';
  const B = window.DansoPage;
  if (!B || window !== window.top || window.__dansoAnd) return;
  window.__dansoAnd = true;
  const TAG = '__danso';
  const IO = globalThis.__DansoIO;
  const post = o => { try { B.msg(JSON.stringify(o)); } catch { /* ignore */ } };
  const tick = () => new Promise(r => setTimeout(r, 0));

  /* ---------- messages from main.js ---------- */
  const waiting = new Map();
  window.addEventListener('message', e => {
    const d = e.data;
    if (e.source !== window || !d || d[TAG] !== 1 || d.dir !== 'm2i') return;
    if (d.type === 'hello') post({ k: 'hello' });
    else if (d.type === 'scan') post({ k: 'scan', scenes: d.scenes, mvs: d.mvs });
    else if (d.type === 'asset3d') post({ k: 'asset3d', item: { url: d.url, format: d.format, size: d.size, source: d.source, cached: d.cached } });
    else if (d.type === 'res') { const w = waiting.get(d.reqId); if (w) { waiting.delete(d.reqId); w(d); } }
  });
  const ask = msg => new Promise(res => { waiting.set(msg.reqId, res); window.postMessage({ [TAG]: 1, dir: 'i2m', ...msg }, '*'); });

  async function stream(reqId, blob, name) {
    const u8 = new Uint8Array(await blob.arrayBuffer());
    const CH = 393216; // multiple of 3 -> clean base64 chunks
    const n = Math.max(1, Math.ceil(u8.length / CH));
    for (let i = 0; i < n; i++) {
      B.chunk(reqId, i, n, IO.b64(u8.subarray(i * CH, (i + 1) * CH)));
      if (i % 4 === 3) await tick();
    }
    B.fileDone(reqId, name, blob.type || 'application/octet-stream');
  }

  /* ---------- DOM scan ---------- */
  let idc = 0;
  const idOf = new WeakMap(), idMap = new Map();
  const elId = el => { let i = idOf.get(el); if (!i) { i = ++idc; idOf.set(el, i); idMap.set(i, new WeakRef(el)); } return i; };
  const absUrl = u => { try { return new URL(u, document.baseURI).href; } catch { return null; } };
  const isSvgUrl = u => /\.svgz?(?:$|[?#])/i.test(u) || /^data:image\/svg\+xml/i.test(u);
  const bestSrcset = s => {
    if (!s) return null;
    let best = null, bw = -1;
    for (const part of s.split(',')) { const [u, d] = part.trim().split(/\s+/); if (!u) continue; const w = d ? parseFloat(d) || 0 : 1; if (w > bw) { bw = w; best = u; } }
    return best;
  };
  const BG = /url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/g;

  function scanDom() {
    const out = [], seen = new Set();
    let markupBudget = 1500000;
    const push = o => {
      if (!o.url || seen.has(o.url)) return;
      if (o.url.startsWith('data:') && o.url.length > 4000) return;
      seen.add(o.url); out.push(o);
    };
    const img = (u, el, via) => {
      const url = absUrl(u); if (!url) return;
      push({ kind: isSvgUrl(url) ? 'svg-file' : 'image', url, w: el ? el.naturalWidth || 0 : 0, h: el ? el.naturalHeight || 0 : 0, via, name: (el && el.alt) || '' });
    };
    for (const el of document.images) {
      img(el.currentSrc || el.src, el, 'img');
      const best = absUrl(bestSrcset(el.srcset));
      if (best && best !== (el.currentSrc || el.src)) img(best, el, 'srcset');
      for (const a of ['data-src', 'data-original', 'data-lazy-src', 'data-full']) { const v = el.getAttribute(a); if (v && !/^\s*data:/.test(v)) img(v, el, 'lazy'); }
    }
    document.querySelectorAll('video').forEach(v => {
      const url = absUrl(v.currentSrc || v.src);
      if (url) push({ kind: 'video', url, w: v.videoWidth || 0, h: v.videoHeight || 0, dur: isFinite(v.duration) ? v.duration : 0, mse: url.startsWith('blob:') });
      v.querySelectorAll('source[src]').forEach(s => { const u = absUrl(s.src); if (u) push({ kind: 'video', url: u }); });
      if (v.poster) img(v.poster, null, 'poster');
    });
    document.querySelectorAll('audio').forEach(a => {
      const url = absUrl(a.currentSrc || a.src);
      if (url) push({ kind: 'audio', url, dur: isFinite(a.duration) ? a.duration : 0 });
    });
    document.querySelectorAll('link[rel~="icon"], meta[property="og:image"], meta[name="twitter:image"]').forEach(l => { const u = l.getAttribute('href') || l.getAttribute('content'); if (u) img(u, null, 'meta'); });
    const all = document.querySelectorAll('body *');
    const lim = Math.min(all.length, 1800);
    for (let i = 0; i < lim; i++) {
      const bg = getComputedStyle(all[i]).backgroundImage;
      if (!bg || bg === 'none' || bg.indexOf('url(') < 0) continue;
      BG.lastIndex = 0; let m;
      while ((m = BG.exec(bg))) { const u = absUrl(m[1] || m[2] || m[3]); if (u) push({ kind: isSvgUrl(u) ? 'svg-file' : 'image', url: u, via: 'css' }); }
    }
    let sc = 0;
    document.querySelectorAll('svg').forEach(el => {
      if (sc >= 120 || (el.parentElement && el.parentElement.closest('svg'))) return;
      const r = el.getBoundingClientRect();
      if ((r.width < 1 && r.height < 1 && !el.querySelector('symbol')) || !el.firstElementChild) return;
      let markup = '';
      try { markup = new XMLSerializer().serializeToString(el); } catch { /* ignore */ }
      if (markup.length > 300000 || markup.length > markupBudget) markup = '';
      markupBudget -= markup.length;
      sc++;
      push({ kind: 'svg', url: 'svg:' + elId(el), w: Math.round(r.width), h: Math.round(r.height), markup, name: el.getAttribute('aria-label') || el.id || '', el: elId(el) });
    });
    document.querySelectorAll('canvas').forEach(c => { if (c.width >= 48 && c.height >= 48) push({ kind: 'canvas', url: 'canvas:' + elId(c), w: c.width, h: c.height, el: elId(c) }); });
    return out.slice(0, 900);
  }
  function perfInfo() {
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource');
    let bytes = nav ? nav.transferSize || 0 : 0;
    for (const r of res) bytes += r.transferSize || 0;
    return {
      protocol: nav ? nav.nextHopProtocol : '', ttfb: nav ? Math.round(nav.responseStart - nav.requestStart) : 0,
      dns: nav ? Math.round(nav.domainLookupEnd - nav.domainLookupStart) : 0, connect: nav ? Math.round(nav.connectEnd - nav.connectStart) : 0,
      tls: nav && nav.secureConnectionStart > 0 ? Math.round(nav.connectEnd - nav.secureConnectionStart) : 0,
      load: nav && nav.loadEventEnd ? Math.round(nav.loadEventEnd - nav.startTime) : 0, requests: res.length, bytes,
      lang: document.documentElement.lang || '', charset: document.characterSet, cookies: document.cookie ? document.cookie.split(';').length : 0,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone
    };
  }
  let timer = 0, last = '';
  function reportDom() {
    timer = 0;
    try {
      const items = scanDom();
      const msg = JSON.stringify({ k: 'dom', items, perf: perfInfo(), title: document.title });
      if (msg === last) return;
      last = msg;
      B.msg(msg);
    } catch { /* ignore */ }
  }
  const schedule = ms => { if (!timer) timer = setTimeout(reportDom, ms || 1000); };
  const pokeMain = () => window.postMessage({ [TAG]: 1, dir: 'i2m', type: 'scan' }, '*');
  const start = () => {
    if (document.documentElement) new MutationObserver(() => schedule(1500)).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'poster'] });
    schedule(400); pokeMain();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  window.addEventListener('load', () => { schedule(500); pokeMain(); }, { once: true });

  /* ---------- commands from native ---------- */
  async function run(cmd) {
    const id = cmd.reqId;
    try {
      if (cmd.op === 'export') {
        const d = await ask({ type: 'export', reqId: id, ...cmd.payload });
        if (!d.ok) throw new Error(d.error);
        await stream(id, d.blob, d.filename);
      } else if (cmd.op === 'preview') {
        const d = await ask({ type: 'preview', reqId: id, ...cmd.payload });
        if (!d.ok) throw new Error(d.error);
        B.json(id, JSON.stringify(d.data));
      } else if (cmd.op === 'fetchblob') {
        const r = await fetch(cmd.payload.url, { credentials: 'include' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await stream(id, await r.blob(), cmd.payload.filename || 'file');
      } else if (cmd.op === 'canvas') {
        const ref = idMap.get(cmd.payload.el), c = ref && ref.deref();
        if (!c) throw new Error('element-gone');
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        if (!blob) throw new Error('canvas-empty');
        await stream(id, blob, (cmd.payload.filename || 'canvas') + '.png');
      } else throw new Error('bad-op');
    } catch (e) {
      B.err(id, String((e && (e.code || e.message)) || e));
    }
  }
  window.__dansoAnd = { run, scan() { pokeMain(); clearTimeout(timer); timer = 0; last = ''; reportDom(); } };
})();
