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
        /**
         * Unduhan. WebView tidak mengunduh apa pun sendiri: mengeklik tautan
         * unduh di dalamnya tidak menghasilkan apa apa, dan halaman tidak
         * pernah diberi kabar bahwa tidak terjadi apa apa. Karena itu halaman
         * menyerahkannya ke sini, lengkap dengan nama berkas yang diinginkan,
         * supaya yang tersimpan bernama judul lagunya dan bukan nama acak dari
         * server pengonversi.
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

        // Jaring pengaman. Jalur utamanya lewat NativeBridge.download, tetapi
        // kalau ada unduhan yang terpicu dengan cara lain, tanpa pendengar ini
        // WebView membuangnya diam diam dan tidak ada yang pernah tahu.
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
     * Audionya berasal dari pemutar YouTube di dalam WebView, dan pemutar itu
     * berhenti sendiri begitu halamannya dianggap tidak terlihat. Karena itu
     * WebView-nya adalah BackgroundWebView, yang tidak pernah meneruskan kabar
     * "tersembunyi" ke halaman. Tiga hal ini harus berjalan bersama:
     *
     *   1. WebView tidak pernah melaporkan dirinya tersembunyi
     *   2. onPause() dan pauseTimers() tidak pernah dipanggil di sini
     *   3. PlaybackService berjalan di foreground, supaya prosesnya tidak
     *      dibekukan dan ada notifikasi kontrolnya
     */
    private fun keepRendererHot() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        // Tanpa ini proses renderer diturunkan prioritasnya begitu tidak
        // terlihat, dan audionya bisa tersendat di HP dengan memori sempit.
        runCatching {
            web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
        }
    }

    /**
     * Menyerahkan berkasnya ke pengunduh bawaan Android, bukan mengunduhnya
     * sendiri. Dengan begitu ada notifikasi kemajuan, unduhannya lanjut walau
     * aplikasi ditutup, dan berkasnya masuk ke folder Musik seperti unduhan
     * lain. Batasan skemanya penting: tanpa itu halaman bisa menyuruh membuka
     * berkas apa pun di perangkat lewat skema file atau content.
     */
    private fun unduh(url: String, namaDiminta: String) {
        val uri = runCatching { Uri.parse(url) }.getOrNull()
        if (uri == null || (uri.scheme != "https" && uri.scheme != "http")) {
            Toast.makeText(this, "Tautan unduhan tidak dikenali", Toast.LENGTH_SHORT).show()
            return
        }
        // Pemisah folder harus disingkirkan, atau berkasnya bisa mendarat di
        // luar folder tujuan.
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
                // Android lawas menuntut izin menulis untuk folder umum. Kalau
                // ditolak, tetap terunduh, hanya tempatnya milik aplikasi ini.
                minta.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_MUSIC, nama)
            }
            getSystemService(DownloadManager::class.java).enqueue(minta)
        }

        if (hasil.isSuccess) {
            Toast.makeText(this, "Mengunduh $nama", Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(this, "Unduhan gagal dimulai", Toast.LENGTH_LONG).show()
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
