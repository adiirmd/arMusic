package id.my.adiirmd.armusic

import android.app.Application
import android.os.Build
import android.webkit.WebView

class ARMusicApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Multiple processes would fight over the same WebView data directory.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val proc = getProcessName()
            if (packageName != proc) WebView.setDataDirectorySuffix(proc)
        }
    }
}
