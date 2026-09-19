package id.my.adiirmd.armusic

import android.annotation.SuppressLint
import android.content.Context
import android.view.View
import android.webkit.WebView

/**
 * A WebView that never admits to being hidden.
 *
 * This is what keeps the sound going when the app is put away. The chain runs
 * like this: the app leaves the screen, its window counts as invisible, the
 * WebView passes that on to the page as a visibilityState of "hidden", and the
 * YouTube player inside pauses itself. That pause comes from the page rather
 * than from the system, so calling play over and over never wins.
 *
 * By always reporting View.VISIBLE, the page never receives
 * kabar bahwa ia disembunyikan, sehingga pemutarnya terus berjalan. Prosesnya
 * itself is kept alive by PlaybackService running in the foreground.
 */
@SuppressLint("ViewConstructor")
class BackgroundWebView(context: Context) : WebView(context) {

    /** True selama activity benar-benar dibongkar; barulah WebView boleh diam. */
    var releasing = false

    override fun onWindowVisibilityChanged(visibility: Int) {
        // On teardown, hand normal behaviour back so nothing is left leaking.
        if (releasing) super.onWindowVisibilityChanged(visibility)
        else super.onWindowVisibilityChanged(View.VISIBLE)
    }

    override fun onVisibilityChanged(changedView: View, visibility: Int) {
        if (releasing) super.onVisibilityChanged(changedView, visibility)
        else super.onVisibilityChanged(changedView, View.VISIBLE)
    }
}
