package com.sitesourcery.responder.push

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.sitesourcery.responder.BuildConfig
import com.sitesourcery.responder.MainActivity
import com.sitesourcery.responder.R
import com.sitesourcery.responder.ResponderApplication
import com.twilio.voice.Voice

class ResponderFirebaseService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val application = application as ResponderApplication
        val container = application.container
        val notificationAllowed = Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        val microphoneAllowed = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.RECORD_AUDIO,
        ) == PackageManager.PERMISSION_GRANTED
        val permit = container.voiceRegistration.currentIncomingPermit()
        if (BuildConfig.PROVIDER_CONFIGURED &&
            notificationAllowed &&
            microphoneAllowed &&
            permit != null &&
            message.data.isNotEmpty() &&
            Voice.handleMessage(
                this,
                message.data,
                container.incomingCalls.listenerFor(permit),
            )) {
            return
        }
        showOpaqueActivity(message.data)
    }

    // Twilio Voice 6.10.4 still requires the FCM registration token. Keep this
    // deprecated Firebase callback isolated here until Twilio supports FID.
    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onNewToken(token: String) {
        (application as ResponderApplication).container.receiveFcmToken(token)
    }

    private fun showOpaqueActivity(data: Map<String, String>) {
        if (data.keys != setOf("schema", "interactionId", "eventKind")) return
        if (data["schema"] != "sitesourcery.responder-opaque-push/v1") return
        if (!UUID.matches(data["interactionId"].orEmpty())) return
        if (!EVENT.matches(data["eventKind"].orEmpty())) return
        createChannel()
        val contentIntent = PendingIntent.getActivity(
            this,
            20,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_responder)
            .setContentTitle("Responder activity")
            .setContentText("Open Site Sourcery to review new activity.")
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .build()
        if (Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED) {
            NotificationManagerCompat.from(this).notify(ACTIVITY_NOTIFICATION_ID, notification)
        }
    }

    private fun createChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                getString(R.string.activity_channel_name),
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = "Opaque Site Sourcery activity notices"
                lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
            }
        )
    }

    companion object {
        private const val CHANNEL_ID = "sitesourcery-responder-activity-v1"
        private const val ACTIVITY_NOTIFICATION_ID = 7414
        private val UUID = Regex(
            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
        )
        private val EVENT = Regex("^[a-z][a-z0-9_]{2,63}$")
    }
}
