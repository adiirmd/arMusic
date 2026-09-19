package id.my.adiirmd.armusic

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.IBinder
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle
import java.net.URL
import java.util.concurrent.Executors

/**
 * Media foreground service.
 *
 * It plays nothing itself — the WebView does — but it owns two things the
 * WebView cannot provide: a process Android will not freeze while music is
 * running, and a MediaSession so the notification and lock screen show proper
 * transport controls instead of a bare line of text.
 */
class PlaybackService : Service() {

    private var session: MediaSessionCompat? = null
    private var art: Bitmap? = null
    private var artUrl: String? = null
    private val io = Executors.newSingleThreadExecutor()

    private var title = ""
    private var artist = ""
    private var playing = false
    private var durationMs = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = true
        session = MediaSessionCompat(this, "ARMusic").apply {
            /*
             * A command has to say what it wants, not "flip whatever is on".
             *
             * Once, onPlay, onPause and onStop all sent "toggle". Android calls
             * onPause and onStop for more than someone pressing a button:
             * another app takes audio focus, headphones are unplugged, a
             * Bluetooth device drops, or the system asks every session to stop.
             * If the music happened to be paused at that moment, "toggle"
             * started it instead. That was the music coming on by itself with
             * nobody having touched anything.
             */
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() = PlaybackCommands.send("play")
                override fun onPause() = PlaybackCommands.send("pause")
                override fun onSkipToNext() = PlaybackCommands.send("next")
                override fun onSkipToPrevious() = PlaybackCommands.send("prev")
                override fun onStop() = PlaybackCommands.send("pause")
            })
            isActive = true
        }
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stopSelf(); return START_NOT_STICKY }
            // The language changed. Draw the notification again and touch
            // nothing else, or the song showing on it would be wiped: the
            // fields below fall back to defaults whenever extras are missing.
            ACTION_REFRESH -> { createChannel(); startFg(); return START_NOT_STICKY }
            // Transport buttons arrive with no extras: forward and redraw only.
            ACTION_PLAY, ACTION_PAUSE, ACTION_NEXT, ACTION_PREV -> {
                PlaybackCommands.send(
                    when (intent.action) {
                        ACTION_NEXT -> "next"
                        ACTION_PREV -> "prev"
                        ACTION_PLAY -> "play"
                        else -> "pause"
                    }
                )
                startFg()
                return START_NOT_STICKY
            }
        }
        title = intent?.getStringExtra(EXTRA_TITLE)?.takeIf { it.isNotBlank() }
            ?: getString(R.string.app_name)
        artist = intent?.getStringExtra(EXTRA_ARTIST).orEmpty()
        // If the system restarts the service with nothing to go on, keep the
        // last known state. The default used to be true, so the notification
        // claimed to be playing while the music sat paused.
        playing = intent?.getBooleanExtra(EXTRA_PLAYING, playing) ?: playing
        durationMs = (intent?.getIntExtra(EXTRA_DURATION, 0) ?: 0) * 1000L

        val url = intent?.getStringExtra(EXTRA_ART).orEmpty()
        if (url.isNotBlank() && url != artUrl) {
            artUrl = url
            art = null
            loadArt(url)
        } else if (url.isBlank()) {
            artUrl = null
            art = null
        }

        pushSession()
        startFg()
        return START_NOT_STICKY
    }

    private fun startFg() {
        val note = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTE_ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(NOTE_ID, note)
        }
    }

    /** Fetch the cover once, then refresh the notification with it. */
    private fun loadArt(url: String) {
        io.execute {
            val bmp = try {
                URL(url).openStream().use { BitmapFactory.decodeStream(it) }
            } catch (_: Exception) { null }
            if (bmp != null && url == artUrl) {
                art = bmp
                try {
                    pushSession()
                    val mgr = getSystemService(NotificationManager::class.java)
                    mgr.notify(NOTE_ID, buildNotification())
                } catch (_: Exception) {}
            }
        }
    }

    private fun pushSession() {
        val s = session ?: return
        s.setMetadata(
            MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM_ARTIST, artist)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs)
                .apply { art?.let { putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it) } }
                .build()
        )
        s.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY or
                        PlaybackStateCompat.ACTION_PAUSE or
                        PlaybackStateCompat.ACTION_PLAY_PAUSE or
                        PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                        PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                )
                .setState(
                    if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                    PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 1f
                )
                .build()
        )
    }

    private fun action(icon: Int, label: String, cmd: String): NotificationCompat.Action {
        val pi = PendingIntent.getService(
            this, cmd.hashCode(),
            Intent(this, PlaybackService::class.java).setAction(cmd),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Action(icon, label, pi)
    }

    private fun buildNotification(): Notification {
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_music)
            .setContentTitle(title)
            .setContentText(artist)
            .setLargeIcon(art)
            .setContentIntent(open)
            .setOngoing(playing)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(action(R.drawable.ic_note_prev, Wording.of(this, "previous"), ACTION_PREV))
            .addAction(
                // the action follows the icon on screen, so even a stale
                // notification cannot start music that is already paused
                if (playing) action(R.drawable.ic_note_pause, Wording.of(this, "pause"), ACTION_PAUSE)
                else action(R.drawable.ic_note_play, Wording.of(this, "play"), ACTION_PLAY)
            )
            .addAction(action(R.drawable.ic_note_next, Wording.of(this, "next"), ACTION_NEXT))
            .setStyle(
                MediaStyle()
                    .setMediaSession(session?.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )
            .build()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = getSystemService(NotificationManager::class.java)
        // Created every time rather than only once. Calling this again with the
        // same id renames an existing channel instead of adding a second one,
        // which is what lets the channel follow a change of language.
        mgr.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID, Wording.of(this, "channel"), NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = Wording.of(this, "channelDesc")
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
        )
    }

    override fun onDestroy() {
        running = false
        session?.isActive = false
        session?.release()
        session = null
        io.shutdownNow()
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL_ID = "armusic_playback"
        private const val NOTE_ID = 1001
        private const val ACTION_STOP = "id.my.adiirmd.armusic.STOP"
        const val ACTION_PLAY = "id.my.adiirmd.armusic.PLAY"
        const val ACTION_PAUSE = "id.my.adiirmd.armusic.PAUSE"
        const val ACTION_NEXT = "id.my.adiirmd.armusic.NEXT"
        const val ACTION_PREV = "id.my.adiirmd.armusic.PREV"
        const val ACTION_REFRESH = "id.my.adiirmd.armusic.REFRESH"
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_ARTIST = "artist"
        private const val EXTRA_ART = "art"
        private const val EXTRA_PLAYING = "playing"
        private const val EXTRA_DURATION = "duration"

        /** True once the service is up, so a redraw never starts it by itself. */
        @Volatile private var running = false

        fun update(ctx: Context, playing: Boolean, title: String, artist: String, art: String, durationSec: Int) {
            val i = Intent(ctx, PlaybackService::class.java)
                .putExtra(EXTRA_TITLE, title)
                .putExtra(EXTRA_ARTIST, artist)
                .putExtra(EXTRA_ART, art)
                .putExtra(EXTRA_PLAYING, playing)
                .putExtra(EXTRA_DURATION, durationSec)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i)
            else ctx.startService(i)
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, PlaybackService::class.java))
        }

        /**
         * Draws the notification again after the language changes, keeping
         * the song it is already showing. Carries its own action for that
         * reason: an intent with no extras would reset the title, the artist
         * and the artwork on the way through.
         *
         * Does nothing when no song has been shown yet, since there is no
         * notification to redraw and starting one would put up an empty player.
         */
        fun refresh(ctx: Context) {
            if (!running) return
            val i = Intent(ctx, PlaybackService::class.java).setAction(ACTION_REFRESH)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i)
            else ctx.startService(i)
        }
    }
}

/** Lets the notification's buttons reach the WebView that is actually playing. */
object PlaybackCommands {
    @Volatile var handler: ((String) -> Unit)? = null
    fun send(cmd: String) { handler?.invoke(cmd) }
}
