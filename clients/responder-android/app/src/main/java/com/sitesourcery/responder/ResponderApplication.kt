package com.sitesourcery.responder

import android.app.Application
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.sitesourcery.responder.app.ResponderAppState
import com.sitesourcery.responder.core.CommandLedger
import com.sitesourcery.responder.core.NativeAppEnvironment
import com.sitesourcery.responder.nativeclient.NativeClientBuild
import com.sitesourcery.responder.nativeclient.NativeRegistrationCoordinator
import com.sitesourcery.responder.network.ResponderApi
import com.sitesourcery.responder.network.ApiException
import com.sitesourcery.responder.security.DeviceAuthorityStore
import com.sitesourcery.responder.security.KeystoreValueStore
import com.sitesourcery.responder.voice.IncomingCallController
import com.sitesourcery.responder.voice.VoiceRegistrationCoordinator
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class ResponderApplication : Application() {
    lateinit var container: ResponderContainer
        private set

    override fun onCreate() {
        super.onCreate()
        initializeFirebaseIfReleased()
        container = ResponderContainer(this)
        container.launch()
    }

    private fun initializeFirebaseIfReleased() {
        if (!BuildConfig.PROVIDER_CONFIGURED) return
        require(
            BuildConfig.FIREBASE_APPLICATION_ID.isNotBlank() &&
                BuildConfig.FIREBASE_API_KEY.isNotBlank() &&
                BuildConfig.FIREBASE_PROJECT_ID.isNotBlank() &&
                BuildConfig.FIREBASE_SENDER_ID.matches(Regex("^[0-9]{6,32}$"))
        ) { "Released Firebase configuration is incomplete." }
        if (FirebaseApp.getApps(this).isEmpty()) {
            FirebaseApp.initializeApp(
                this,
                FirebaseOptions.Builder()
                    .setApplicationId(BuildConfig.FIREBASE_APPLICATION_ID)
                    .setApiKey(BuildConfig.FIREBASE_API_KEY)
                    .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                    .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                    .build(),
                "[DEFAULT]",
            )
        }
        FirebaseMessaging.getInstance().isAutoInitEnabled = true
    }
}

class ResponderContainer(application: Application) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val secureStore = KeystoreValueStore(application)
    private val authorityStore = DeviceAuthorityStore(secureStore)
    private val commandLedger = CommandLedger(secureStore)
    val api = ResponderApi(BuildConfig.API_ORIGIN, authorityStore)
    val nativeRegistration = NativeRegistrationCoordinator(
        api = api,
        build = NativeClientBuild(
            environment = if (BuildConfig.DEBUG) {
                NativeAppEnvironment.sandbox
            } else {
                NativeAppEnvironment.production
            },
            appVersion = BuildConfig.VERSION_NAME.substringBefore('-'),
            buildNumber = BuildConfig.VERSION_CODE.toString(),
        ),
        authorityStore = authorityStore,
        commandLedger = commandLedger,
    )
    val voiceRegistration = VoiceRegistrationCoordinator(
        providerConfigured = BuildConfig.PROVIDER_CONFIGURED,
        authorityStore = authorityStore,
    )
    val incomingCalls = IncomingCallController(
        application,
        voiceRegistration::isIncomingPermitCurrent,
    )
    @Volatile private var notificationGranted = false
    @Volatile private var microphoneGranted = false
    private val permissionLane = Mutex()
    private val permissionGeneration = AtomicLong(0)
    val appState = ResponderAppState(
        api = api,
        commandLedger = commandLedger,
        nativeRegistration = nativeRegistration,
        prepareVoice = ::prepareVoice,
        disableVoice = ::disableVoice,
        enableVoice = ::enableVoice,
        voiceState = { voiceRegistration.state },
        voiceRecoveryScope = voiceRegistration::recoveryScope,
    )

    fun launch() {
        scope.launch { appState.launch() }
    }

    fun receiveFcmToken(token: String) {
        if (!BuildConfig.PROVIDER_CONFIGURED) return
        scope.launch {
            permissionLane.withLock {
                try {
                    voiceRegistration.closeIncomingGate()
                    incomingCalls.quiesce()
                    nativeRegistration.receiveFcmToken(token)?.let(appState::acceptNativeUpdate)
                    prepareVoice()
                } catch (error: Throwable) {
                    appState.acceptBackgroundFailure(error)
                }
            }
        }
    }

    fun updateRuntimePermissions(notification: Boolean, microphone: Boolean) {
        notificationGranted = notification
        microphoneGranted = microphone
        val generation = permissionGeneration.incrementAndGet()
        if (!notification || !microphone) voiceRegistration.closeIncomingGate()
        if (!BuildConfig.PROVIDER_CONFIGURED) return
        scope.launch {
            permissionLane.withLock {
                if (!notification || !microphone) incomingCalls.quiesce()
                if (generation != permissionGeneration.get()) return@withLock
                try {
                    val currentNotification = notificationGranted
                    val currentMicrophone = microphoneGranted
                    val voiceAllowed = currentNotification && currentMicrophone &&
                        voiceRegistration.isExplicitlyEnabled()
                    if (!voiceAllowed && voiceRegistration.hasRegistration() &&
                        !disableVoice(
                            persistExplicitDisable = false,
                            retireNativeVoip = false,
                        )) {
                        throw ApiException(
                            "VOICE_DEREGISTRATION_REQUIRED",
                            "Responder could not confirm Voice deregistration after permission changed.",
                            409,
                        )
                    }
                    if (generation != permissionGeneration.get()) return@withLock
                    val installation = nativeRegistration.updatePurposeAuthority(
                        currentNotification,
                        voiceAllowed,
                    )
                    installation?.let(appState::acceptNativeUpdate)
                    if (generation == permissionGeneration.get()) prepareVoice()
                } catch (error: Throwable) {
                    appState.acceptBackgroundFailure(error)
                }
            }
        }
    }

    suspend fun prepareVoice(): Boolean {
        val generation = permissionGeneration.get()
        val notification = notificationGranted
        val microphone = microphoneGranted
        if (!BuildConfig.PROVIDER_CONFIGURED || !notification || !microphone ||
            !voiceRegistration.isExplicitlyEnabled()) {
            appState.refreshVoiceState()
            return false
        }
        val authorization = nativeRegistration.requestVoiceAuthorization() ?: return false
        val result = voiceRegistration.register(authorization) {
            generation == permissionGeneration.get() &&
                notificationGranted && microphoneGranted &&
                nativeRegistration.isCurrent(authorization)
        }
        appState.refreshVoiceState()
        return result
    }

    private suspend fun disableVoice(
        persistExplicitDisable: Boolean = true,
        retireNativeVoip: Boolean = true,
    ): Boolean {
        val result = voiceRegistration.disable(
            freshAuthorization = {
                if (BuildConfig.PROVIDER_CONFIGURED) {
                    nativeRegistration.requestVoiceAuthorization()
                } else {
                    null
                }
            },
            persistExplicitDisable,
            incomingCalls::quiesce,
        )
        if (result && retireNativeVoip) {
            nativeRegistration.updatePurposeAuthority(
                notificationEnabled = notificationGranted,
                voipEnabled = false,
            )?.let(appState::acceptNativeUpdate)
        }
        appState.refreshVoiceState()
        return result
    }

    private suspend fun enableVoice() {
        permissionLane.withLock {
            if (!notificationGranted || !microphoneGranted) {
                throw ApiException(
                    "RESPONDER_DEVICE_PERMISSIONS_REQUIRED",
                    "Allow notifications and microphone access before enabling incoming Voice.",
                    409,
                )
            }
            voiceRegistration.enable()
            nativeRegistration.updatePurposeAuthority(
                notificationEnabled = true,
                voipEnabled = true,
            )?.let(appState::acceptNativeUpdate)
        }
    }
}
