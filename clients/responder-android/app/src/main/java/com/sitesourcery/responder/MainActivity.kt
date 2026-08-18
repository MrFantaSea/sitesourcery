package com.sitesourcery.responder

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.google.firebase.messaging.FirebaseMessaging
import com.sitesourcery.responder.ui.ResponderRoot
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    // This app uses ComponentActivity directly and has no Fragment dependency;
    // the Fragment-version lint check is inapplicable to this registry.
    @SuppressLint("InvalidFragmentVersionForActivityResult")
    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        refreshPermissionProjection()
        if (BuildConfig.PROVIDER_CONFIGURED && notificationGranted()) {
            @Suppress("DEPRECATION")
            FirebaseMessaging.getInstance().token.addOnSuccessListener {
                (application as ResponderApplication).container.receiveFcmToken(it)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val container = (application as ResponderApplication).container
        setContent {
            ResponderRoot(
                state = container.appState.state,
                actions = container.appState,
                requestPermissions = ::requestResponderPermissions,
                launch = { work -> lifecycleScope.launch { work() } },
            )
        }
        refreshPermissionProjection()
    }

    override fun onResume() {
        super.onResume()
        refreshPermissionProjection()
    }

    private fun requestResponderPermissions() {
        val permissions = buildList {
            add(Manifest.permission.RECORD_AUDIO)
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
            if (Build.VERSION.SDK_INT >= 31) add(Manifest.permission.BLUETOOTH_CONNECT)
        }
        permissionLauncher.launch(permissions.toTypedArray())
    }

    private fun refreshPermissionProjection() {
        val notificationAllowed = notificationGranted()
        val microphoneAllowed = microphoneGranted()
        val notification = if (notificationAllowed) {
            "authorized"
        } else {
            "not_authorized"
        }
        val microphone = if (microphoneAllowed) "authorized" else "not_authorized"
        val container = (application as ResponderApplication).container
        container.appState.updatePermissions(
            notification,
            microphone,
        )
        container.updateRuntimePermissions(notificationAllowed, microphoneAllowed)
    }

    private fun notificationGranted(): Boolean = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED

    private fun microphoneGranted(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
}
