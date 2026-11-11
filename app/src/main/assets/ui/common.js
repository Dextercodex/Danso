/* Danso — shared helpers + i18n */
(() => {
  'use strict';
  const DICT = {
    fa: {
      name: 'دانسو', unsupported_t: 'دانسو روی این صفحه کار نمی‌کند', unsupported_d: 'صفحه‌های داخلی کروم، فروشگاه افزونه‌ها و برگه‌ی خالی پشتیبانی نمی‌شوند. یک سایت معمولی باز کنید.',
      tab3d: 'سه‌بعدی', tabMedia: 'رسانه', tabConn: 'اتصال', rescan: 'اسکن مجدد', lang: 'EN',
      scenes: 'صحنه‌های زنده‌ی صفحه', scene_hint: 'خروجی دقیقاً همان چیزی است که همین الان روی صفحه رندر شده؛ نه فایل اصلی سرور.',
      files: 'فایل‌های مدل شناسایی‌شده', mv: 'model-viewer',
      meshes: 'مش', tris: 'مثلث', verts: 'رأس', dims: 'ابعاد', textured: 'تکسچر',
      dl: 'دانلود', dl_orig: 'فایل اصلی', dl_as: 'دانلود {0}', working: 'در حال پردازش…', done: 'انجام شد ✓', failed: 'ناموفق',
      skip_helpers: 'حذف المان‌های کمکی (grid، shadow، gizmo…)',
      convert: 'تبدیل', copy_url: 'کپی لینک', copied: 'کپی شد',
      format_hint_obj: 'OBJ به‌صورت zip (با MTL و تکسچرها) ذخیره می‌شود.',
      empty3d_t: 'هنوز مدل سه‌بعدی‌ای پیدا نشد', empty3d_d: 'مدل را روی صفحه باز کنید یا بچرخانید تا لود شود. اگر دانسو بعد از باز شدن صفحه نصب شده، صفحه را رفرش کنید.',
      reload: 'رفرش صفحه', hook_on: 'تشخیص عمیق فعال است', hook_off: 'برای شناسایی صحنه‌ی زنده، صفحه را یک‌بار رفرش کنید',
      err_compressed: 'این فایل فشرده است (Draco/Meshopt)؛ فقط «فایل اصلی» قابل دانلود است.',
      err_scene_gone: 'صحنه دیگر در صفحه نیست. اسکن مجدد بزنید.', err_empty: 'مدلی برای خروجی پیدا نشد.', err_generic: 'خطا: {0}',
      err_noframe: 'ارتباط با صفحه برقرار نشد. صفحه را رفرش کنید.',
      search: 'جستجو در نام و لینک…', all: 'همه', images: 'عکس', videos: 'ویدیو', audios: 'صوت', svgs: 'SVG',
      hide_tiny: 'مخفی‌کردن فایل‌های ریز (زیر ۲ کیلوبایت)', sel_all: 'انتخاب همه', dl_sel: 'دانلود انتخاب‌شده‌ها ({0})', clear: 'پاک‌کردن',
      locate: 'نمایش در صفحه', edit: 'ویرایش', open: 'باز کردن', save: 'ذخیره',
      stream_note: 'استریم (HLS/DASH) — دانلود مستقیم ممکن نیست؛ لینک را کپی کنید.', mse_note: 'ویدیوی استریم داخلی (blob)',
      no_media: 'موردی پیدا نشد', no_media_d: 'صفحه را اسکرول کنید یا فیلتر را عوض کنید.',
      k_image: 'عکس', k_video: 'ویدیو', k_audio: 'صوت', k_svg: 'SVG', k_canvas: 'کنواس', k_stream: 'استریم',
      /* editor */
      ed_back: 'بازگشت', ed_visual: 'بصری', ed_code: 'کد', ed_palette: 'رنگ‌های سند', ed_props: 'ویژگی‌های انتخاب‌شده', ed_layers: 'لایه‌ها',
      ed_hint: 'روی شکلی در پیش‌نمایش کلیک کنید تا ویرایشش کنید.', ed_fill: 'رنگ داخل', ed_stroke: 'خط دور', ed_sw: 'ضخامت خط', ed_op: 'شفافیت', ed_tf: 'transform', ed_text: 'متن',
      ed_none: 'بدون', ed_del: 'حذف', ed_parent: 'والد', ed_undo: 'برگشت', ed_redo: 'جلو', ed_live: 'اعمال زنده روی صفحه', ed_revert: 'بازگردانی صفحه',
      ed_svg: 'SVG', ed_png: 'PNG', ed_copy: 'کپی کد', ed_clean: 'پاک‌سازی', ed_invalid: 'SVG نامعتبر است — آخرین نسخه‌ی سالم نگه داشته شد.', ed_gradient: 'گرادیان',
      ed_live_on: 'تغییرات همزمان روی صفحه اعمال می‌شود', ed_live_off: 'اعمال زنده خاموش است', ed_bg: 'پس‌زمینه', ed_zoom: 'بزرگ‌نمایی', ed_cleaned: 'پاک‌سازی شد',
      ed_page_only: 'فقط برای SVG داخل صفحه', ed_reverted: 'صفحه به حالت اول برگشت',
      /* connection */
      c_server: 'سرور', c_you: 'شما', c_ip: 'آی‌پی', c_country: 'کشور', c_region: 'استان / ایالت', c_city: 'شهر', c_isp: 'هاست / سرویس‌دهنده', c_asn: 'ASN', c_domain: 'دامنه‌ی ارائه‌دهنده',
      c_tz: 'منطقه‌ی زمانی', c_time: 'ساعت سرور', c_mytime: 'ساعت شما', c_conn: 'اتصال و هدرها', c_proto: 'پروتکل', c_status: 'وضعیت', c_srv: 'نرم‌افزار سرور', c_powered: 'ساخته‌شده با', c_cdn: 'CDN / پلتفرم',
      c_comp: 'فشرده‌سازی', c_cache: 'کش', c_hsts: 'HSTS', c_csp: 'CSP', c_https: 'اتصال امن (HTTPS)', c_perf: 'عملکرد', c_dns: 'DNS', c_connect: 'اتصال', c_tls: 'TLS', c_ttfb: 'اولین بایت', c_load: 'بارگذاری کامل',
      c_reqs: 'درخواست‌ها', c_bytes: 'حجم دریافتی', c_domains: 'دامنه‌های درگیر', c_page: 'صفحه', c_lang: 'زبان صفحه', c_charset: 'کدگذاری', c_cookies: 'کوکی‌ها',
      c_yes: 'بله', c_no: 'خیر', c_local: 'آدرس محلی / خصوصی', c_cdn_note: 'پشت CDN است؛ آی‌پی و موقعیت نشان‌داده‌شده مربوط به لبه‌ی CDN است، نه لزوماً سرور اصلی.',
      c_geo_fail: 'دریافت موقعیت آی‌پی ناموفق بود.', c_retry: 'تلاش دوباره', c_loading: 'در حال دریافت…', c_privacy: 'برای نمایش موقعیت، فقط آی‌پی (سرور و شما) به سرویس ipwho.is ارسال می‌شود.',
      c_noconn: 'هنوز اطلاعات اتصال ثبت نشده. صفحه را رفرش کنید.', c_from_cache: 'از کش مرورگر', c_offset: 'UTC{0}',
      dev: 'توسعه‌دهنده: سبحان خلیلی', ms: 'ms', diag: 'گزارش عیب‌یابی', saved: 'ذخیره شد', empty_page: 'لینک صفحه را در نوار بالا بزنید یا از مرورگر «اشتراک‌گذاری» کنید.', mob_note: 'فایل‌ها در پوشه‌ی Downloads/Danso ذخیره می‌شوند.', pv_show: 'پیش‌نمایش', pv_hide: 'بستن پیش‌نمایش', pv_hint: 'بکشید تا بچرخد · اسکرول برای زوم · دو‌بار کلیک: ریست', pv_loading: 'در حال ساخت پیش‌نمایش…', pv_simpl: 'ساده‌شده', pv_refresh: 'بازسازی', diag_ok: 'گزارش کپی شد — همین را بفرستید', diag_wait: 'در حال ساخت گزارش…'
    },
    en: {
      name: 'Danso', unsupported_t: 'Danso can’t run on this page', unsupported_d: 'Chrome internal pages, the Web Store and blank tabs are not supported. Open a regular website.',
      tab3d: '3D', tabMedia: 'Media', tabConn: 'Connection', rescan: 'Rescan', lang: 'فا',
      scenes: 'Live scenes on this page', scene_hint: 'Exports exactly what is rendered right now — not the original file the server sent.',
      files: 'Detected model files', mv: 'model-viewer',
      meshes: 'meshes', tris: 'triangles', verts: 'vertices', dims: 'size', textured: 'textured',
      dl: 'Download', dl_orig: 'Original file', dl_as: 'Download {0}', working: 'Working…', done: 'Done ✓', failed: 'Failed',
      skip_helpers: 'Skip helper objects (grid, shadow, gizmo…)',
      convert: 'Convert', copy_url: 'Copy link', copied: 'Copied',
      format_hint_obj: 'OBJ is saved as a zip (with MTL and textures).',
      empty3d_t: 'No 3D model found yet', empty3d_d: 'Open or rotate the model so it loads. If Danso was installed after this page opened, reload the page.',
      reload: 'Reload page', hook_on: 'Deep detection active', hook_off: 'Reload the page once to detect live scenes',
      err_compressed: 'This file is compressed (Draco/Meshopt); only “Original file” can be downloaded.',
      err_scene_gone: 'The scene is no longer on the page. Rescan.', err_empty: 'Nothing to export.', err_generic: 'Error: {0}',
      err_noframe: 'Could not talk to the page. Reload it.',
      search: 'Search names and links…', all: 'All', images: 'Images', videos: 'Video', audios: 'Audio', svgs: 'SVG',
      hide_tiny: 'Hide tiny files (under 2 KB)', sel_all: 'Select all', dl_sel: 'Download selected ({0})', clear: 'Clear',
      locate: 'Locate', edit: 'Edit', open: 'Open', save: 'Save',
      stream_note: 'Stream (HLS/DASH) — can’t be saved directly; copy the link.', mse_note: 'Built-in stream (blob)',
      no_media: 'Nothing found', no_media_d: 'Scroll the page or change the filter.',
      k_image: 'image', k_video: 'video', k_audio: 'audio', k_svg: 'svg', k_canvas: 'canvas', k_stream: 'stream',
      ed_back: 'Back', ed_visual: 'Visual', ed_code: 'Code', ed_palette: 'Document colors', ed_props: 'Selected element', ed_layers: 'Layers',
      ed_hint: 'Click a shape in the preview to edit it.', ed_fill: 'Fill', ed_stroke: 'Stroke', ed_sw: 'Stroke width', ed_op: 'Opacity', ed_tf: 'transform', ed_text: 'Text',
      ed_none: 'None', ed_del: 'Delete', ed_parent: 'Parent', ed_undo: 'Undo', ed_redo: 'Redo', ed_live: 'Live on page', ed_revert: 'Revert page',
      ed_svg: 'SVG', ed_png: 'PNG', ed_copy: 'Copy code', ed_clean: 'Clean', ed_invalid: 'Invalid SVG — kept the last valid version.', ed_gradient: 'gradient',
      ed_live_on: 'Edits are applied to the page as you type', ed_live_off: 'Live apply is off', ed_bg: 'Background', ed_zoom: 'Zoom', ed_cleaned: 'Cleaned',
      ed_page_only: 'Only for inline SVGs', ed_reverted: 'Page restored',
      c_server: 'Server', c_you: 'You', c_ip: 'IP', c_country: 'Country', c_region: 'Region', c_city: 'City', c_isp: 'Host / ISP', c_asn: 'ASN', c_domain: 'Provider domain',
      c_tz: 'Time zone', c_time: 'Server time', c_mytime: 'Your time', c_conn: 'Connection & headers', c_proto: 'Protocol', c_status: 'Status', c_srv: 'Server software', c_powered: 'Powered by', c_cdn: 'CDN / platform',
      c_comp: 'Compression', c_cache: 'Cache', c_hsts: 'HSTS', c_csp: 'CSP', c_https: 'Secure (HTTPS)', c_perf: 'Performance', c_dns: 'DNS', c_connect: 'Connect', c_tls: 'TLS', c_ttfb: 'First byte', c_load: 'Full load',
      c_reqs: 'Requests', c_bytes: 'Transferred', c_domains: 'Domains contacted', c_page: 'Page', c_lang: 'Page language', c_charset: 'Charset', c_cookies: 'Cookies',
      c_yes: 'Yes', c_no: 'No', c_local: 'Local / private address', c_cdn_note: 'Behind a CDN: the IP and location shown belong to the CDN edge, not necessarily the origin server.',
      c_geo_fail: 'Could not look up the IP location.', c_retry: 'Retry', c_loading: 'Loading…', c_privacy: 'To show the location only the IPs (server and yours) are sent to ipwho.is.',
      c_noconn: 'No connection data recorded yet. Reload the page.', c_from_cache: 'from browser cache', c_offset: 'UTC{0}',
      dev: 'Developer: Sobhan Khalili', ms: 'ms', diag: 'Diagnostic report', saved: 'Saved', empty_page: 'Enter a page link in the top bar or share one from your browser.', mob_note: 'Files are saved to Downloads/Danso.', pv_show: 'Preview', pv_hide: 'Hide preview', pv_hint: 'Drag to rotate · scroll to zoom · double-click to reset', pv_loading: 'Building preview…', pv_simpl: 'simplified', pv_refresh: 'Refresh', diag_ok: 'Report copied — paste it to share', diag_wait: 'Building report…'
    }
  };

  const Danso = { lang: 'fa' };
  Danso.t = (k, ...a) => {
    let s = (DICT[Danso.lang] && DICT[Danso.lang][k]) || DICT.en[k] || k;
    a.forEach((v, i) => { s = s.replace('{' + i + '}', v); });
    return s;
  };
  Danso.locale = () => (Danso.lang === 'fa' ? 'fa-IR' : 'en-US');
  Danso.num = n => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString(Danso.locale()));
  Danso.bytes = b => {
    if (b == null || isNaN(b)) return '';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0, v = b;
    while (v >= 1024 && i < 3) { v /= 1024; i++; }
    return Danso.num(+(i ? v.toFixed(1) : v)) + ' ' + u[i];
  };

  Danso.h = function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'style' && typeof v === 'string') el.setAttribute('style', v);
        else if (k in el && k !== 'list') { try { el[k] = v; } catch { el.setAttribute(k, v === true ? '' : v); } }
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  };

  Danso.toast = (msg, type) => {
    const host = document.getElementById('toasts');
    const el = Danso.h('div', { class: 'toast ' + (type || '') }, msg);
    host.append(el);
    setTimeout(() => el.remove(), 2600);
  };

  Danso.safe = (s, max = 80) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').trim().slice(0, max) || 'file';
  Danso.fileName = url => {
    try {
      if (/^data:/.test(url)) return 'data-' + url.slice(5, 15).replace(/\W+/g, '');
      if (/^(blob|svg|canvas):/.test(url)) return url.split(':')[0];
      const u = new URL(url);
      const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname);
      return Danso.safe(last);
    } catch { return Danso.safe(url.slice(-40)); }
  };

  /* save a Blob created in the panel through the downloads API (supports a subfolder) */
  Danso.saveLocal = (blob, name) => {
    const url = URL.createObjectURL(blob);
    return chrome.downloads.download({ url, filename: 'Danso/' + Danso.safe(name, 120), conflictAction: 'uniquify' })
      .finally(() => setTimeout(() => URL.revokeObjectURL(url), 60000));
  };

  Danso.copy = async text => {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = Danso.h('textarea', { value: text, style: 'position:fixed;opacity:0' });
      document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    Danso.toast(Danso.t('copied'), 'ok');
  };

  window.Danso = Danso;
})();
