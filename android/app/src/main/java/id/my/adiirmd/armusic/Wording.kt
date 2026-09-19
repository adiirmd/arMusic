package id.my.adiirmd.armusic

import android.content.Context

/**
 * The handful of words Android shows on its own: the notification buttons, the
 * name of the notification channel, and the messages that appear when a song
 * is downloaded. Everything else people read comes from the web page.
 *
 * These follow the language picked inside the app rather than the language of
 * the phone. Someone who sets AR Music to English on an Indonesian phone means
 * it, and a notification answering in the other language would look like a
 * different app entirely.
 *
 * Small enough to live in one place. Splitting six words across Android's own
 * translation files would spread them over three folders and still not follow
 * the in app choice, which is the whole point.
 *
 * The page hands the choice over through the bridge and it is kept on disk, so
 * the service still knows the language when it starts before the page has had
 * a chance to load.
 */
object Wording {

    private const val PREFS = "armusic"
    private const val KEY = "lang"

    private val EN = mapOf(
        "channel" to "Playback",
        "channelDesc" to "Keeps the music going while the app is in the background",
        "previous" to "Previous",
        "next" to "Next",
        "play" to "Play",
        "pause" to "Pause",
        "downloading" to "Downloading %s",
        "downloadFailed" to "Could not start the download",
        "badLink" to "That download link was not recognised",
    )

    private val ID = mapOf(
        "channel" to "Pemutaran",
        "channelDesc" to "Menjaga musik tetap jalan saat aplikasi ada di latar belakang",
        "previous" to "Sebelumnya",
        "next" to "Berikutnya",
        "play" to "Putar",
        "pause" to "Jeda",
        "downloading" to "Mengunduh %s",
        "downloadFailed" to "Unduhan gagal dimulai",
        "badLink" to "Tautan unduhan tidak dikenali",
    )

    fun set(ctx: Context, code: String) {
        val clean = if (code == "id") "id" else "en"
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, clean).apply()
    }

    fun current(ctx: Context): String =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "en") ?: "en"

    fun of(ctx: Context, key: String): String {
        val table = if (current(ctx) == "id") ID else EN
        return table[key] ?: EN[key] ?: key
    }
}
