package cloud.lork.lonora.admin

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * The APK cannot silently auto-install. When a newer package is published
 * the running app must tell the operator, and leave them free to dismiss
 * unless `minVersionCode` is raised above the installed build.
 */
object UpdateChecker {
    private const val MANIFEST_URL = "https://aichart.lork.cloud/admin-android/version.json"
    private var dialogShowing = false

    fun check(activity: AppCompatActivity) {
        val installed = installedVersionCode(activity)
        Thread {
            val remote = fetchManifest() ?: return@Thread
            Handler(Looper.getMainLooper()).post {
                if (activity.isFinishing || activity.isDestroyed) return@post
                maybePrompt(activity, installed, remote)
            }
        }.start()
    }

    private fun installedVersionCode(activity: AppCompatActivity): Long {
        val info = activity.packageManager.getPackageInfo(activity.packageName, 0)
        return if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
            info.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            info.versionCode.toLong()
        }
    }

    private fun fetchManifest(): RemoteVersion? {
        var conn: HttpURLConnection? = null
        return try {
            val url = URL("$MANIFEST_URL?t=${System.currentTimeMillis()}")
            conn = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = 8_000
                readTimeout = 8_000
                instanceFollowRedirects = true
                setRequestProperty("Accept", "application/json")
            }
            if (conn.responseCode !in 200..299) return null
            val json = JSONObject(conn.inputStream.bufferedReader().readText())
            RemoteVersion(
                versionCode = json.getLong("versionCode"),
                versionName = json.optString("versionName", ""),
                apkUrl = json.optString("apkUrl", "/admin-android/lonora-admin.apk"),
                minVersionCode = json.optLong("minVersionCode", 1L),
            )
        } catch (_: Exception) {
            null
        } finally {
            conn?.disconnect()
        }
    }

    private fun maybePrompt(
        activity: AppCompatActivity,
        installed: Long,
        remote: RemoteVersion,
    ) {
        if (remote.versionCode <= installed) return
        if (dialogShowing) return
        dialogShowing = true

        val force = remote.minVersionCode > installed
        val title = activity.getString(
            if (force) R.string.update_required_title else R.string.update_title,
        )
        val message = activity.getString(
            if (force) R.string.update_required_message else R.string.update_message,
            remote.versionName.ifBlank { remote.versionCode.toString() },
        )
        val builder = AlertDialog.Builder(activity)
            .setTitle(title)
            .setMessage(message)
            .setPositiveButton(R.string.update_download) { _, _ ->
                openApk(activity, remote.apkUrl)
            }
            .setOnDismissListener { dialogShowing = false }
        if (!force) {
            builder.setNegativeButton(R.string.update_later, null)
            builder.setCancelable(true)
        } else {
            builder.setCancelable(false)
        }
        builder.show()
    }

    private fun openApk(activity: AppCompatActivity, rawUrl: String) {
        val resolved = resolveApkUrl(rawUrl)
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(resolved)))
        } catch (_: ActivityNotFoundException) {
            // No browser — the operator can still use the current build.
        }
    }

    internal fun resolveApkUrl(raw: String): String {
        val trimmed = raw.trim()
        if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) return trimmed
        val path = if (trimmed.startsWith("/")) trimmed else "/$trimmed"
        return MainActivity.ORIGIN + path
    }

    private data class RemoteVersion(
        val versionCode: Long,
        val versionName: String,
        val apkUrl: String,
        val minVersionCode: Long,
    )
}
