/* Danso — 3D model I/O
 * Intermediate model:
 *   { meshes: [{ name, positions:Float32Array(world space), normals?:Float32Array, uvs?:Float32Array,
 *                colors?:Float32Array, colorSize?:3|4, indices?:Uint32Array,
 *                material:{ name, color:[r,g,b,a](linear), metallic, roughness, emissive:[r,g,b],
 *                           doubleSided, alphaMode?, alphaCutoff?, normalScale?,
 *                           textures:{ base?, normal?, emissive?, orm? } } }] }
 *   texture = { mime:'image/png'|'image/jpeg', bytes:Uint8Array }
 * UV convention: glTF (origin top-left, image NOT flipped).
 */
(() => {
  'use strict';
  if (globalThis.__DansoIO) return;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  /* ---------- helpers ---------- */
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lin2srgb = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  const to255 = c => Math.round(clamp01(lin2srgb(clamp01(c))) * 255);
  const u8of = ta => new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
  const triCount = m => Math.floor((m.indices ? m.indices.length : m.positions.length / 3) / 3);
  const safeName = s => String(s || '').replace(/[^\p{L}\p{N}_\-.]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  const DEFAULT_MAT = { name: '', color: [1, 1, 1, 1], metallic: 0, roughness: 1, emissive: [0, 0, 0], doubleSided: false, textures: {} };

  function b64(u8) {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }
  function fromB64(str) {
    const bin = atob(str);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function dataUri(uri) {
    const i = uri.indexOf(',');
    const meta = uri.slice(5, i);
    const body = uri.slice(i + 1);
    const mime = meta.split(';')[0] || 'application/octet-stream';
    const bytes = /;base64/i.test(meta) ? fromB64(body) : enc.encode(decodeURIComponent(body));
    return { bytes, mime };
  }

  /* ---------- format sniffing ---------- */
  function sniff(u8) {
    const n = u8.length;
    if (n < 4) return null;
    const s4 = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
    if (s4 === 'glTF') return 'glb';
    if (s4 === 'DRAC') return 'drc';
    if (s4 === 'ply\n' || s4 === 'ply\r') return 'ply';
    if (n >= 18 && String.fromCharCode.apply(null, u8.subarray(0, 18)) === 'Kaydara FBX Binary') return 'fbx';
    let i = 0;
    if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) i = 3;
    while (i < n && (u8[i] === 32 || u8[i] === 10 || u8[i] === 13 || u8[i] === 9)) i++;
    if (u8[i] === 123) {
      const t = dec.decode(u8.subarray(i, Math.min(n, i + 4096)));
      if (/"asset"\s*:\s*\{/.test(t) && /"version"/.test(t)) return 'gltf';
    }
    return null;
  }

  /* ---------- matrices ---------- */
  const mat4mul = (a, b) => {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  };
  const compose = (t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) => {
    const [x, y, z, w] = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    return [
      (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
      (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
      (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
      t[0], t[1], t[2], 1
    ];
  };
  function transformPositions(P, e) {
    const out = new Float32Array(P.length);
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      out[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
      out[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      out[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
    return out;
  }
  function transformNormals(N, e) {
    const a = e[0], b = e[4], c = e[8], d = e[1], ee = e[5], f = e[9], g = e[2], h = e[6], i9 = e[10];
    const c00 = ee * i9 - f * h, c01 = -(d * i9 - f * g), c02 = d * h - ee * g;
    const c10 = -(b * i9 - c * h), c11 = a * i9 - c * g, c12 = -(a * h - b * g);
    const c20 = b * f - c * ee, c21 = -(a * f - c * d), c22 = a * ee - b * d;
    let det = a * c00 + b * c01 + c * c02;
    if (Math.abs(det) < 1e-12) det = 1;
    const out = new Float32Array(N.length);
    for (let i = 0; i < N.length; i += 3) {
      const x = N[i], y = N[i + 1], z = N[i + 2];
      let nx = (c00 * x + c10 * y + c20 * z) / det;
      let ny = (c01 * x + c11 * y + c21 * z) / det;
      let nz = (c02 * x + c12 * y + c22 * z) / det;
      const l = Math.hypot(nx, ny, nz) || 1;
      out[i] = nx / l; out[i + 1] = ny / l; out[i + 2] = nz / l;
    }
    return out;
  }

  /* ---------- glTF builder ---------- */
  function buildGLTF(model) {
    if (!model.meshes.length) throw new Error('empty');
    const parts = [];
    let offset = 0;
    const bufferViews = [], accessors = [], images = [], textures = [], materials = [], meshesJ = [], nodes = [];
    const accCache = new Map(), idxCache = new Map(), texCache = new Map(), matCache = new Map();

    const addView = (u8, target) => {
      const bv = { buffer: 0, byteOffset: offset, byteLength: u8.byteLength };
      if (target) bv.target = target;
      bufferViews.push(bv);
      parts.push(u8);
      offset += u8.byteLength;
      const pad = (4 - (offset % 4)) % 4;
      if (pad) { parts.push(new Uint8Array(pad)); offset += pad; }
      return bufferViews.length - 1;
    };
    const minmax = P => {
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) {
        const v = P[i + k];
        if (v < mn[k]) mn[k] = v;
        if (v > mx[k]) mx[k] = v;
      }
      return [mn, mx];
    };
    const addAcc = (ta, comp, type, count, target, withMinMax) => {
      if (accCache.has(ta)) return accCache.get(ta);
      const acc = { bufferView: addView(u8of(ta), target), componentType: comp, count, type };
      if (withMinMax) { const [mn, mx] = minmax(ta); acc.min = mn; acc.max = mx; }
      accessors.push(acc);
      accCache.set(ta, accessors.length - 1);
      return accessors.length - 1;
    };
    const addTex = tex => {
      if (texCache.has(tex)) return texCache.get(tex);
      images.push({ bufferView: addView(tex.bytes), mimeType: tex.mime });
      textures.push({ sampler: 0, source: images.length - 1 });
      texCache.set(tex, textures.length - 1);
      return textures.length - 1;
    };
    const matIndex = mat => {
      mat = mat || DEFAULT_MAT;
      if (matCache.has(mat)) return matCache.get(mat);
      const col = mat.color || [1, 1, 1, 1];
      const def = { pbrMetallicRoughness: { baseColorFactor: [col[0], col[1], col[2], col[3] == null ? 1 : col[3]], metallicFactor: mat.metallic ?? 0, roughnessFactor: mat.roughness ?? 1 } };
      if (mat.name) def.name = mat.name;
      const T = mat.textures || {};
      if (T.base) def.pbrMetallicRoughness.baseColorTexture = { index: addTex(T.base) };
      if (T.orm) def.pbrMetallicRoughness.metallicRoughnessTexture = { index: addTex(T.orm) };
      if (T.normal) def.normalTexture = { index: addTex(T.normal), scale: mat.normalScale ?? 1 };
      if (T.emissive) def.emissiveTexture = { index: addTex(T.emissive) };
      const em = mat.emissive || [0, 0, 0];
      if (em[0] || em[1] || em[2]) def.emissiveFactor = em.map(clamp01);
      else if (T.emissive) def.emissiveFactor = [1, 1, 1];
      if (mat.doubleSided) def.doubleSided = true;
      if (mat.alphaMode === 'MASK') { def.alphaMode = 'MASK'; def.alphaCutoff = mat.alphaCutoff ?? 0.5; }
      else if (col[3] != null && col[3] < 1) def.alphaMode = 'BLEND';
      materials.push(def);
      matCache.set(mat, materials.length - 1);
      return materials.length - 1;
    };

    model.meshes.forEach((m, mi) => {
      const nV = m.positions.length / 3;
      const attrs = { POSITION: addAcc(m.positions, 5126, 'VEC3', nV, 34962, true) };
      if (m.normals && m.normals.length === nV * 3) attrs.NORMAL = addAcc(m.normals, 5126, 'VEC3', nV, 34962);
      if (m.uvs && m.uvs.length === nV * 2) attrs.TEXCOORD_0 = addAcc(m.uvs, 5126, 'VEC2', nV, 34962);
      if (m.colors && m.colorSize && m.colors.length === nV * m.colorSize) attrs.COLOR_0 = addAcc(m.colors, 5126, m.colorSize === 4 ? 'VEC4' : 'VEC3', nV, 34962);
      const prim = { attributes: attrs, mode: 4, material: matIndex(m.material) };
      if (m.indices && m.indices.length) {
        const small = nV < 65536;
        let ia = idxCache.get(m.indices);
        if (!ia) {
          ia = small ? Uint16Array.from(m.indices) : (m.indices instanceof Uint32Array ? m.indices : Uint32Array.from(m.indices));
          idxCache.set(m.indices, ia);
        }
        prim.indices = addAcc(ia, small ? 5123 : 5125, 'SCALAR', ia.length, 34963);
      }
      meshesJ.push({ name: m.name || 'mesh_' + mi, primitives: [prim] });
      nodes.push({ mesh: mi, name: m.name || 'mesh_' + mi });
    });

    const json = {
      asset: { version: '2.0', generator: 'Danso (sobhan-khalili.ir)' },
      scene: 0,
      scenes: [{ nodes: nodes.map((_, i) => i) }],
      nodes, meshes: meshesJ, materials, accessors, bufferViews
    };
    if (images.length) { json.images = images; json.textures = textures; json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }]; }
    const bin = new Uint8Array(offset);
    let o = 0;
    for (const p of parts) { bin.set(p, o); o += p.byteLength; }
    return { json, bin };
  }

  function toGLB(model) {
    const { json, bin } = buildGLTF(model);
    json.buffers = [{ byteLength: bin.length }];
    const js = enc.encode(JSON.stringify(json));
    const jlen = js.length + ((4 - (js.length % 4)) % 4);
    const total = 12 + 8 + jlen + 8 + bin.length;
    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, total, true);
    dv.setUint32(12, jlen, true);
    dv.setUint32(16, 0x4e4f534a, true);
    out.set(js, 20);
    out.fill(0x20, 20 + js.length, 20 + jlen);
    const o = 20 + jlen;
    dv.setUint32(o, bin.length, true);
    dv.setUint32(o + 4, 0x004e4942, true);
    out.set(bin, o + 8);
    return out;
  }
  function toGLTF(model) {
    const { json, bin } = buildGLTF(model);
    json.buffers = [{ byteLength: bin.length, uri: 'data:application/octet-stream;base64,' + b64(bin) }];
    return JSON.stringify(json);
  }

  /* ---------- STL / PLY ---------- */
  function toSTL(model) {
    let tris = 0;
    for (const m of model.meshes) tris += triCount(m);
    const out = new Uint8Array(84 + tris * 50);
    const dv = new DataView(out.buffer);
    out.set(enc.encode('Danso binary STL - sobhan-khalili.ir'), 0);
    dv.setUint32(80, tris, true);
    let o = 84;
    for (const m of model.meshes) {
      const P = m.positions, I = m.indices, n = triCount(m);
      for (let t = 0; t < n; t++) {
        const a = (I ? I[t * 3] : t * 3) * 3, b = (I ? I[t * 3 + 1] : t * 3 + 1) * 3, c = (I ? I[t * 3 + 2] : t * 3 + 2) * 3;
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
        const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
        dv.setFloat32(o + 12, P[a], true); dv.setFloat32(o + 16, P[a + 1], true); dv.setFloat32(o + 20, P[a + 2], true);
        dv.setFloat32(o + 24, P[b], true); dv.setFloat32(o + 28, P[b + 1], true); dv.setFloat32(o + 32, P[b + 2], true);
        dv.setFloat32(o + 36, P[c], true); dv.setFloat32(o + 40, P[c + 1], true); dv.setFloat32(o + 44, P[c + 2], true);
        o += 50;
      }
    }
    return out;
  }
  function toPLY(model) {
    let nv = 0, nf = 0, hasN = false, hasUV = false;
    for (const m of model.meshes) { nv += m.positions.length / 3; nf += triCount(m); if (m.normals) hasN = true; if (m.uvs) hasUV = true; }
    const head = ['ply', 'format binary_little_endian 1.0', 'comment Danso - sobhan-khalili.ir', 'element vertex ' + nv, 'property float x', 'property float y', 'property float z'];
    if (hasN) head.push('property float nx', 'property float ny', 'property float nz');
    head.push('property uchar red', 'property uchar green', 'property uchar blue');
    if (hasUV) head.push('property float s', 'property float t');
    head.push('element face ' + nf, 'property list uchar uint vertex_indices', 'end_header\n');
    const hb = enc.encode(head.join('\n'));
    const stride = 12 + (hasN ? 12 : 0) + 3 + (hasUV ? 8 : 0);
    const out = new Uint8Array(hb.length + nv * stride + nf * 13);
    out.set(hb);
    const dv = new DataView(out.buffer);
    let o = hb.length;
    for (const m of model.meshes) {
      const P = m.positions, n = P.length / 3;
      const mc = (m.material || DEFAULT_MAT).color || [1, 1, 1, 1];
      const base = [to255(mc[0]), to255(mc[1]), to255(mc[2])];
      for (let i = 0; i < n; i++) {
        dv.setFloat32(o, P[i * 3], true); dv.setFloat32(o + 4, P[i * 3 + 1], true); dv.setFloat32(o + 8, P[i * 3 + 2], true);
        o += 12;
        if (hasN) {
          const N = m.normals;
          dv.setFloat32(o, N ? N[i * 3] : 0, true); dv.setFloat32(o + 4, N ? N[i * 3 + 1] : 0, true); dv.setFloat32(o + 8, N ? N[i * 3 + 2] : 0, true);
          o += 12;
        }
        if (m.colors && m.colorSize) {
          const cs = m.colorSize;
          out[o] = to255(m.colors[i * cs]); out[o + 1] = to255(m.colors[i * cs + 1]); out[o + 2] = to255(m.colors[i * cs + 2]);
        } else { out[o] = base[0]; out[o + 1] = base[1]; out[o + 2] = base[2]; }
        o += 3;
        if (hasUV) {
          dv.setFloat32(o, m.uvs ? m.uvs[i * 2] : 0, true); dv.setFloat32(o + 4, m.uvs ? 1 - m.uvs[i * 2 + 1] : 0, true);
          o += 8;
        }
      }
    }
    let vbase = 0;
    for (const m of model.meshes) {
      const I = m.indices, n = triCount(m);
      for (let t = 0; t < n; t++) {
        out[o++] = 3;
        for (let k = 0; k < 3; k++) { dv.setUint32(o, vbase + (I ? I[t * 3 + k] : t * 3 + k), true); o += 4; }
      }
      vbase += m.positions.length / 3;
    }
    return out;
  }

  /* ---------- ZIP (store) ---------- */
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zip(files) {
    const parts = [], central = [];
    let offset = 0;
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, f.data.length, true); lh.setUint32(22, f.data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, f.data.length, true); ch.setUint32(24, f.data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      parts.push(new Uint8Array(lh.buffer), name, f.data);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + f.data.length;
    }
    const cdSize = central.reduce((s, x) => s + x.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  /* ---------- OBJ (+MTL +textures) as ZIP ---------- */
  function toOBJ(model, base) {
    const lines = ['# Danso - sobhan-khalili.ir', 'mtllib ' + base + '.mtl'];
    const mtl = ['# Danso'];
    const files = [];
    const mats = new Map();
    const texFile = (tex, tag, n) => {
      const name = 'textures/' + base + '_' + n + '_' + tag + (tex.mime === 'image/jpeg' ? '.jpg' : '.png');
      files.push({ name, data: tex.bytes });
      return name;
    };
    const matName = mat => {
      mat = mat || DEFAULT_MAT;
      if (mats.has(mat)) return mats.get(mat);
      const n = mats.size;
      const name = 'mat_' + n;
      mats.set(mat, name);
      const c = mat.color || [1, 1, 1, 1];
      mtl.push('newmtl ' + name);
      mtl.push('Kd ' + [0, 1, 2].map(i => clamp01(lin2srgb(clamp01(c[i]))).toFixed(4)).join(' '));
      mtl.push('Ka 0 0 0', 'Ks 0.1 0.1 0.1', 'd ' + (c[3] == null ? 1 : c[3]).toFixed(3), 'illum 2');
      const em = mat.emissive || [0, 0, 0];
      if (em[0] || em[1] || em[2]) mtl.push('Ke ' + em.map(v => clamp01(v).toFixed(4)).join(' '));
      const T = mat.textures || {};
      if (T.base) mtl.push('map_Kd ' + texFile(T.base, 'base', n));
      if (T.normal) mtl.push('map_Bump ' + texFile(T.normal, 'normal', n));
      if (T.emissive) mtl.push('map_Ke ' + texFile(T.emissive, 'emissive', n));
      mtl.push('');
      return name;
    };
    let vOff = 1, vtOff = 1, vnOff = 1;
    model.meshes.forEach((m, mi) => {
      const P = m.positions, n = P.length / 3;
      lines.push('o ' + (safeName(m.name) || 'mesh_' + mi));
      lines.push('usemtl ' + matName(m.material));
      const buf = [];
      const cs = m.colors && m.colorSize ? m.colorSize : 0;
      for (let i = 0; i < n; i++) {
        let s = 'v ' + P[i * 3].toFixed(6) + ' ' + P[i * 3 + 1].toFixed(6) + ' ' + P[i * 3 + 2].toFixed(6);
        if (cs) s += ' ' + [0, 1, 2].map(k => clamp01(lin2srgb(clamp01(m.colors[i * cs + k]))).toFixed(4)).join(' ');
        buf.push(s);
      }
      const hasUV = !!(m.uvs && m.uvs.length === n * 2), hasN = !!(m.normals && m.normals.length === n * 3);
      if (hasUV) for (let i = 0; i < n; i++) buf.push('vt ' + m.uvs[i * 2].toFixed(6) + ' ' + (1 - m.uvs[i * 2 + 1]).toFixed(6));
      if (hasN) for (let i = 0; i < n; i++) buf.push('vn ' + m.normals[i * 3].toFixed(5) + ' ' + m.normals[i * 3 + 1].toFixed(5) + ' ' + m.normals[i * 3 + 2].toFixed(5));
      const I = m.indices, tn = triCount(m);
      const ref = i => {
        const v = vOff + i;
        if (hasUV && hasN) return v + '/' + (vtOff + i) + '/' + (vnOff + i);
        if (hasUV) return v + '/' + (vtOff + i);
        if (hasN) return v + '//' + (vnOff + i);
        return '' + v;
      };
      for (let t = 0; t < tn; t++) {
        const a = I ? I[t * 3] : t * 3, b = I ? I[t * 3 + 1] : t * 3 + 1, c = I ? I[t * 3 + 2] : t * 3 + 2;
        buf.push('f ' + ref(a) + ' ' + ref(b) + ' ' + ref(c));
      }
      lines.push(buf.join('\n'));
      vOff += n; if (hasUV) vtOff += n; if (hasN) vnOff += n;
    });
    files.unshift({ name: base + '.mtl', data: enc.encode(mtl.join('\n')) });
    files.unshift({ name: base + '.obj', data: enc.encode(lines.join('\n')) });
    return zip(files);
  }

  /* ---------- export entry ---------- */
  function exportModel(model, format, name) {
    const base = safeName(name) || 'danso-model';
    switch (format) {
      case 'glb': return { blob: new Blob([toGLB(model)], { type: 'model/gltf-binary' }), filename: base + '.glb' };
      case 'gltf': return { blob: new Blob([toGLTF(model)], { type: 'model/gltf+json' }), filename: base + '.gltf' };
      case 'obj': return { blob: toOBJ(model, base), filename: base + '-obj.zip' };
      case 'stl': return { blob: new Blob([toSTL(model)], { type: 'model/stl' }), filename: base + '.stl' };
      case 'ply': return { blob: new Blob([toPLY(model)], { type: 'application/octet-stream' }), filename: base + '.ply' };
      default: throw new Error('Unknown format: ' + format);
    }
  }

  /* ---------- glTF / GLB parser ---------- */
  async function toPngJpeg(img) {
    if (!img) return null;
    if (img.mime === 'image/png' || img.mime === 'image/jpeg') return img;
    try {
      const bmp = await createImageBitmap(new Blob([img.bytes], { type: img.mime }));
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      cv.getContext('2d').drawImage(bmp, 0, 0);
      const blob = await cv.convertToBlob({ type: 'image/png' });
      return { mime: 'image/png', bytes: new Uint8Array(await blob.arrayBuffer()) };
    } catch { return null; }
  }

  async function parseGLTF(buf, baseUrl, fetcher) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let json, bin = null;
    if (u8.length > 12 && dv.getUint32(0, true) === 0x46546c67) {
      let o = 12;
      while (o + 8 <= u8.length) {
        const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true);
        const data = u8.subarray(o + 8, o + 8 + len);
        if (type === 0x4e4f534a) json = JSON.parse(dec.decode(data));
        else if (type === 0x004e4942 && !bin) bin = data;
        o += 8 + len;
      }
    } else {
      json = JSON.parse(dec.decode(u8));
    }
    if (!json || !json.asset) throw new Error('Invalid glTF');
    const compressed = (json.extensionsRequired || []).concat(json.extensionsUsed || []).some(e => /draco|meshopt/i.test(e));
    if (compressed) { const e = new Error('compressed'); e.code = 'compressed'; throw e; }

    const doFetch = fetcher || ((u) => fetch(u));
    const buffers = await Promise.all((json.buffers || []).map(async (b, i) => {
      if (b.uri === undefined) return i === 0 ? bin : null;
      if (b.uri.startsWith('data:')) return dataUri(b.uri).bytes;
      const r = await doFetch(new URL(b.uri, baseUrl).href);
      if (!r.ok) throw new Error('buffer fetch failed');
      return new Uint8Array(await r.arrayBuffer());
    }));

    const CT = { 5120: [1, (d, o) => d.getInt8(o)], 5121: [1, (d, o) => d.getUint8(o)], 5122: [2, (d, o) => d.getInt16(o, true)], 5123: [2, (d, o) => d.getUint16(o, true)], 5125: [4, (d, o) => d.getUint32(o, true)], 5126: [4, (d, o) => d.getFloat32(o, true)] };
    const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
    const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

    function readAcc(idx, asIndex) {
      const a = json.accessors[idx];
      const comps = NCOMP[a.type], n = a.count;
      const out = asIndex ? new Uint32Array(n * comps) : new Float32Array(n * comps);
      if (a.bufferView === undefined) return out;
      const bv = json.bufferViews[a.bufferView];
      const b = buffers[bv.buffer];
      const [size, rd] = CT[a.componentType];
      const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
      const stride = bv.byteStride || comps * size;
      const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const nrm = a.normalized && NORM[a.componentType];
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < comps; c++) {
          let v = rd(d, base + i * stride + c * size);
          if (nrm) v = Math.max(v / nrm, -1);
          out[i * comps + c] = v;
        }
      }
      return out;
    }

    const imgCache = new Map();
    async function getImage(ii) {
      if (imgCache.has(ii)) return imgCache.get(ii);
      const p = (async () => {
        const im = json.images && json.images[ii];
        if (!im) return null;
        let bytes, mime = im.mimeType;
        if (im.bufferView !== undefined) {
          const bv = json.bufferViews[im.bufferView];
          const b = buffers[bv.buffer];
          bytes = b.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
        } else if (im.uri && im.uri.startsWith('data:')) {
          const d = dataUri(im.uri); bytes = d.bytes; mime = mime || d.mime;
        } else if (im.uri) {
          const r = await doFetch(new URL(im.uri, baseUrl).href);
          if (!r.ok) return null;
          bytes = new Uint8Array(await r.arrayBuffer());
          mime = mime || r.headers.get('content-type') || (/\.jpe?g/i.test(im.uri) ? 'image/jpeg' : /\.webp/i.test(im.uri) ? 'image/webp' : 'image/png');
        }
        if (!bytes) return null;
        if (!mime || mime === 'application/octet-stream') mime = 'image/png';
        if (mime === 'image/ktx2') return null;
        return toPngJpeg({ mime, bytes });
      })();
      imgCache.set(ii, p);
      return p;
    }
    const texInfo = async ti => {
      if (!ti || ti.index === undefined) return null;
      const t = json.textures && json.textures[ti.index];
      if (!t) return null;
      const src = t.source ?? t.extensions?.EXT_texture_webp?.source;
      return src === undefined ? null : getImage(src);
    };

    const matCache = new Map();
    async function getMat(mi) {
      if (mi === undefined) return { ...DEFAULT_MAT, textures: {} };
      if (matCache.has(mi)) return matCache.get(mi);
      const m = json.materials[mi] || {};
      const pbr = m.pbrMetallicRoughness || {};
      const mat = {
        name: m.name || '',
        color: (pbr.baseColorFactor || [1, 1, 1, 1]).slice(),
        metallic: pbr.metallicFactor ?? 1,
        roughness: pbr.roughnessFactor ?? 1,
        emissive: (m.emissiveFactor || [0, 0, 0]).slice(),
        doubleSided: !!m.doubleSided,
        normalScale: m.normalTexture?.scale ?? 1,
        textures: {}
      };
      if (m.alphaMode === 'MASK') { mat.alphaMode = 'MASK'; mat.alphaCutoff = m.alphaCutoff ?? 0.5; }
      const [base, orm, normal, emissive] = await Promise.all([texInfo(pbr.baseColorTexture), texInfo(pbr.metallicRoughnessTexture), texInfo(m.normalTexture), texInfo(m.emissiveTexture)]);
      if (base) mat.textures.base = base;
      if (orm) mat.textures.orm = orm;
      if (normal) mat.textures.normal = normal;
      if (emissive) mat.textures.emissive = emissive;
      matCache.set(mi, mat);
      return mat;
    }

    const model = { meshes: [] };
    async function emit(mesh, world, nodeName) {
      for (let pi = 0; pi < (mesh.primitives || []).length; pi++) {
        const p = mesh.primitives[pi];
        if (p.extensions && p.extensions.KHR_draco_mesh_compression) { const e = new Error('compressed'); e.code = 'compressed'; throw e; }
        const mode = p.mode === undefined ? 4 : p.mode;
        if (mode < 4 || p.attributes.POSITION === undefined) continue;
        let pos = transformPositions(readAcc(p.attributes.POSITION), world);
        const nV = pos.length / 3;
        let normals = p.attributes.NORMAL !== undefined ? transformNormals(readAcc(p.attributes.NORMAL), world) : null;
        const uvs = p.attributes.TEXCOORD_0 !== undefined ? readAcc(p.attributes.TEXCOORD_0) : null;
        let colors = null, colorSize = 0;
        if (p.attributes.COLOR_0 !== undefined) { colors = readAcc(p.attributes.COLOR_0); colorSize = NCOMP[json.accessors[p.attributes.COLOR_0].type]; }
        let indices = p.indices !== undefined ? readAcc(p.indices, true) : null;
        if (mode === 5 || mode === 6) {
          const src = indices || Uint32Array.from({ length: nV }, (_, i) => i);
          const out = [];
          for (let i = 0; i + 2 < src.length; i++) {
            if (mode === 5) out.push(i % 2 ? src[i + 1] : src[i], i % 2 ? src[i] : src[i + 1], src[i + 2]);
            else out.push(src[0], src[i + 1], src[i + 2]);
          }
          indices = Uint32Array.from(out);
        }
        model.meshes.push({
          name: (mesh.name || nodeName || 'mesh') + (mesh.primitives.length > 1 ? '_' + pi : ''),
          positions: pos, normals, uvs, colors: colors || undefined, colorSize: colorSize || undefined,
          indices: indices || undefined, material: await getMat(p.material)
        });
      }
    }
    async function walk(ni, parent) {
      const nd = json.nodes[ni];
      const local = nd.matrix ? Array.from(nd.matrix) : compose(nd.translation, nd.rotation, nd.scale);
      const world = mat4mul(parent, local);
      if (nd.mesh !== undefined) await emit(json.meshes[nd.mesh], world, nd.name);
      for (const c of nd.children || []) await walk(c, world);
    }
    const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const sc = json.scenes && json.scenes[json.scene || 0];
    let roots = sc && sc.nodes;
    if (!roots) {
      const child = new Set();
      (json.nodes || []).forEach(n => (n.children || []).forEach(c => child.add(c)));
      roots = (json.nodes || []).map((_, i) => i).filter(i => !child.has(i));
    }
    for (const r of roots) await walk(r, I4);
    if (!model.meshes.length) throw new Error('empty');
    return model;
  }

  /* ---------- lightweight preview data ---------- */
  async function attachPix(model) {
    const cache = new Map();
    for (const m of model.meshes) {
      const mat = m.material;
      if (!mat || mat.pix !== undefined || !mat.textures || !mat.textures.base) continue;
      const tex = mat.textures.base;
      if (!cache.has(tex)) {
        cache.set(tex, (async () => {
          try {
            const bmp = await createImageBitmap(new Blob([tex.bytes], { type: tex.mime }));
            const k = Math.min(1, 256 / Math.max(bmp.width, bmp.height));
            const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
            const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
            ctx.drawImage(bmp, 0, 0, w, h);
            return { w, h, data: ctx.getImageData(0, 0, w, h).data };
          } catch { return null; }
        })());
      }
      mat.pix = await cache.get(tex);
    }
  }
  function buildPreview(model, maxTris) {
    maxTris = maxTris || 30000;
    let total = 0;
    for (const m of model.meshes) total += triCount(m);
    const step = Math.max(1, Math.ceil(total / maxTris));
    const pos = [], col = [];
    let g = 0;
    for (const m of model.meshes) {
      const P = m.positions, I = m.indices, n = triCount(m), U = m.uvs, cs = m.colorSize || 0;
      const mat = m.material || DEFAULT_MAT, bc = mat.color || [1, 1, 1, 1], pix = mat.pix;
      const base = [lin2srgb(clamp01(bc[0])), lin2srgb(clamp01(bc[1])), lin2srgb(clamp01(bc[2]))];
      for (let t = 0; t < n; t++, g++) {
        if (g % step) continue;
        const a = I ? I[t * 3] : t * 3, b = I ? I[t * 3 + 1] : t * 3 + 1, c = I ? I[t * 3 + 2] : t * 3 + 2;
        for (const v of [a, b, c]) pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        let r = base[0], gg = base[1], bb = base[2];
        if (pix && U && U.length >= (Math.max(a, b, c) + 1) * 2) {
          const u = (U[a * 2] + U[b * 2] + U[c * 2]) / 3, v = (U[a * 2 + 1] + U[b * 2 + 1] + U[c * 2 + 1]) / 3;
          const x = Math.min(pix.w - 1, Math.floor((u - Math.floor(u)) * pix.w)), y = Math.min(pix.h - 1, Math.floor((v - Math.floor(v)) * pix.h));
          const k = (y * pix.w + x) * 4;
          r *= pix.data[k] / 255; gg *= pix.data[k + 1] / 255; bb *= pix.data[k + 2] / 255;
        }
        if (cs && m.colors) {
          let vr = 0, vg = 0, vb = 0;
          for (const v of [a, b, c]) { vr += m.colors[v * cs]; vg += m.colors[v * cs + 1]; vb += m.colors[v * cs + 2]; }
          r *= lin2srgb(clamp01(vr / 3)); gg *= lin2srgb(clamp01(vg / 3)); bb *= lin2srgb(clamp01(vb / 3));
        }
        col.push(Math.round(clamp01(r) * 255), Math.round(clamp01(gg) * 255), Math.round(clamp01(bb) * 255));
      }
    }
    return { pos: Float32Array.from(pos), col: Uint8Array.from(col), n: col.length / 3, total };
  }

  globalThis.__DansoIO = { attachPix, buildPreview, b64, fromB64, sniff, exportModel, parseGLTF, transformPositions, transformNormals, safeName, triCount, zip, toGLB };
})();
