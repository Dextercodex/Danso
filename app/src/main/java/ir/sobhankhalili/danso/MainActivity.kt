package ir.sobhankhalili.danso

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {

    private lateinit var page: WebView
    private lateinit var ui: WebView
    private lateinit var urlBox: EditText
    private lateinit var progress: ProgressBar
    private lateinit var panelBtn: Button

    private val handler = Handler(Looper.getMainLooper())
    private val io = Executors.newCachedThreadPool()
    private val lock = Any()

    private var pageUrl = ""
    private var pageTitle = ""
    private var hook = false
    private var scenes = JSONArray()
    private var mvs = JSONArray()
    private var dom = JSONArray()
    private var perf: JSONObject? = null
    private val found3d = LinkedHashMap<String, JSONObject>()
    private val net = LinkedHashMap<String, JSONObject>()
    private val hosts = LinkedHashMap<String, Int>()
    private val buffers = ConcurrentHashMap<Int, ByteArrayOutputStream>()
    private var pushPending = false
    private var userAgent = ""
    private var injectScript = ""
    private var docStartSupported = false

    private val ext3d = setOf("glb", "gltf", "obj", "fbx", "stl", "usdz", "ply", "splat", "ksplat", "3mf", "dae", "vrm", "drc", "3ds", "stp", "step")
    private val extImg = setOf("png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "jfif")
    private val extVid = setOf("mp4", "webm", "mov", "m4v", "mkv", "ogv")
    private val extAud = setOf("mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus")

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun readAsset(path: String): String =
        assets.open(path).bufferedReader(Charsets.UTF_8).use { it.readText() }

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(true)

        val root = LinearLayout(this)
        root.orientation = LinearLayout.VERTICAL
        root.setBackgroundColor(0xFF0F1C30.toInt())
        root.fitsSystemWindows = true

        val bar = LinearLayout(this)
        bar.orientation = LinearLayout.HORIZONTAL
        bar.gravity = Gravity.CENTER_VERTICAL
        bar.setPadding(dp(8), dp(6), dp(8), dp(6))

        urlBox = EditText(this)
        urlBox.hint = "https://…"
        urlBox.setSingleLine(true)
        urlBox.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
        urlBox.imeOptions = EditorInfo.IME_ACTION_GO
        urlBox.setTextColor(0xFFE9EFF8.toInt())
        urlBox.setHintTextColor(0x808CA4C8.toInt())
        urlBox.textSize = 14f
        urlBox.layoutDirection = View.LAYOUT_DIRECTION_LTR
        urlBox.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) {
                go()
                true
            } else {
                false
            }
        }
        bar.addView(urlBox, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

        val goBtn = Button(this)
        goBtn.text = "برو"
        goBtn.setOnClickListener { go() }
        bar.addView(goBtn, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        panelBtn = Button(this)
        panelBtn.text = "دانسو"
        panelBtn.backgroundTintList = ColorStateList.valueOf(0xFFFFD23F.toInt())
        panelBtn.setTextColor(0xFF1B1500.toInt())
        panelBtn.setOnClickListener { setPanel(ui.visibility != View.VISIBLE) }
        bar.addView(panelBtn, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(bar)

        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal)
        progress.max = 100
        progress.progressTintList = ColorStateList.valueOf(0xFFFFD23F.toInt())
        progress.visibility = View.GONE
        root.addView(progress, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)))

        page = WebView(this)
        ui = WebView(this)
        root.addView(page, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        ui.visibility = View.GONE
        root.addView(ui, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1.25f))
        setContentView(root)

        injectScript = readAsset("danso/model-io.js") + "\n" + readAsset("danso/main.js") + "\n" + readAsset("danso/android-bridge.js")
        setupPage()
        setupUi()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (ui.visibility == View.VISIBLE) {
                    setPanel(false)
                } else if (page.canGoBack()) {
                    page.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(i: Intent?) {
        if (i == null) return
        val text = i.getStringExtra(Intent.EXTRA_TEXT) ?: i.dataString
        val found = if (text == null) null else Regex("https?://[^\\s]+").find(text)?.value
        if (found != null) {
            urlBox.setText(found)
            go()
        } else {
            setPanel(true)
        }
    }

    private fun normalize(s: String): String {
        val t = s.trim()
        if (t.isEmpty()) return ""
        if (Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://").containsMatchIn(t)) return t
        if (t.contains(" ") || !t.contains(".")) return "https://www.google.com/search?q=" + Uri.encode(t)
        return "https://$t"
    }

    private fun go() {
        val u = normalize(urlBox.text.toString())
        if (u.isEmpty()) return
        (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(urlBox.windowToken, 0)
        setPanel(false)
        page.loadUrl(u)
    }

    private fun setPanel(show: Boolean) {
        ui.visibility = if (show) View.VISIBLE else View.GONE
        if (show) pushState()
    }

    /* ---------------- page WebView ---------------- */

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    private fun setupPage() {
        val s = page.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.mediaPlaybackRequiresUserGesture = false
        s.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        s.useWideViewPort = true
        s.loadWithOverviewMode = true
        s.setSupportZoom(true)
        s.builtInZoomControls = true
        s.displayZoomControls = false
        s.userAgentString = s.userAgentString.replace("; wv", "").replace(Regex("Version/\\d+\\.\\d+ "), "")
        userAgent = s.userAgentString

        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        cm.setAcceptThirdPartyCookies(page, true)

        page.addJavascriptInterface(PageBridge(), "DansoPage")
        docStartSupported = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        if (docStartSupported) {
            WebViewCompat.addDocumentStartJavaScript(page, injectScript, setOf("*"))
        }

        page.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                resetState(url)
                if (!docStartSupported) view.evaluateJavascript(injectScript, null)
                urlBox.setText(url)
                progress.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView, url: String) {
                pageTitle = view.title ?: ""
                progress.visibility = View.GONE
                schedulePush()
            }

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                recordNet(request)
                return null
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val scheme = request.url.scheme ?: ""
                return scheme != "http" && scheme != "https" && scheme != "about" && scheme != "blob" && scheme != "data"
            }
        }
        page.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                progress.progress = newProgress
            }

            override fun onReceivedTitle(view: WebView, title: String?) {
                pageTitle = title ?: ""
            }
        }
        page.setDownloadListener(DownloadListener { url, ua, _, mime, _ ->
            io.execute {
                try {
                    val name = Downloader.fetch(this, url, CookieManager.getInstance().getCookie(url), ua, pageUrl, null, mime)
                    toast("ذخیره شد: $name")
                } catch (e: Exception) {
                    toast("خطا: " + (e.message ?: "download"))
                }
            }
        })
    }

    private fun resetState(url: String) {
        synchronized(lock) {
            pageUrl = url
            pageTitle = ""
            hook = false
            scenes = JSONArray()
            mvs = JSONArray()
            dom = JSONArray()
            perf = null
            found3d.clear()
            net.clear()
            hosts.clear()
        }
        schedulePush()
    }

    private fun recordNet(r: WebResourceRequest) {
        val u = r.url.toString()
        if (!u.startsWith("http")) return
        val host = r.url.host ?: ""
        val path = r.url.path ?: ""
        val ext = path.substringAfterLast('.', "").lowercase()
        val kind: String? = when {
            ext in ext3d -> "3d"
            ext == "svg" -> "svg-file"
            ext in extImg -> "image"
            ext in extVid -> "video"
            ext in extAud -> "audio"
            ext == "m3u8" || ext == "mpd" -> "stream"
            else -> null
        }
        synchronized(lock) {
            hosts[host] = (hosts[host] ?: 0) + 1
            if (kind != null && !net.containsKey(u)) {
                val o = JSONObject()
                o.put("url", u)
                o.put("kind", kind)
                o.put("ext", ext)
                net[u] = o
                if (net.size > 500) {
                    val first = net.keys.first()
                    net.remove(first)
                }
            }
        }
        if (kind != null) schedulePush()
    }

    /* ---------------- state -> UI ---------------- */

    private fun buildState(): JSONObject {
        val o = JSONObject()
        o.put("url", pageUrl)
        o.put("title", pageTitle)
        o.put("hook", hook)
        o.put("scenes", scenes)
        o.put("mvs", mvs)
        o.put("dom", dom)
        if (perf != null) o.put("perf", perf)
        val a = JSONArray()
        for (v in found3d.values) a.put(v)
        o.put("assets", a)
        val n = JSONArray()
        for (v in net.values) n.put(v)
        o.put("net", n)
        val h = JSONObject()
        for ((k, v) in hosts) h.put(k, v)
        o.put("hosts", h)
        return o
    }

    private fun schedulePush() {
        handler.post {
            if (!pushPending) {
                pushPending = true
                handler.postDelayed({
                    pushPending = false
                    pushState()
                }, 350)
            }
        }
    }

    private fun pushState() {
        if (ui.visibility != View.VISIBLE) return
        val json = synchronized(lock) { buildState().toString() }
        ui.evaluateJavascript("window.__state&&window.__state($json)", null)
    }

    private fun result(id: Int, obj: JSONObject) {
        handler.post { ui.evaluateJavascript("window.__result&&window.__result($id,$obj)", null) }
    }

    private fun resultOk(id: Int, name: String) {
        val o = JSONObject()
        o.put("ok", true)
        o.put("name", name)
        result(id, o)
    }

    private fun resultErr(id: Int, msg: String) {
        val o = JSONObject()
        o.put("ok", false)
        o.put("error", msg)
        result(id, o)
    }

    private fun toast(msg: String) {
        handler.post { Toast.makeText(this, msg, Toast.LENGTH_SHORT).show() }
    }

    /* ---------------- bridge: page -> native ---------------- */

    inner class PageBridge {
        @JavascriptInterface
        fun msg(json: String) {
            try {
                val o = JSONObject(json)
                synchronized(lock) {
                    val k = o.optString("k")
                    if (k == "hello") {
                        hook = true
                    } else if (k == "scan") {
                        scenes = o.optJSONArray("scenes") ?: JSONArray()
                        mvs = o.optJSONArray("mvs") ?: JSONArray()
                        hook = true
                    } else if (k == "asset3d") {
                        val item = o.optJSONObject("item")
                        if (item != null) found3d[item.optString("url")] = item
                    } else if (k == "dom") {
                        dom = o.optJSONArray("items") ?: JSONArray()
                        perf = o.optJSONObject("perf")
                        val t = o.optString("title")
                        if (t.isNotEmpty()) pageTitle = t
                    }
                }
                schedulePush()
            } catch (e: Exception) {
                // ignore malformed messages
            }
        }

        @JavascriptInterface
        fun chunk(reqId: Int, idx: Int, total: Int, b64: String) {
            val buf = buffers.getOrPut(reqId) { ByteArrayOutputStream() }
            synchronized(buf) { buf.write(Base64.decode(b64, Base64.DEFAULT)) }
        }

        @JavascriptInterface
        fun fileDone(reqId: Int, name: String, mime: String) {
            val buf = buffers.remove(reqId)
            if (buf == null) {
                resultErr(reqId, "empty")
                return
            }
            io.execute {
                try {
                    val saved = Downloader.saveBytes(this@MainActivity, name, mime, buf.toByteArray())
                    toast("ذخیره شد: $saved")
                    resultOk(reqId, saved)
                } catch (e: Exception) {
                    resultErr(reqId, e.message ?: "save failed")
                }
            }
        }

        @JavascriptInterface
        fun json(reqId: Int, payload: String) {
            handler.post { ui.evaluateJavascript("window.__result&&window.__result($reqId,{\"ok\":true,\"data\":$payload})", null) }
        }

        @JavascriptInterface
        fun err(reqId: Int, msg: String) {
            buffers.remove(reqId)
            resultErr(reqId, msg)
        }
    }

    /* ---------------- bridge: UI -> native ---------------- */

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    private fun setupUi() {
        val s = ui.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        ui.setBackgroundColor(0xFF0F1C30.toInt())
        ui.addJavascriptInterface(UiBridge(), "Native")
        ui.webViewClient = WebViewClient()
        ui.loadUrl("file:///android_asset/ui/index.html")
    }

    inner class UiBridge {
        @JavascriptInterface
        fun ready() {
            handler.post { pushState() }
        }

        @JavascriptInterface
        fun cmd(json: String) {
            val c: JSONObject
            try {
                c = JSONObject(json)
            } catch (e: Exception) {
                return
            }
            val id = c.optInt("reqId")
            when (c.optString("type")) {
                "run" -> handler.post {
                    page.evaluateJavascript("window.__dansoAnd&&window.__dansoAnd.run($json)", null)
                }
                "scan" -> handler.post {
                    page.evaluateJavascript("window.__dansoAnd&&window.__dansoAnd.scan()", null)
                }
                "download" -> io.execute {
                    try {
                        val url = c.getString("url")
                        val name = Downloader.fetch(
                            this@MainActivity, url, CookieManager.getInstance().getCookie(url), userAgent, pageUrl,
                            c.optString("filename").ifEmpty { null }, c.optString("mime").ifEmpty { null }
                        )
                        toast("ذخیره شد: $name")
                        resultOk(id, name)
                    } catch (e: Exception) {
                        resultErr(id, e.message ?: "download failed")
                    }
                }
                "saveText" -> io.execute {
                    try {
                        val name = Downloader.saveBytes(
                            this@MainActivity, c.getString("name"),
                            c.optString("mime", "text/plain"), c.getString("text").toByteArray(Charsets.UTF_8)
                        )
                        toast("ذخیره شد: $name")
                        resultOk(id, name)
                    } catch (e: Exception) {
                        resultErr(id, e.message ?: "save failed")
                    }
                }
                "copy" -> handler.post {
                    val cb = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    cb.setPrimaryClip(ClipData.newPlainText("Danso", c.optString("text")))
                }
                "open" -> handler.post {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(c.getString("url"))))
                    } catch (e: Exception) {
                        // no handler
                    }
                }
                "reload" -> handler.post { page.reload() }
                "hide" -> handler.post { setPanel(false) }
                "conn" -> io.execute { connInfo(id, c.optString("url")) }
            }
        }
    }

    private fun connInfo(id: Int, urlStr: String) {
        val o = JSONObject()
        o.put("ok", true)
        try {
            val u = URL(urlStr)
            o.put("host", u.host)
            val addrs = InetAddress.getAllByName(u.host)
            var ip = addrs[0].hostAddress
            for (a in addrs) {
                if (a is java.net.Inet4Address) {
                    ip = a.hostAddress
                    break
                }
            }
            o.put("ip", ip)
            try {
                val con = u.openConnection() as HttpURLConnection
                con.instanceFollowRedirects = true
                con.connectTimeout = 8000
                con.readTimeout = 8000
                con.setRequestProperty("User-Agent", userAgent)
                val cookie = CookieManager.getInstance().getCookie(urlStr)
                if (!cookie.isNullOrEmpty()) con.setRequestProperty("Cookie", cookie)
                o.put("status", con.responseCode)
                val names = JSONArray()
                val vals = JSONObject()
                val keep = setOf("server", "x-powered-by", "content-encoding", "cache-control", "via", "alt-svc", "cf-cache-status", "x-vercel-cache", "x-cache", "x-served-by", "strict-transport-security", "x-generator")
                for ((k, v) in con.headerFields) {
                    if (k == null) continue
                    val lk = k.lowercase()
                    names.put(lk)
                    if (lk in keep && v != null && v.isNotEmpty()) vals.put(lk, v[0])
                }
                o.put("names", names)
                o.put("vals", vals)
                con.disconnect()
            } catch (e: Exception) {
                o.put("headersError", e.message ?: "")
            }
        } catch (e: Exception) {
            o.put("ok", false)
            o.put("error", e.message ?: "lookup failed")
        }
        result(id, o)
    }

    override fun onDestroy() {
        page.removeJavascriptInterface("DansoPage")
        ui.removeJavascriptInterface("Native")
        super.onDestroy()
    }
}
