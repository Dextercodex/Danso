package ir.sobhankhalili.danso

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder

object Downloader {

    fun sanitize(name: String): String {
        val cleaned = name.replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]+"), "_").trim().trimStart('.')
        return if (cleaned.isEmpty()) "file" else cleaned.take(120)
    }

    private fun withExtension(name: String, mime: String): String {
        if (Regex("\\.[A-Za-z0-9]{2,5}$").containsMatchIn(name)) return name
        val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)
        return if (ext.isNullOrEmpty()) name else "$name.$ext"
    }

    private fun nameFromUrl(url: String): String {
        return try {
            val last = Uri.parse(url).lastPathSegment ?: "file"
            URLDecoder.decode(last, "UTF-8")
        } catch (e: Exception) {
            "file"
        }
    }

    /** Writes the stream into Downloads/Danso and returns the final display name. */
    fun saveStream(ctx: Context, rawName: String, mime: String, input: InputStream): String {
        val name = sanitize(rawName)
        val resolver = ctx.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, mime)
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Danso")
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IOException("Cannot create file")
        try {
            resolver.openOutputStream(uri)?.use { out -> input.copyTo(out) }
                ?: throw IOException("Cannot open file")
            val done = ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }
            resolver.update(uri, done, null, null)
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            throw e
        }
        return name
    }

    fun saveBytes(ctx: Context, name: String, mime: String, bytes: ByteArray): String {
        return saveStream(ctx, name, mime, bytes.inputStream())
    }

    /** Downloads a URL (sending the WebView cookies, UA and referer) into Downloads/Danso. */
    fun fetch(
        ctx: Context,
        url: String,
        cookie: String?,
        ua: String?,
        referer: String?,
        filename: String?,
        mimeHint: String?
    ): String {
        val con = URL(url).openConnection() as HttpURLConnection
        con.instanceFollowRedirects = true
        con.connectTimeout = 15000
        con.readTimeout = 30000
        if (!ua.isNullOrEmpty()) con.setRequestProperty("User-Agent", ua)
        if (!cookie.isNullOrEmpty()) con.setRequestProperty("Cookie", cookie)
        if (!referer.isNullOrEmpty()) con.setRequestProperty("Referer", referer)
        val code = con.responseCode
        if (code !in 200..299) {
            con.disconnect()
            throw IOException("HTTP $code")
        }
        val headerMime = con.contentType?.substringBefore(';')?.trim()
        val mime: String = mimeHint?.takeIf { it.isNotBlank() }
            ?: headerMime?.takeIf { it.isNotBlank() }
            ?: "application/octet-stream"
        val base: String = filename?.takeIf { it.isNotBlank() } ?: nameFromUrl(url)
        val name = withExtension(sanitize(base), mime)
        val saved: String = try {
            con.inputStream.use { saveStream(ctx, name, mime, it) }
        } finally {
            con.disconnect()
        }
        return saved
    }
}
