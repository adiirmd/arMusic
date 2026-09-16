package id.my.adiirmd.armusic

import android.annotation.SuppressLint
import android.Manifest
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.Intent
import android.content.res.Configuration
import android.graphics.drawable.Icon
import android.util.Rational
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.annotation.ChecksSdkIntAtLeast
import androidx.annotation.RequiresApi
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.updatePadding

class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var root: FrameLayout
    private var isPlayingNow = false

    /**
     * Bridge the web player uses to say whether audio is running. The web app
     * calls it through `window.ARMusicNative`; in a plain browser the object
     * simply does not exist and the call is skipped.
     */
    inner class NativeBridge {
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
                isPlayingNow = playing
                refreshPipParams()
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
        web = WebView(this)
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
                    else leaveApp()
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
     * Background playback, the only way it can work here.
     *
     * The audio comes from YouTube's embedded player, and that player pauses
     * itself the moment its page stops being visible — the same rule that stops
     * youtube.com playing in a background tab without Premium. No amount of
     * calling play() from our side wins that argument.
     *
     * Picture-in-Picture sidesteps it honestly: the window stays genuinely
     * visible, just small, so the player never considers itself hidden and
     * keeps going. Entering it automatically on minimise is what makes the
     * music survive leaving the app.
     */
    @ChecksSdkIntAtLeast(api = Build.VERSION_CODES.O)
    private fun pipSupported(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

    @RequiresApi(Build.VERSION_CODES.O)
    private fun pipAction(iconRes: Int, label: String, action: String): RemoteAction {
        val pi = PendingIntent.getService(
            this, action.hashCode(),
            Intent(this, PlaybackService::class.java).setAction(action),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return RemoteAction(Icon.createWithResource(this, iconRes), label, label, pi)
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun buildPipParams(): PictureInPictureParams {
        val b = PictureInPictureParams.Builder().setAspectRatio(Rational(1, 1))
        b.setActions(
            listOf(
                pipAction(R.drawable.ic_note_prev, "Sebelumnya", PlaybackService.ACTION_PREV),
                pipAction(
                    if (isPlayingNow) R.drawable.ic_note_pause else R.drawable.ic_note_play,
                    if (isPlayingNow) "Jeda" else "Putar", PlaybackService.ACTION_TOGGLE
                ),
                pipAction(R.drawable.ic_note_next, "Berikutnya", PlaybackService.ACTION_NEXT)
            )
        )
        // Android 12+ can slide straight into PiP on the home gesture, which is
        // smoother than reacting to onUserLeaveHint after the fact.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) b.setAutoEnterEnabled(isPlayingNow)
        return b.build()
    }

    private fun refreshPipParams() {
        if (!pipSupported()) return
        runCatching { setPictureInPictureParams(buildPipParams()) }
    }

    /**
     * Leaving by the back gesture. moveTaskToBack() alone hides the window, and
     * a hidden window is exactly what makes the embedded player stop, so slip
     * into Picture-in-Picture instead whenever something is playing.
     */
    private fun leaveApp() {
        if (pipSupported() && isPlayingNow && !isInPictureInPictureMode) {
            val ok = runCatching { enterPictureInPictureMode(buildPipParams()) }.getOrDefault(false)
            if (ok) return
        }
        moveTaskToBack(true)
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        // Android 8 to 11 have no auto-enter, so ask for it as the user leaves.
        if (pipSupported() && isPlayingNow && !isInPictureInPictureMode) {
            runCatching { enterPictureInPictureMode(buildPipParams()) }
        }
    }

    override fun onPictureInPictureModeChanged(inPip: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(inPip, newConfig)
        // A tiny window cannot show the full UI, so the page switches to a
        // cover-only view while it is shrunk.
        val js = if (inPip)
            "document.documentElement.classList.add('pip-mode');" +
                "window.ARMusicOpenPlayer && ARMusicOpenPlayer();"
        else
            "document.documentElement.classList.remove('pip-mode');"
        web.evaluateJavascript(js, null)
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
        web.destroy()
        super.onDestroy()
    }

    companion object {
        const val SITE_HOST = "music.adiirmd.my.id"
        const val SITE_URL = "https://$SITE_HOST/"
        val BG = Color.parseColor("#070c16")
    }
}
