package cloud.lork.lonora.admin

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

/**
 * Thin WebView shell. The real admin lives at the production origin so
 * relative /api/admin calls, the aichart_session cookie, and Bearer JWT
 * stay on the same host. Loading a file URL or a fake host breaks login.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var lastUpdateCheckMs = 0L

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val callback = filePathCallback
        filePathCallback = null
        if (callback == null) return@registerForActivityResult
        val uris = WebChromeClient.FileChooserParams.parseResult(
            result.resultCode,
            result.data,
        )
        callback.onReceiveValue(uris)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)

        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        cookies.setAcceptThirdPartyCookies(webView, true)

        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.javaScriptCanOpenWindowsAutomatically = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.builtInZoomControls = true
        settings.displayZoomControls = false
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        webView.webViewClient = AdminWebViewClient()
        webView.webChromeClient = AdminChromeClient()

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (webView.canGoBack()) {
                        webView.goBack()
                    } else {
                        finish()
                    }
                }
            },
        )

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl(ADMIN_URL)
        }
        checkForUpdate()
    }

    override fun onResume() {
        super.onResume()
        checkForUpdate()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        CookieManager.getInstance().flush()
        webView.destroy()
        super.onDestroy()
    }

    private fun checkForUpdate() {
        val now = System.currentTimeMillis()
        if (now - lastUpdateCheckMs < UPDATE_CHECK_MIN_INTERVAL_MS) return
        lastUpdateCheckMs = now
        UpdateChecker.check(this)
    }

    private inner class AdminWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(
            view: WebView,
            request: WebResourceRequest,
        ): Boolean {
            val host = request.url.host ?: return false
            if (host == ADMIN_HOST || host.endsWith(".$ADMIN_HOST_SUFFIX")) {
                return false
            }
            return try {
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
                true
            } catch (ignored: ActivityNotFoundException) {
                false
            }
        }

        override fun onPageFinished(view: WebView?, url: String?) {
            CookieManager.getInstance().flush()
        }
    }

    private inner class AdminChromeClient : WebChromeClient() {
        override fun onShowFileChooser(
            webView: WebView?,
            callback: ValueCallback<Array<Uri>>?,
            fileChooserParams: FileChooserParams?,
        ): Boolean {
            filePathCallback?.onReceiveValue(null)
            filePathCallback = callback
            val intent = fileChooserIntent(fileChooserParams)
            return try {
                fileChooserLauncher.launch(intent)
                true
            } catch (ignored: ActivityNotFoundException) {
                filePathCallback = null
                callback?.onReceiveValue(null)
                false
            }
        }
    }

    private fun fileChooserIntent(params: WebChromeClient.FileChooserParams?): Intent {
        val fromParams = try {
            params?.createIntent()
        } catch (ignored: Exception) {
            null
        }
        if (fromParams != null) return fromParams
        val fallback = Intent(Intent.ACTION_GET_CONTENT)
        fallback.addCategory(Intent.CATEGORY_OPENABLE)
        fallback.type = ANY_MIME
        return fallback
    }

    companion object {
        const val ADMIN_URL = "https://aichart.lork.cloud/admin-app/"
        const val ADMIN_HOST = "aichart.lork.cloud"
        const val ADMIN_HOST_SUFFIX = "lork.cloud"
        const val ORIGIN = "https://aichart.lork.cloud"
        private const val UPDATE_CHECK_MIN_INTERVAL_MS = 30_000L
        private const val ANY_MIME = "*/*"
    }
}
