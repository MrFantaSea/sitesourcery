package com.sitesourcery.responder.voice

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import com.sitesourcery.responder.MainActivity
import com.sitesourcery.responder.R
import com.sitesourcery.responder.ResponderApplication

class ResponderCallService : Service() {
    private val displayedCall = DisplayedCallAuthority()

    override fun onCreate() {
        super.onCreate()
        createChannel(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val application = application as ResponderApplication
        val generation = intent?.getStringExtra(EXTRA_GENERATION)
        when (intent?.action) {
            ACTION_SHOW -> {
                val ongoing = intent.getBooleanExtra(EXTRA_ONGOING, false)
                if (generation == null ||
                    !application.container.incomingCalls.canPresent(generation, ongoing)) {
                    if (displayedCall.isEmpty()) stopSelf(startId)
                    return START_NOT_STICKY
                }
                displayedCall.display(generation)
                startCallForeground(this, ongoing, generation)
            }
            ACTION_ANSWER -> generation?.let(application.container.incomingCalls::answer)
            ACTION_DECLINE -> generation?.let(application.container.incomingCalls::decline)
            ACTION_END -> generation?.let(application.container.incomingCalls::end)
            ACTION_STOP -> {
                if (generation != null && displayedCall.stop(generation)) {
                    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
                    NotificationManagerCompat.from(this).cancel(NOTIFICATION_ID)
                    stopSelf(startId)
                }
            }
            else -> if (displayedCall.isEmpty()) stopSelf(startId)
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL_ID = "sitesourcery-responder-calls-v1"
        private const val NOTIFICATION_ID = 7413
        private const val ACTION_SHOW = "com.sitesourcery.responder.call.SHOW"
        private const val ACTION_ANSWER = "com.sitesourcery.responder.call.ANSWER"
        private const val ACTION_DECLINE = "com.sitesourcery.responder.call.DECLINE"
        private const val ACTION_END = "com.sitesourcery.responder.call.END"
        private const val ACTION_STOP = "com.sitesourcery.responder.call.STOP"
        private const val EXTRA_ONGOING = "ongoing"
        private const val EXTRA_GENERATION = "generation"

        fun showIncoming(context: Context, generation: String) =
            start(context, ongoing = false, generation)

        fun showOngoing(context: Context, generation: String) =
            start(context, ongoing = true, generation)

        fun stop(context: Context, generation: String) {
            runCatching {
                context.startService(
                    Intent(context, ResponderCallService::class.java)
                        .setAction(ACTION_STOP)
                        .setData("sitesourcery://responder/call/$generation/stop".toUri())
                        .putExtra(EXTRA_GENERATION, generation)
                )
            }
        }

        private fun start(context: Context, ongoing: Boolean, generation: String) {
            val intent = Intent(context, ResponderCallService::class.java)
                .setAction(ACTION_SHOW)
                .setData(
                    (
                        "sitesourcery://responder/call/$generation/" +
                            if (ongoing) "ongoing" else "incoming"
                        ).toUri()
                )
                .putExtra(EXTRA_ONGOING, ongoing)
                .putExtra(EXTRA_GENERATION, generation)
            ContextCompat.startForegroundService(context, intent)
        }

        private fun startCallForeground(
            service: Service,
            ongoing: Boolean,
            generation: String,
        ) {
            val person = Person.Builder()
                .setName(service.getString(R.string.incoming_call))
                .setImportant(true)
                .build()
            val content = PendingIntent.getActivity(
                service,
                10,
                Intent(service, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val decline = serviceIntent(
                service,
                if (ongoing) ACTION_END else ACTION_DECLINE,
                generation,
                11,
            )
            val answer = serviceIntent(service, ACTION_ANSWER, generation, 12)
            val style = if (ongoing) {
                NotificationCompat.CallStyle.forOngoingCall(person, decline)
            } else {
                NotificationCompat.CallStyle.forIncomingCall(person, decline, answer)
            }
            val notification = NotificationCompat.Builder(service, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_responder)
                .setContentTitle(service.getString(R.string.incoming_call))
                .setContentText(if (ongoing) "Call in progress" else "Incoming business call")
                .setContentIntent(content)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(ongoing)
                .setStyle(style)
                .build()
            val foregroundType = if (Build.VERSION.SDK_INT >= 29) {
                var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
                if (ongoing && Build.VERSION.SDK_INT >= 30) {
                    type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                }
                type
            } else {
                0
            }
            ServiceCompat.startForeground(
                service,
                NOTIFICATION_ID,
                notification,
                foregroundType,
            )
        }

        private fun serviceIntent(
            context: Context,
            action: String,
            generation: String,
            actionCode: Int,
        ): PendingIntent = PendingIntent.getService(
            context,
            actionCode,
            Intent(context, ResponderCallService::class.java)
                .setAction(action)
                .setData(
                    "sitesourcery://responder/call/$generation/$actionCode".toUri()
                )
                .putExtra(EXTRA_GENERATION, generation),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        private fun createChannel(context: Context) {
            val manager = context.getSystemService(NotificationManager::class.java)
            val channel = NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.call_channel_name),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Incoming and active Site Sourcery business calls"
                setShowBadge(false)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            }
            manager.createNotificationChannel(channel)
        }
    }
}
