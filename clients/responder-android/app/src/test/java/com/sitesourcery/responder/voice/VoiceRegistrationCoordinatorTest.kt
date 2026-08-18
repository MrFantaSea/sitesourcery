package com.sitesourcery.responder.voice

import com.sitesourcery.responder.MemorySecureValueStore
import com.sitesourcery.responder.core.NativeAppEnvironment
import com.sitesourcery.responder.core.NativePlatform
import com.sitesourcery.responder.core.NativeVoiceSession
import com.sitesourcery.responder.nativeclient.VoiceAuthorization
import com.sitesourcery.responder.security.DeviceAuthorityStore
import java.time.Instant
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class VoiceRegistrationCoordinatorTest {
    @Test
    fun heldModeNeverCallsSdk() = runTest {
        val sdk = ScriptedVoiceSdk()
        val coordinator = VoiceRegistrationCoordinator(
            providerConfigured = false,
            authorityStore = DeviceAuthorityStore(MemorySecureValueStore()),
            sdk = sdk,
            mainDispatcher = StandardTestDispatcher(testScheduler),
            now = { NOW },
        )
        assertFalse(coordinator.register(authorization()) { true })
        assertTrue(coordinator.disable({ authorization() }))
        assertEquals(0, sdk.calls.size)
        assertNull(coordinator.currentIncomingPermit())
        assertEquals(VoiceRegistrationState.held, coordinator.state)
    }

    @Test
    fun transientRetryOpensOneExactPermitAndColdStartRecoversIt() = runTest {
        val memory = MemorySecureValueStore()
        val store = DeviceAuthorityStore(memory)
        val sdk = ScriptedVoiceSdk(
            VoiceSdkResult.Failure(31408),
            VoiceSdkResult.Success,
        )
        val coordinator = VoiceRegistrationCoordinator(
            providerConfigured = true,
            authorityStore = store,
            sdk = sdk,
            mainDispatcher = StandardTestDispatcher(testScheduler),
            now = { NOW },
        )
        coordinator.enable()
        assertTrue(coordinator.register(authorization()) { true })
        assertEquals(listOf("register", "register"), sdk.calls)
        val firstPermit = coordinator.currentIncomingPermit()
        assertNotNull(firstPermit)
        assertEquals(store.voiceRegistration(), store.voiceIncomingGate())

        val recovered = VoiceRegistrationCoordinator(
            providerConfigured = true,
            authorityStore = store,
            sdk = ScriptedVoiceSdk(),
            mainDispatcher = StandardTestDispatcher(testScheduler),
            now = { NOW },
        )
        val coldPermit = recovered.currentIncomingPermit()
        assertNotNull(coldPermit)
        assertTrue(recovered.isIncomingPermitCurrent(checkNotNull(coldPermit)))
        recovered.closeIncomingGate()
        assertFalse(recovered.isIncomingPermitCurrent(checkNotNull(coldPermit)))
        assertNull(store.voiceIncomingGate())
    }

    @Test
    fun timeoutLateSuccessNeverReopensIncomingAndRequiresCleanup() = runTest {
        val memory = MemorySecureValueStore()
        val store = DeviceAuthorityStore(memory)
        val sdk = ScriptedVoiceSdk(delayFirst = true)
        val coordinator = VoiceRegistrationCoordinator(
            providerConfigured = true,
            authorityStore = store,
            sdk = sdk,
            mainDispatcher = StandardTestDispatcher(testScheduler),
            now = { NOW },
            providerTimeoutMs = 50,
        )
        coordinator.enable()
        assertFalse(coordinator.register(authorization()) { true })
        assertNotNull(store.voiceAttempt())
        assertNull(coordinator.currentIncomingPermit())
        sdk.completeDelayed(VoiceSdkResult.Success)
        assertNotNull(store.voiceRegistration())
        assertNull(store.voiceIncomingGate())

        val cleanupSdk = ScriptedVoiceSdk(VoiceSdkResult.Success)
        val restarted = VoiceRegistrationCoordinator(
            providerConfigured = true,
            authorityStore = store,
            sdk = cleanupSdk,
            mainDispatcher = StandardTestDispatcher(testScheduler),
            now = { NOW },
        )
        assertTrue(restarted.disable({ authorization() }))
        assertEquals(listOf("unregister"), cleanupSdk.calls)
        assertNull(store.voiceAttempt())
        assertNull(store.voiceRegistration())
        assertNull(restarted.currentIncomingPermit())
    }

    private fun authorization() = VoiceAuthorization(
        session = NativeVoiceSession(
            schema = "sitesourcery.responder-native-voice-session/v1",
            sessionId = SESSION,
            commandId = "android.voice.11111111111111111111111111111111",
            requestDigest = DIGEST_A,
            replayed = false,
            semanticReplay = false,
            installationId = INSTALLATION,
            installationRevision = 2,
            organizationId = ORGANIZATION,
            projectId = PROJECT,
            customerUserId = USER,
            appEnvironment = NativeAppEnvironment.sandbox,
            provider = "twilio",
            clientPlatform = NativePlatform.android,
            transport = "twilio_voice_android",
            identityDigest = DIGEST_A,
            credentialDigest = DIGEST_B,
            accessToken = "x".repeat(64),
            issuedAt = NOW.toString(),
            expiresAt = NOW.plusSeconds(300).toString(),
            incomingAllowed = true,
            outgoingAllowed = false,
            providerAuthorizationEffects = true,
            providerEffects = false,
            pushDeliveryEffects = false,
            voiceCallEffects = false,
            carrierCommandEffects = false,
            messageSendEffects = false,
        ),
        fcmToken = "fcm-token-aaaaaaaaaaaaaaaaaaaa",
        generation = 1,
        organizationId = ORGANIZATION,
        projectId = PROJECT,
        customerUserId = USER,
        installationId = INSTALLATION,
        installationRevision = 2,
        appEnvironment = NativeAppEnvironment.sandbox,
    )

    private class ScriptedVoiceSdk(
        vararg selectedResults: VoiceSdkResult,
        private val delayFirst: Boolean = false,
    ) : VoiceSdkPort {
        val calls = mutableListOf<String>()
        private val results = ArrayDeque(selectedResults.toList())
        private var delayed: ((VoiceSdkResult) -> Unit)? = null

        override fun register(
            accessToken: String,
            fcmToken: String,
            completion: (VoiceSdkResult) -> Unit,
        ) {
            calls += "register"
            if (delayFirst && delayed == null) delayed = completion else completion(next())
        }

        override fun unregister(
            accessToken: String,
            fcmToken: String,
            completion: (VoiceSdkResult) -> Unit,
        ) {
            calls += "unregister"
            completion(next())
        }

        fun completeDelayed(result: VoiceSdkResult) {
            checkNotNull(delayed).also { delayed = null }.invoke(result)
        }

        private fun next(): VoiceSdkResult =
            if (results.isEmpty()) VoiceSdkResult.Success else results.removeFirst()
    }

    companion object {
        private val NOW = Instant.parse("2030-01-01T00:00:00Z")
        private const val ORGANIZATION = "10000000-0000-4000-8000-000000000001"
        private const val PROJECT = "20000000-0000-4000-8000-000000000001"
        private const val USER = "30000000-0000-4000-8000-000000000001"
        private const val INSTALLATION = "40000000-0000-4000-8000-000000000001"
        private const val SESSION = "50000000-0000-4000-8000-000000000001"
        private val DIGEST_A = "a".repeat(64)
        private val DIGEST_B = "b".repeat(64)
    }
}
