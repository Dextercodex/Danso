/* Danso Android — bottom sheet UI (runs in its own WebView) */
(() => {
  'use strict';
  const { h, t } = Danso;
  const IO = globalThis.__DansoIO;
  const $ = s => document.querySelector(s);
  const FORMATS = ['glb', 'gltf', 'obj', 'stl', 'ply'];
  const S = { tab: '3d', st: null, fmt: 'glb', clean: true, hideTiny: true, filter: 'all', q: '', sel: new Set(), busy: {}, geo: {}, myGeo: null, conn: null, connFor: '', prev: new Map() };

  try {
    const o = JSON.parse(localStorage.getItem('danso') || '{}');
    Danso.lang = o.lang || 'fa';
    if (o.fmt) S.fmt = o.fmt;
    if (o.clean != null) S.clean = o.clean;
    if (o.hideTiny != null) S.hideTiny = o.hideTiny;
  } catch { /* defaults */ }
  const save = () => { try { localStorage.setItem('danso', JSON.stringify({ lang: Danso.lang, fmt: S.fmt, clean: S.clean, hideTiny: S.hideTiny })); } catch { /* ignore */ } };
  const applyLang = () => { document.documentElement.lang = Danso.lang; document.documentElement.dir = Danso.lang === 'fa' ? 'rtl' : 'ltr'; };

  /* ---------- native bridge ---------- */
  const pending = new Map();
  let rid = 0;
  const hasNative = () => typeof window.Native !== 'undefined';
  function call(cmd, timeout = 180000) {
    return new Promise((res, rej) => {
      if (!hasNative()) { rej(new Error('no-native')); return; }
      const id = ++rid;
      const to = setTimeout(() => { pending.delete(id); rej(new Error('timeout')); }, timeout);
      pending.set(id, { res, rej, to });
      window.Native.cmd(JSON.stringify({ ...cmd, reqId: id }));
    });
  }
  window.__result = (id, r) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id); clearTimeout(p.to);
    if (r && r.ok) p.res(r); else p.rej(new Error((r && r.error) || 'failed'));
  };
  window.__state = st => {
    S.st = st;
    if (S.tab === 'media' && mref) { renderChips(); renderList(); updateBulk(); } else schedule();
  };
  Danso.copy = text => { try { window.Native.cmd(JSON.stringify({ type: 'copy', text })); } catch { /* ignore */ } Danso.toast(t('copied'), 'ok'); };

  const runOp = (op, payload) => call({ type: 'run', op, payload });
  let rafId = 0;
  const schedule = () => { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(render); };
  const hostOf = u => { try { return new URL(u).hostname; } catch { return ''; } };
  const errText = msg => {
    msg = String(msg || '');
    if (/compressed/.test(msg)) return t('err_compressed');
    if (/scene-gone/.test(msg)) return t('err_scene_gone');
    if (/empty/.test(msg)) return t('err_empty');
    if (/timeout/.test(msg)) return t('err_generic', 'timeout');
    return t('err_generic', msg);
  };

  /* ---------- helpers shared with 3D + media ---------- */
  function setBusy(key, v) {
    S.busy[key] = v; schedule();
    if (v === 'done' || v === 'err') setTimeout(() => { delete S.busy[key]; schedule(); }, 2200);
  }
  function actBtn(key, label, fn, cls = '') {
    const b = S.busy[key];
    return h('button', { class: 'btn ' + cls + (b === 'done' ? ' ok' : b === 'err' ? ' err' : ''), disabled: b === 'work', onclick: async () => {
      setBusy(key, 'work');
      try { await fn(); setBusy(key, 'done'); } catch (e) { setBusy(key, 'err'); Danso.toast(errText(e && e.message), 'err'); }
    } }, b === 'work' ? [h('span', { class: 'spin' }), ' ', t('working')] : b === 'done' ? t('done') : b === 'err' ? t('failed') : label);
  }

  /* ---------- preview plumbing ---------- */
  const decodePv = d => ({ pos: new Float32Array(IO.fromB64(d.pos).buffer), col: IO.fromB64(d.col), n: d.n, total: d.total });
  async function loadPreview(payload) {
    const r = await runOp('preview', { ...payload, max: 12000 });
    return decodePv(r.data);
  }
  async function pvLoad(p) {
    p.started = true; p.view.status('loading');
    try { p.view.set(await p.loader()); p.view.status('ok'); } catch (e) { p.view.status('err', errText(e && e.message)); }
  }
  function pvGet(key, loader, auto) {
    let p = S.prev.get(key);
    if (!p) { p = { view: DansoPreview.create(), open: auto, started: false }; S.prev.set(key, p); }
    p.loader = loader; p.view.onRefresh = () => pvLoad(p);
    if (p.open && !p.started) pvLoad(p);
    return p;
  }
  const pvAuto = (key, loader) => pvGet(key, loader, true).view.el;
  function pvToggle(key, loader) {
    const p = pvGet(key, loader, false);
    return [h('div', { class: 'btns' }, h('button', { class: 'btn sm', onclick: () => { p.open = !p.open; if (p.open && !p.started) pvLoad(p); render(); } }, p.open ? '▾ ' + t('pv_hide') : '▸ ' + t('pv_show'))), p.open ? p.view.el : null];
  }

  /* ---------- 3D ---------- */
  function collect3d() {
    const st = S.st || {};
    const files = new Map();
    for (const a of st.assets || []) files.set(a.url, { url: a.url, format: a.format, size: a.size, cached: a.cached });
    for (const n of st.net || []) if (n.kind === '3d' && !files.has(n.url)) files.set(n.url, { url: n.url, format: n.ext, size: null, cached: false });
    const list = [...files.values()];
    return { scenes: st.scenes || [], mvs: st.mvs || [], files: list, hook: !!st.hook, total: (st.scenes || []).length + (st.mvs || []).length + list.length };
  }
  const fmtPicker = () => h('div', null,
    h('div', { class: 'seg', role: 'group' }, FORMATS.map(f => h('button', { 'aria-pressed': String(S.fmt === f), onclick: () => { S.fmt = f; save(); render(); } }, f.toUpperCase()))),
    S.fmt === 'obj' ? h('p', { class: 'note' }, t('format_hint_obj')) : null);
  const fileName = url => Danso.fileName(url);
  const exportFile = async (f, format) => {
    if (format === 'original' && !f.cached) { await call({ type: 'download', url: f.url, filename: Danso.safe(fileName(f.url)) }); return; }
    await runOp('export', { kind: 'cached', url: f.url, format });
  };

  function render3D(root) {
    const d = collect3d();
    root.append(h('p', { class: 'note', style: 'margin:0 0 12px' }, d.hook ? '● ' + t('hook_on') : '○ ' + t('hook_off')));
    if (!d.total) {
      root.append(h('div', { class: 'empty' }, h('h3', null, t('empty3d_t')), h('p', null, t('empty3d_d')),
        h('button', { class: 'btn primary', onclick: () => call({ type: 'reload' }, 1000).catch(() => {}) }, t('reload'))));
      return;
    }
    if (d.scenes.length) {
      const sec = h('section', { class: 'sec' }, h('div', { class: 'sec-h' }, h('b', null, t('scenes'))));
      sec.append(h('p', { class: 'note', style: 'margin:0 0 8px' }, t('scene_hint')), fmtPicker());
      d.scenes.forEach((s, i) => {
        const key = 'scene:' + s.id;
        sec.append(h('div', { class: 'card' },
          h('div', { class: 'row' }, h('h3', { class: 'grow ttl' }, s.name === 'Scene' ? 'Scene ' + (i + 1) : s.name)),
          h('div', { class: 'stats' },
            h('span', { class: 'stat' }, h('b', null, Danso.num(s.meshes)), ' ' + t('meshes')),
            h('span', { class: 'stat' }, h('b', null, Danso.num(s.tris)), ' ' + t('tris')),
            s.size ? h('span', { class: 'stat ltr' }, s.size.join(' × ')) : null,
            s.hasTex ? h('span', { class: 'stat' }, t('textured')) : null),
          pvAuto(key, () => loadPreview({ kind: 'scene', id: s.id, clean: S.clean })),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.clean, onchange: e => { S.clean = e.target.checked; save(); } }), t('skip_helpers')),
          h('div', { style: 'margin-top:10px' }, actBtn(key, t('dl_as', S.fmt.toUpperCase()), () => runOp('export', { kind: 'scene', id: s.id, format: S.fmt, clean: S.clean }), 'primary block'))));
      });
      root.append(sec);
    }
    if (d.mvs.length) {
      const sec = h('section', { class: 'sec' }, h('div', { class: 'sec-h' }, h('b', null, t('mv'))));
      if (!d.scenes.length) sec.append(fmtPicker());
      d.mvs.forEach(m => {
        const key = 'mv:' + m.id;
        sec.append(h('div', { class: 'card' },
          h('div', { class: 'row' }, h('h3', { class: 'grow ttl' }, m.alt || fileName(m.src || 'model-viewer'))),
          pvToggle(key + ':pv', () => loadPreview({ kind: 'mv', id: m.id })),
          h('div', { style: 'margin-top:10px' }, actBtn(key, t('dl_as', S.fmt.toUpperCase()), () => runOp('export', { kind: 'mv', id: m.id, format: S.fmt }), 'primary block'))));
      });
      root.append(sec);
    }
    if (d.files.length) {
      const sec = h('section', { class: 'sec' }, h('div', { class: 'sec-h' }, h('b', null, t('files'))));
      d.files.forEach(f => {
        const fmt = (f.format || '').toLowerCase();
        const convertible = fmt === 'glb' || fmt === 'gltf';
        sec.append(h('div', { class: 'card' },
          h('div', { class: 'row' }, h('span', { class: 'badge' }, fmt || '3d'), h('h3', { class: 'grow ttl ltr', title: f.url }, fileName(f.url)), f.size ? h('span', { class: 'mute' }, Danso.bytes(f.size)) : null),
          h('div', { class: 'mute mono ltr ttl', style: 'margin-top:4px' }, hostOf(f.url)),
          convertible ? pvToggle('f:' + f.url + ':pv', () => loadPreview({ kind: 'cached', url: f.url })) : null,
          h('div', { class: 'btns' },
            actBtn('f:' + f.url + ':o', t('dl_orig'), () => exportFile(f, 'original'), 'primary'),
            convertible ? FORMATS.filter(x => x !== fmt).map(x => actBtn('f:' + f.url + ':' + x, x.toUpperCase(), () => exportFile(f, x), 'sm')) : null,
            h('button', { class: 'btn sm', onclick: () => Danso.copy(f.url) }, t('copy_url')))));
      });
      root.append(sec);
    }
  }

  /* ---------- media ---------- */
  const GROUP = { image: 'image', canvas: 'image', 'svg-file': 'svg', svg: 'svg', video: 'video', stream: 'video', audio: 'audio' };
  function collectMedia() {
    const st = S.st;
    if (!st) return [];
    const map = new Map();
    for (const it of st.dom || []) if (!map.has(it.url)) map.set(it.url, { ...it });
    for (const n of st.net || []) {
      if (n.kind === '3d') continue;
      const cur = map.get(n.url);
      if (cur) { if (n.kind === 'svg-file' || n.kind === 'stream') cur.kind = n.kind; cur.ext = n.ext; } else map.set(n.url, { ...n });
    }
    const arr = [...map.values()].map(it => ({ ...it, group: GROUP[it.kind] || 'image' }));
    arr.sort((a, b) => ((b.w || 0) * (b.h || 0)) - ((a.w || 0) * (a.h || 0)));
    return arr;
  }
  const isTiny = it => it.group === 'image' && it.w && it.h && it.w <= 24 && it.h <= 24;
  const mediaFiltered = () => {
    const q = S.q.trim().toLowerCase();
    return collectMedia().filter(it => (S.filter === 'all' || it.group === S.filter) && !(S.hideTiny && isTiny(it)) && (!q || it.url.toLowerCase().includes(q) || (it.name || '').toLowerCase().includes(q)));
  };
  const keyOf = it => it.kind + '|' + it.url;
  function nameFor(it) {
    if (it.kind === 'svg') return Danso.safe((it.name || 'inline') + '-' + it.el) + '.svg';
    if (it.kind === 'canvas') return 'canvas-' + it.el;
    return Danso.fileName(it.url);
  }
  async function downloadItem(it) {
    if (it.kind === 'svg') {
      if (!it.markup) throw new Error('svg too large');
      await call({ type: 'saveText', name: nameFor(it), mime: 'image/svg+xml', text: it.markup });
    } else if (it.kind === 'canvas') await runOp('canvas', { el: it.el, filename: nameFor(it) });
    else if (/^(blob|data):/.test(it.url)) await runOp('fetchblob', { url: it.url, filename: nameFor(it) });
    else await call({ type: 'download', url: it.url, filename: nameFor(it) });
  }
  function thumb(it) {
    const ph = label => h('div', { class: 'ph' }, h('span', { class: 'badge alt' }, label));
    if (it.kind === 'svg') return it.markup ? h('img', { src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(it.markup), alt: '' }) : ph('SVG');
    if (it.kind === 'canvas') return ph('canvas');
    if (it.kind === 'stream') return ph('HLS/DASH');
    if (it.group === 'video') return /^blob:/.test(it.url) ? ph(t('mse_note')) : h('video', { src: it.url, preload: 'metadata', muted: true, onerror: e => e.target.replaceWith(ph('video')) });
    if (it.group === 'audio') return ph('audio');
    return h('img', { src: it.url, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: e => e.target.replaceWith(ph(it.ext || 'img')) });
  }
  function tile(it) {
    const k = keyOf(it);
    const canDl = it.kind !== 'stream' && !(it.group === 'video' && it.mse);
    const dims = it.w && it.h ? it.w + '×' + it.h : '';
    return h('div', { class: 'tile', dataset: { sel: S.sel.has(k) ? '1' : '0' } },
      canDl ? h('input', { class: 'pick', type: 'checkbox', checked: S.sel.has(k), onchange: e => { e.target.checked ? S.sel.add(k) : S.sel.delete(k); e.target.closest('.tile').dataset.sel = e.target.checked ? '1' : '0'; updateBulk(); } }) : null,
      h('span', { class: 'badge kind' }, it.kind === 'svg-file' ? 'svg' : (it.ext || it.kind)),
      h('div', { class: 'thumb' }, thumb(it)),
      h('div', { class: 'tmeta ltr' }, h('span', { class: 'nm', title: it.url }, nameFor(it)), [dims, it.dur ? Math.round(it.dur) + 's' : ''].filter(Boolean).join(' · ')),
      h('div', { class: 'tact' },
        canDl ? actBtn('m:' + k, '⤓ ' + t('dl'), () => downloadItem(it), 'sm') : h('button', { onclick: () => Danso.copy(it.url) }, t('copy_url')),
        /^https?:/.test(it.url) ? h('button', { onclick: () => Danso.copy(it.url) }, '⧉') : null));
  }
  let mref = null;
  function updateBulk() {
    if (!mref) return;
    const n = S.sel.size;
    mref.bulk.replaceChildren(
      h('button', { class: 'btn sm', onclick: () => { mediaFiltered().forEach(it => { if (it.kind !== 'stream') S.sel.add(keyOf(it)); }); renderList(); updateBulk(); } }, t('sel_all')),
      n ? h('button', { class: 'btn sm primary', onclick: async () => { for (const it of collectMedia().filter(x => S.sel.has(keyOf(x)))) { try { await downloadItem(it); } catch (e) { Danso.toast(errText(e.message), 'err'); } } } }, t('dl_sel', Danso.num(n))) : null,
      n ? h('button', { class: 'btn sm', onclick: () => { S.sel.clear(); renderList(); updateBulk(); } }, t('clear')) : null,
      h('label', { class: 'check', style: 'margin:0' }, h('input', { type: 'checkbox', checked: S.hideTiny, onchange: e => { S.hideTiny = e.target.checked; save(); renderList(); renderChips(); } }), t('hide_tiny')));
  }
  function renderChips() {
    if (!mref) return;
    const all = collectMedia().filter(it => !(S.hideTiny && isTiny(it)));
    const cnt = g => (g === 'all' ? all.length : all.filter(i => i.group === g).length);
    mref.chips.replaceChildren(...[['all', 'all'], ['image', 'images'], ['video', 'videos'], ['audio', 'audios'], ['svg', 'svgs']].map(([g, k]) =>
      h('button', { class: 'chip', 'aria-pressed': String(S.filter === g), onclick: () => { S.filter = g; renderChips(); renderList(); } }, t(k), h('b', null, Danso.num(cnt(g))))));
  }
  function renderList() {
    if (!mref) return;
    const items = mediaFiltered();
    mref.list.replaceChildren(items.length ? h('div', { class: 'grid' }, items.slice(0, 300).map(tile)) : h('div', { class: 'empty' }, h('h3', null, t('no_media')), h('p', null, t('no_media_d'))));
  }
  function renderMedia(root) {
    mref = { chips: h('div', { class: 'chips' }), bulk: h('div', { class: 'bulk' }), list: h('div') };
    root.append(h('div', { class: 'toolbar' }, h('input', { class: 'search', type: 'search', value: S.q, placeholder: t('search'), oninput: e => { S.q = e.target.value; renderList(); } }), mref.chips, mref.bulk), mref.list);
    renderChips(); renderList(); updateBulk();
  }

  /* ---------- connection ---------- */
  const PRIVATE = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|::1$|fe80:|fc|fd)/i;
  async function geoLookup(ip) {
    const key = 'geo:' + ip;
    try { const c = JSON.parse(localStorage.getItem(key) || 'null'); if (c && Date.now() - c.t < 6048e5) return c.d; } catch { /* ignore */ }
    let d = null;
    try {
      const r = await fetch('https://ipwho.is/' + encodeURIComponent(ip) + '?fields=ip,success,type,country,country_code,region,city,flag,connection,timezone');
      const j = await r.json();
      if (j && j.success !== false) d = { ip: j.ip, country: j.country, cc: j.country_code, region: j.region, city: j.city, flag: j.flag && j.flag.emoji, asn: j.connection && j.connection.asn, org: j.connection && (j.connection.org || j.connection.isp), domain: j.connection && j.connection.domain, tz: j.timezone && j.timezone.id, utc: j.timezone && j.timezone.utc };
    } catch { /* fall through */ }
    if (d) try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), d })); } catch { /* ignore */ }
    return d;
  }
  function ensureGeo(ip) {
    if (!ip || S.geo[ip]) return;
    if (PRIVATE.test(ip)) { S.geo[ip] = 'local'; return; }
    S.geo[ip] = 'loading';
    geoLookup(ip).then(d => { S.geo[ip] = d || 'err'; schedule(); });
  }
  function ensureMy() {
    if (S.myGeo) return;
    S.myGeo = 'loading';
    (async () => {
      try { const r = await fetch('https://ipwho.is/?fields=ip,success,country,country_code,city,flag,connection,timezone'); const j = await r.json(); S.myGeo = j && j.success !== false ? { ip: j.ip, country: j.country, cc: j.country_code, city: j.city, flag: j.flag && j.flag.emoji, org: j.connection && (j.connection.org || j.connection.isp), tz: j.timezone && j.timezone.id } : 'err'; } catch { S.myGeo = 'err'; }
      schedule();
    })();
  }
  function ensureConn() {
    const url = S.st && S.st.url;
    if (!url || S.connFor === url) return;
    S.connFor = url; S.conn = 'loading';
    call({ type: 'conn', url }, 30000).then(r => { S.conn = r; if (r.ip) ensureGeo(r.ip); schedule(); }).catch(() => { S.conn = 'err'; schedule(); });
  }
  function detectCdn(c, org) {
    const n = c.names || [], v = c.vals || {}, srv = (v.server || '').toLowerCase(), out = [];
    if (n.includes('cf-ray') || srv.includes('cloudflare')) out.push('Cloudflare');
    if (n.includes('x-amz-cf-id') || /cloudfront/i.test(v.via || '')) out.push('Amazon CloudFront');
    if (n.includes('x-vercel-id')) out.push('Vercel');
    if (n.includes('x-nf-request-id')) out.push('Netlify');
    if (n.includes('x-fastly-request-id') || /fastly/i.test(v['x-served-by'] || '')) out.push('Fastly');
    if (srv.includes('akamai') || n.some(x => x.startsWith('x-akamai'))) out.push('Akamai');
    if (n.some(x => x.includes('arvan')) || srv.includes('arvan')) out.push('ArvanCloud');
    if (n.includes('x-github-request-id')) out.push('GitHub Pages');
    if (!out.length && org && /cloudflare|akamai|fastly|cloudfront|arvan/i.test(org)) out.push(org);
    return [...new Set(out)];
  }
  const kv = (k, v, copy = true) => (v == null || v === '' ? null : [h('dt', null, k), h('dd', { class: copy ? 'ltr' : 'plain', onclick: copy ? () => Danso.copy(String(v)) : null }, v)]);
  const clock = tz => { try { return new Intl.DateTimeFormat(Danso.locale(), { dateStyle: 'medium', timeStyle: 'medium', timeZone: tz || undefined }).format(new Date()); } catch { return ''; } };

  function renderConn(root) {
    const st = S.st;
    if (!st || !st.url) { root.append(h('div', { class: 'empty' }, h('h3', null, t('c_noconn')), h('p', null, t('empty_page')))); return; }
    ensureConn(); ensureMy();
    const u = new URL(st.url), c = S.conn && typeof S.conn === 'object' ? S.conn : null, ip = c && c.ip;
    if (ip) ensureGeo(ip);
    const g = ip ? S.geo[ip] : null, gd = g && typeof g === 'object' ? g : null, pi = st.perf || null;
    const cdn = c ? detectCdn(c, gd && gd.org) : [];
    const proto = pi && pi.protocol ? ({ h2: 'HTTP/2', h3: 'HTTP/3', 'http/1.1': 'HTTP/1.1' }[pi.protocol] || pi.protocol) : '';

    root.append(h('div', { class: 'card' }, h('div', { class: 'hero' }, h('div', { class: 'grow', style: 'min-width:0' }, h('h3', { class: 'ltr ttl' }, u.hostname), h('div', { class: 'mute mono ltr ttl' }, u.pathname)),
      h('div', { class: 'btns', style: 'margin:0' }, u.protocol === 'https:' ? h('span', { class: 'badge' }, '🔒 https') : h('span', { class: 'badge alt' }, 'http'), proto ? h('span', { class: 'badge alt' }, proto) : null))));

    const sv = h('div', { class: 'card' }, h('div', { class: 'sec-h' }, h('b', null, t('c_server'))));
    if (S.conn === 'loading' || !S.conn) sv.append(h('p', { class: 'note' }, h('span', { class: 'spin' }), ' ' + t('c_loading')));
    else if (!ip) sv.append(h('p', { class: 'note warn' }, t('c_geo_fail')));
    else {
      sv.append(h('div', { class: 'bigip ltr', onclick: () => Danso.copy(ip) }, ip));
      if (g === 'loading') sv.append(h('p', { class: 'note' }, h('span', { class: 'spin' }), ' ' + t('c_loading')));
      else if (g === 'local') sv.append(h('p', { class: 'note' }, t('c_local')));
      else if (g === 'err') sv.append(h('p', { class: 'note warn' }, t('c_geo_fail')), h('button', { class: 'btn sm', onclick: () => { delete S.geo[ip]; schedule(); } }, t('c_retry')));
      else if (gd) {
        sv.append(h('dl', { class: 'kv' },
          kv(t('c_country'), (gd.flag ? gd.flag + ' ' : '') + (gd.country || '') + (gd.cc ? ' (' + gd.cc + ')' : '')), kv(t('c_region'), gd.region), kv(t('c_city'), gd.city),
          kv(t('c_isp'), gd.org), kv(t('c_asn'), gd.asn ? 'AS' + String(gd.asn).replace(/^AS/i, '') : ''), kv(t('c_domain'), gd.domain),
          kv(t('c_tz'), gd.tz ? gd.tz + (gd.utc ? '  (' + t('c_offset', gd.utc) + ')' : '') : ''),
          gd.tz ? [h('dt', null, t('c_time')), h('dd', { class: 'plain' }, h('span', { class: 'clock', dataset: { tz: gd.tz } }, clock(gd.tz)))] : null));
        if (cdn.length) sv.append(h('p', { class: 'note warn' }, t('c_cdn_note')));
      }
    }
    root.append(sv);

    const me = S.myGeo, yc = h('div', { class: 'card' }, h('div', { class: 'sec-h' }, h('b', null, t('c_you'))));
    if (!me || me === 'loading') yc.append(h('p', { class: 'note' }, h('span', { class: 'spin' }), ' ' + t('c_loading')));
    else if (me === 'err') yc.append(h('p', { class: 'note warn' }, t('c_geo_fail')));
    else yc.append(h('dl', { class: 'kv' }, kv(t('c_ip'), me.ip), kv(t('c_country'), (me.flag ? me.flag + ' ' : '') + (me.country || '') + (me.cc ? ' (' + me.cc + ')' : '')), kv(t('c_city'), me.city), kv(t('c_isp'), me.org),
      kv(t('c_tz'), (pi && pi.tz) || me.tz), [h('dt', null, t('c_mytime')), h('dd', { class: 'plain' }, h('span', { class: 'clock', dataset: { tz: (pi && pi.tz) || me.tz || '' } }, clock((pi && pi.tz) || me.tz)))]));
    root.append(yc);

    const v = (c && c.vals) || {};
    root.append(h('div', { class: 'card' }, h('div', { class: 'sec-h' }, h('b', null, t('c_conn'))), h('dl', { class: 'kv' },
      kv(t('c_status'), c && c.status, false), kv(t('c_proto'), proto), kv(t('c_srv'), v.server), kv(t('c_powered'), v['x-powered-by'] || v['x-generator']),
      cdn.length ? kv(t('c_cdn'), cdn.join(', ')) : null, kv(t('c_comp'), v['content-encoding']), kv(t('c_cache'), v['cf-cache-status'] || v['x-vercel-cache'] || v['x-cache'] || v['cache-control']),
      kv(t('c_hsts'), c ? (v['strict-transport-security'] ? t('c_yes') : t('c_no')) : '', false),
      pi ? [kv(t('c_lang'), pi.lang), kv(t('c_charset'), pi.charset), kv(t('c_cookies'), Danso.num(pi.cookies), false)] : null)));

    if (pi) {
      const rows = [['c_dns', pi.dns], ['c_connect', pi.connect], ['c_tls', pi.tls], ['c_ttfb', pi.ttfb], ['c_load', pi.load]];
      const max = Math.max(1, ...rows.map(r => r[1] || 0));
      root.append(h('div', { class: 'card' }, h('div', { class: 'sec-h' }, h('b', null, t('c_perf'))),
        h('div', { class: 'meter' }, rows.map(([k, val]) => h('div', { class: 'm' }, h('span', null, t(k)), h('div', { class: 'bar' }, h('i', { style: 'width:' + Math.round(((val || 0) / max) * 100) + '%' })), h('span', { class: 'v ltr' }, Danso.num(val) + ' ' + t('ms'))))),
        h('dl', { class: 'kv' }, kv(t('c_reqs'), Danso.num(pi.requests), false), kv(t('c_bytes'), Danso.bytes(pi.bytes), false))));
    }
    const hosts = Object.entries(st.hosts || {}).sort((a, b) => b[1] - a[1]).slice(0, 25);
    if (hosts.length) root.append(h('details', { class: 'card dom' }, h('summary', null, h('span', null, t('c_domains')), h('span', { class: 'badge alt' }, Danso.num(Object.keys(st.hosts).length))),
      h('div', { style: 'margin-top:8px' }, hosts.map(([name, n]) => h('div', { class: 'domrow ltr' }, h('span', { class: 'ttl', title: name }, name), h('span', null), h('span', { class: 'mute mono' }, '×' + n))))));
    root.append(h('p', { class: 'note' }, t('c_privacy')));
  }
  setInterval(() => document.querySelectorAll('.clock[data-tz]').forEach(el => { el.textContent = clock(el.dataset.tz); }), 1000);

  /* ---------- shell + render ---------- */
  function counts() {
    return { d3: collect3d().total, media: mediaFiltered().length };
  }
  function renderShell() {
    const c = counts();
    $('#top').replaceChildren(
      h('div', { class: 'brand' }, h('div', null, h('span', { class: 'word' }, t('name')), h('span', { class: 'sub ltr' }, 'DANSO · ANDROID'))),
      h('button', { class: 'iconbtn', title: t('rescan'), onclick: () => { S.geo = {}; S.connFor = ''; call({ type: 'scan' }, 1000).catch(() => {}); schedule(); } }, '⟳'),
      h('button', { class: 'iconbtn', onclick: () => { Danso.lang = Danso.lang === 'fa' ? 'en' : 'fa'; save(); applyLang(); render(); } }, t('lang')),
      h('button', { class: 'iconbtn', title: 'close', onclick: () => call({ type: 'hide' }, 500).catch(() => {}) }, '✕'));
    $('#tabs').replaceChildren(...[['3d', 'tab3d', c.d3], ['media', 'tabMedia', c.media], ['conn', 'tabConn', 0]].map(([id, key, n]) =>
      h('button', { class: 'tab', role: 'tab', 'aria-selected': String(S.tab === id), onclick: () => { S.tab = id; render(); } }, t(key), n ? h('span', { class: 'n' }, Danso.num(n)) : null)));
    $('#foot').replaceChildren(h('span', null, t('mob_note')), h('a', { class: 'ltr', href: '#', onclick: e => { e.preventDefault(); call({ type: 'open', url: 'https://sobhan-khalili.ir' }, 500).catch(() => {}); } }, 'sobhan-khalili.ir'));
  }
  function render() {
    renderShell();
    const main = $('#main'), y = window.scrollY;
    main.replaceChildren(); mref = null;
    if (!S.st || !S.st.url) { main.append(h('div', { class: 'empty' }, h('h3', null, t('name')), h('p', null, t('empty_page')))); return; }
    if (S.tab === '3d') render3D(main); else if (S.tab === 'media') renderMedia(main); else renderConn(main);
    window.scrollTo(0, y);
  }

  applyLang();
  render();
  if (hasNative()) window.Native.ready();
})();
