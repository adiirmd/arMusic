package id.my.adiirmd.armusic

import android.annotation.SuppressLint
import android.Manifest
import android.app.DownloadManager
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.updatePadding

class MainActivity : AppCompatActivity() {

    private lateinit var web: BackgroundWebView
    private lateinit var root: FrameLayout

    /**
     * Bridge the web player uses to say whether audio is running. The web app
     * calls it through `window.ARMusicNative`; in a plain browser the object
     * simply does not exist and the call is skipped.
     */
    inner class NativeBridge {
        /** The page tells us which language it is showing, so the notification
         *  and the messages below answer in the same one. */
        @JavascriptInterface
        fun setLanguage(code: String) {
            runOnUiThread {
                val before = Wording.current(this@MainActivity)
                Wording.set(this@MainActivity, code)
                if (Wording.current(this@MainActivity) != before) {
                    PlaybackService.refresh(this@MainActivity)
                }
            }
        }

        /**
         * Downloads. A WebView never downloads anything by itself: tapping a
         * download link inside one does nothing at all, and the page is never
         * told that nothing happened. So the page hands it over here along with
         * the filename it wants, which is how the saved file ends up named
         * after the song instead of whatever the converter called it.
         */
        @JavascriptInterface
        fun download(url: String, name: String) {
            runOnUiThread { unduh(url, name) }
        }

        @JavascriptInterface
        fun setPlaying(playing: Boolean, title: String, artist: String, art: String, duration: Int) {
            runOnUiThread {
                if (title.isBlank()) {
                    // nothing loaded, so there is nothing to show controls for
                    PlaybackService.stop(this@MainActivity)
                } else {
                    // The notification stays up while paused too, the way a
                    // music app behaves: pausing must not make it vanish.
                    PlaybackService.update(this@MainActivity, playing, title, artist, art, duration)
                }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // The WebView sits inside a plain container that owns the insets.
        // Listening on the content view directly did not work: AppCompat's own
        // content frame can swallow the insets first, and a listener attached
        // after the view is already laid out never receives a dispatch unless
        // one is requested explicitly.
        root = FrameLayout(this)
        root.setBackgroundColor(BG)
        web = BackgroundWebView(this)
        web.setBackgroundColor(BG)
        root.addView(web, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)

        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            v.updatePadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        ViewCompat.requestApplyInsets(root)

        // Dark background, so the clock and battery icons have to stay light.
        WindowInsetsControllerCompat(window, root).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
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
        web.isVerticalScrollBarEnabled = false
        web.isHorizontalScrollBarEnabled = false
        web.overScrollMode = WebView.OVER_SCROLL_NEVER

        keepRendererHot()
        web.addJavascriptInterface(NativeBridge(), "ARMusicNative")

        // A safety net. The main route is NativeBridge.download, but if a
        // download is triggered some other way, a WebView without this listener
        // throws it away quietly and nobody ever finds out.
        web.setDownloadListener { url, _, disposisi, jenis, _ ->
            unduh(url, URLUtil.guessFileName(url, disposisi, jenis))
        }

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

            override fun onPageFinished(view: WebView, url: String?) {
                // Tell the page it is running inside the app, so it can drop
                // styling that only makes sense in a browser tab.
                view.evaluateJavascript(
                    "document.documentElement.classList.add('in-app');", null
                )
            }
        }

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl(SITE_URL)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Ask the page to close whatever is layered on top — Now Playing
                // or a dialog — before treating back as "leave".
                web.evaluateJavascript(
                    "(window.ARMusicCloseOverlay && ARMusicCloseOverlay()) ? 'y' : 'n'"
                ) { result ->
                    if (result?.contains("y") == true) return@evaluateJavascript
                    if (web.canGoBack()) web.goBack()
                    // Never finish(): destroying the activity destroys the
                    // WebView, and the music is playing inside it.
                    else moveTaskToBack(true)
                }
            }
        })

        // Transport buttons on the notification reach the player through here.
        PlaybackCommands.handler = { cmd ->
            runOnUiThread {
                web.evaluateJavascript("window.ARMusicCommand && ARMusicCommand('$cmd')", null)
            }
        }

        askNotificationPermissionIfNeeded()
    }

    /*
     * Pemutaran di latar belakang.
     *
     * The sound comes from the YouTube player inside the WebView, and that
     * player stops itself the moment its page counts as out of sight. So the
     * WebView here is a BackgroundWebView, which never passes the word
     * "hidden" on to the page. Three things have to hold together:
     *
     *   1. the WebView never admits to being hidden
     *   2. onPause() and pauseTimers() are never called here
     *   3. PlaybackService runs in the foreground, so the process is not
     *      frozen and there is a notification to control it from
     */
    private fun keepRendererHot() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        // Without this the renderer process is demoted as soon as it leaves
        // the screen, and the sound stutters on phones that are short on memory.
        runCatching {
            web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
        }
    }

    /**
     * Hands the file to Android's own downloader rather than fetching it
     * here. That way there is a progress notification, the download carries on
     * even if the app is closed, and the file lands in the Music folder like
     * any other download. Limiting the scheme matters: without it the page
     * could point this at any file on the device through file or content.
     */
    private fun unduh(url: String, namaDiminta: String) {
        val uri = runCatching { Uri.parse(url) }.getOrNull()
        if (uri == null || (uri.scheme != "https" && uri.scheme != "http")) {
            Toast.makeText(this, Wording.of(this, "badLink"), Toast.LENGTH_SHORT).show()
            return
        }
        // Path separators have to go, or the file could land somewhere other
        // than the folder it was meant for.
        val nama = namaDiminta.substringAfterLast('/').substringAfterLast('\\')
            .ifBlank { "armusic.mp3" }

        val hasil = runCatching {
            val minta = DownloadManager.Request(uri)
                .setTitle(nama)
                .setDescription("AR Music")
                .setMimeType("audio/mpeg")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(true)
            runCatching {
                minta.setDestinationInExternalPublicDir(Environment.DIRECTORY_MUSIC, nama)
            }.onFailure {
                // Older Android wants write permission for a public folder. If
                // that is refused it still downloads, just into the app's own space.
                minta.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_MUSIC, nama)
            }
            getSystemService(DownloadManager::class.java).enqueue(minta)
        }

        if (hasil.isSuccess) {
            Toast.makeText(this, Wording.of(this, "downloading").format(nama), Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(this, Wording.of(this, "downloadFailed"), Toast.LENGTH_LONG).show()
        }
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
        ViewCompat.requestApplyInsets(root)
    }

    override fun onDestroy() {
        // Only tear down when the task is really going away. Stopping the
        // service on every destroy is what made playback and the notification
        // disappear the moment the app left the screen.
        if (isFinishing) PlaybackService.stop(this)
        PlaybackCommands.handler = null
        web.releasing = true
        web.destroy()
        super.onDestroy()
    }

    companion object {
        const val SITE_HOST = "music.adiirmd.my.id"
        const val SITE_URL = "https://$SITE_HOST/"
        val BG = Color.parseColor("#070c16")
    }
}
