package id.my.adiirmd.armusic

import android.annotation.SuppressLint
import android.content.Context
import android.view.View
import android.webkit.WebView

/**
 * WebView yang tidak pernah melaporkan dirinya tersembunyi.
 *
 * Inilah yang membuat audio tetap berbunyi saat aplikasi diminimize.
 * Rantainya begini: aplikasi ditinggalkan -> jendelanya dianggap tidak
 * terlihat -> WebView meneruskan itu ke halaman sebagai visibilityState
 * "hidden" -> pemutar YouTube di dalamnya menjeda dirinya sendiri. Jeda itu
 * datang dari halaman, bukan dari sistem, jadi memanggil play berulang kali
 * tidak pernah menang.
 *
 * Dengan selalu meneruskan View.VISIBLE, halamannya tidak pernah menerima
 * kabar bahwa ia disembunyikan, sehingga pemutarnya terus berjalan. Prosesnya
 * sendiri dijaga tetap hidup oleh PlaybackService yang berjalan di foreground.
 */
@SuppressLint("ViewConstructor")
class BackgroundWebView(context: Context) : WebView(context) {

    /** True selama activity benar-benar dibongkar; barulah WebView boleh diam. */
    var releasing = false

    override fun onWindowVisibilityChanged(visibility: Int) {
        // Saat dibongkar, biarkan perilaku aslinya supaya tidak ada yang bocor.
        if (releasing) super.onWindowVisibilityChanged(visibility)
        else super.onWindowVisibilityChanged(View.VISIBLE)
    }

    override fun onVisibilityChanged(changedView: View, visibility: Int) {
        if (releasing) super.onVisibilityChanged(changedView, visibility)
        else super.onVisibilityChanged(changedView, View.VISIBLE)
    }
}
