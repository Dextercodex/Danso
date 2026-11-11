/* Danso — tiny software 3D preview (canvas 2D, flat shaded, painter's algorithm) */
(() => {
  'use strict';
  const { h, t } = Danso;
  const L = (() => { const v = [-0.35, 0.55, 0.75]; const l = Math.hypot(...v); return v.map(x => x / l); })();

  function create() {
    const cv = h('canvas', { width: 640, height: 440 });
    const ctx = cv.getContext('2d');
    const st = h('div', { class: 'st' });
    const info = h('span', { class: 'ltr mono' });
    const rf = h('button', { class: 'btn sm rf', title: t('pv_refresh'), onclick: () => api.onRefresh && api.onRefresh() }, '↻');
    const el = h('div', { class: 'pv' }, cv, st, rf, h('div', { class: 'hint' }, h('span', null, t('pv_hint')), info));
    const s = { data: null, cx: 0, cy: 0, cz: 0, radius: 1, yaw: 0.6, pitch: 0.3, zoom: 1, lod: false, raf: 0, timer: 0 };
    const api = { el, onRefresh: null };

    function draw() {
      s.raf = 0;
      const d = s.data, W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);
      if (!d) return;
      const { pos, col } = d;
      const skip = s.lod ? Math.max(1, Math.ceil(d.n / 7000)) : 1;
      const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw), cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
      const scale = Math.min(W, H) * 0.46 / s.radius * s.zoom;
      const sc = new Float32Array(d.n * 6), depth = new Float32Array(d.n), shade = new Float32Array(d.n);
      const idx = [];
      const vx = [0, 0, 0], vy = [0, 0, 0], vz = [0, 0, 0];
      for (let i = 0; i < d.n; i += skip) {
        for (let k = 0; k < 3; k++) {
          const o = i * 9 + k * 3;
          const x = pos[o] - s.cx, y = pos[o + 1] - s.cy, z = pos[o + 2] - s.cz;
          const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
          vx[k] = x1; vy[k] = y * cp - z1 * sp; vz[k] = y * sp + z1 * cp;
        }
        const ux = vx[1] - vx[0], uy = vy[1] - vy[0], uz = vz[1] - vz[0];
        const wx = vx[2] - vx[0], wy = vy[2] - vy[0], wz = vz[2] - vz[0];
        const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        if (nz <= 0) continue;
        const len = Math.hypot(nx, ny, nz) || 1;
        shade[i] = 0.3 + 0.7 * Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / len);
        depth[i] = vz[0] + vz[1] + vz[2];
        for (let k = 0; k < 3; k++) { sc[i * 6 + k * 2] = W / 2 + vx[k] * scale; sc[i * 6 + k * 2 + 1] = H / 2 - vy[k] * scale; }
        idx.push(i);
      }
      idx.sort((a, b) => depth[a] - depth[b]);
      ctx.lineWidth = 0.8; ctx.lineJoin = 'round';
      for (const i of idx) {
        const f = shade[i];
        const c = 'rgb(' + ((col[i * 3] * f) | 0) + ',' + ((col[i * 3 + 1] * f) | 0) + ',' + ((col[i * 3 + 2] * f) | 0) + ')';
        ctx.beginPath();
        ctx.moveTo(sc[i * 6], sc[i * 6 + 1]); ctx.lineTo(sc[i * 6 + 2], sc[i * 6 + 3]); ctx.lineTo(sc[i * 6 + 4], sc[i * 6 + 5]);
        ctx.closePath();
        ctx.fillStyle = c; ctx.fill();
        if (!s.lod) { ctx.strokeStyle = c; ctx.stroke(); }
      }
    }
    const redraw = () => { if (!s.raf) s.raf = requestAnimationFrame(draw); };

    api.status = (kind, msg) => {
      st.textContent = kind === 'loading' ? t('pv_loading') : kind === 'err' ? msg : '';
      if (kind !== 'ok') { s.data = null; ctx.clearRect(0, 0, cv.width, cv.height); info.textContent = ''; }
    };
    api.set = data => {
      s.data = data;
      let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < data.pos.length; i += 3) for (let k = 0; k < 3; k++) { const v = data.pos[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
      s.cx = (mn[0] + mx[0]) / 2; s.cy = (mn[1] + mx[1]) / 2; s.cz = (mn[2] + mx[2]) / 2;
      s.radius = Math.max(1e-6, Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2);
      st.textContent = '';
      info.textContent = Danso.num(data.n) + ' △' + (data.total > data.n ? ' · ' + t('pv_simpl') : '');
      redraw();
    };

    let drag = null;
    cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => {
      if (!drag) return;
      s.yaw += (e.clientX - drag.x) * 0.012; s.pitch = Math.max(-1.55, Math.min(1.55, s.pitch + (e.clientY - drag.y) * 0.012));
      drag = { x: e.clientX, y: e.clientY };
      s.lod = true; redraw();
      clearTimeout(s.timer); s.timer = setTimeout(() => { s.lod = false; redraw(); }, 160);
    });
    const end = () => { drag = null; s.lod = false; redraw(); };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      s.zoom = Math.max(0.3, Math.min(8, s.zoom * Math.exp(-e.deltaY * 0.0012)));
      s.lod = true; redraw();
      clearTimeout(s.timer); s.timer = setTimeout(() => { s.lod = false; redraw(); }, 160);
    }, { passive: false });
    cv.addEventListener('dblclick', () => { s.yaw = 0.6; s.pitch = 0.3; s.zoom = 1; redraw(); });
    return api;
  }

  window.DansoPreview = { create };
})();
