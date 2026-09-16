package id.my.adiirmd.armusic

import android.annotation.SuppressLint
import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView

    /**
     * Bridge the web player uses to say whether audio is running. The web app
     * calls it through `window.ARMusicNative`; in a plain browser the object
     * simply does not exist and the call is skipped.
     */
    inner class NativeBridge {
        @JavascriptInterface
        fun setPlaying(playing: Boolean, title: String, artist: String) {
            runOnUiThread {
                if (playing) PlaybackService.start(this@MainActivity, title, artist)
                else PlaybackService.stop(this@MainActivity)
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        web = WebView(this)
        setContentView(web)
        web.setBackgroundColor(Color.parseColor("#070c16"))

        // WebView support for CSS env(safe-area-inset-*) is inconsistent across
        // Android versions, so keep the page clear of the status and navigation
        // bars here rather than trusting the page to do it.
        ViewCompat.setOnApplyWindowInsetsListener(web) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true           // the whole library lives in localStorage
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            cacheMode = WebSettings.LOAD_DEFAULT
            // no file:// or content:// access — this app only ever shows one site
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
        }

        web.addJavascriptInterface(NativeBridge(), "ARMusicNative")
        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val url = req.url
                // Keep the app on its own site and on the YouTube frames the
                // player needs. Anything else opens in the real browser, so the
                // app can never be turned into a general purpose browser.
                if (isAllowed(url)) return false
                return try {
                    startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, url))
                    true
                } catch (_: Exception) {
                    true
                }
            }
        }

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl(SITE_URL)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        askNotificationPermissionIfNeeded()
    }

    private fun isAllowed(url: Uri): Boolean {
        if (url.scheme != "https") return false
        val host = url.host ?: return false
        return host == SITE_HOST ||
            host.endsWith(".youtube.com") || host == "youtube.com" ||
            host.endsWith(".ytimg.com") ||
            host.endsWith(".googlevideo.com") ||
            host.endsWith(".ggpht.com") ||
            host.endsWith(".googleusercontent.com") ||
            host == "fonts.googleapis.com" || host == "fonts.gstatic.com"
    }

    /** Android 13+ will not show the playback notification without this. */
    private fun askNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
        if (granted != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    /**
     * Deliberately NOT calling web.onPause() or pauseTimers() here. Those are
     * what silence a WebView the moment the app leaves the screen, and keeping
     * them out is the whole reason playback survives backgrounding.
     */
    override fun onPause() {
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onDestroy() {
        PlaybackService.stop(this)
        web.destroy()
        super.onDestroy()
    }

    companion object {
        const val SITE_HOST = "music.adiirmd.my.id"
        const val SITE_URL = "https://$SITE_HOST/"
    }
}
