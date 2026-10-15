package com.sitesourcery.responder.voice

import com.sitesourcery.responder.MemorySecureValueStore
import com.sitesourcery.responder.core.NativeAppEnvironment
import com.sitesourcery.responder.core.NativeInstallation
import com.sitesourcery.responder.core.NativeInstallationState
import com.sitesourcery.responder.core.NativePlatform
import com.sitesourcery.responder.core.NativePushPurpose
import com.sitesourcery.responder.core.NativePushRegistration
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
    fun transientRetryOpensOneExactPermitAndColdStartNeedsFreshRouting() = runTest {
        val memory = MemorySecureValueStore()
        val store = DeviceAuthorityStore(memory)
        val sdk = ScriptedVoiceSdk(
            VoiceSdkResult.Failure(31408),
            VoiceSdkResult.Success,
        )
        val coordinator = VoiceRegistrationCoordinator(
            providerConfigured = true,
            routingReady = { true },
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

        var routingReady = false
        val recovered = VoiceRegistrationCoordinator(
            providerConfigured = true,
            routingReady = { routingReady },
            authorityStore = store,
            sdk = ScriptedVoiceSdk(),
            mainDispatcher = StandardTestDispatcher(testScheduler),
            now = { NOW },
        )
        assertNull(recovered.currentIncomingPermit())
        assertEquals(VoiceRegistrationState.held, recovered.state)
        routingReady = true
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
            routingReady = { true },
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
            routingReady = { true },
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

    @Test
    fun missingRoutingNeverRegistersEvenWithProviderConfigured() = runTest {
        val sdk = ScriptedVoiceSdk()
        val coordinator = VoiceRegistrationCoordinator(
            providerConfigured = true,
            authorityStore = DeviceAuthorityStore(MemorySecureValueStore()),
            sdk = sdk,
            mainDispatcher = StandardTestDispatcher(testScheduler),
            now = { NOW },
        )
        coordinator.enable()
        assertFalse(coordinator.register(authorization()) { true })
        assertTrue(sdk.calls.isEmpty())
        assertNull(coordinator.currentIncomingPermit())
        assertEquals(VoiceRegistrationState.held, coordinator.state)
    }

    @Test
    fun routingLossInvalidatesPermitButStillUnregisters() = runTest {
        var routingReady = true
        val sdk = ScriptedVoiceSdk()
        val store = DeviceAuthorityStore(MemorySecureValueStore())
        val coordinator = VoiceRegistrationCoordinator(
            providerConfigured = true,
            authorityStore = store,
            routingReady = { routingReady },
            sdk = sdk,
            mainDispatcher = StandardTestDispatcher(testScheduler),
            now = { NOW },
        )
        coordinator.enable()
        assertTrue(coordinator.register(authorization()) { true })
        val permit = checkNotNull(coordinator.currentIncomingPermit())
        routingReady = false
        assertFalse(coordinator.isIncomingPermitCurrent(permit))
        assertNull(coordinator.currentIncomingPermit())
        assertEquals(VoiceRegistrationState.held, coordinator.state)
        assertTrue(coordinator.disable({ authorization() }))
        assertEquals(listOf("register", "unregister"), sdk.calls)
        assertNull(store.voiceRegistration())
        assertNull(store.voiceIncomingGate())
    }

    @Test
    fun routingLostDuringRegistrationCleansUpLateSuccess() = runTest {
        var routingReady = true
        val calls = mutableListOf<String>()
        val sdk = object : VoiceSdkPort {
            override fun register(accessToken: String, fcmToken: String, completion: (VoiceSdkResult) -> Unit) {
                calls += "register"
                routingReady = false
                completion(VoiceSdkResult.Success)
            }
            override fun unregister(accessToken: String, fcmToken: String, completion: (VoiceSdkResult) -> Unit) {
                calls += "unregister"
                completion(VoiceSdkResult.Success)
            }
        }
        val store = DeviceAuthorityStore(MemorySecureValueStore())
        val coordinator = VoiceRegistrationCoordinator(
            providerConfigured = true,
            authorityStore = store,
            routingReady = { routingReady },
            sdk = sdk,
            mainDispatcher = StandardTestDispatcher(testScheduler),
            now = { NOW },
        )
        coordinator.enable()
        assertFalse(coordinator.register(authorization()) { true })
        assertEquals(listOf("register", "unregister"), calls)
        assertNull(store.voiceRegistration())
        assertNull(coordinator.currentIncomingPermit())
    }

    @Test
    fun currentScopeReadbackRejectsRevocationRotationAndWrongActorBeforeAnswer() = runTest {
        for (changed in listOf(
            installation().copy(state = NativeInstallationState.revoked),
            installation().copy(state = NativeInstallationState.suspended),
            installation().copy(revision = 3),
            installation().copy(customerUserId = "30000000-0000-4000-8000-000000000002"),
            installation().copy(pushRegistrations = emptyList()),
            null,
        )) {
            val store = DeviceAuthorityStore(MemorySecureValueStore())
            val sdk = ScriptedVoiceSdk()
            val coordinator = VoiceRegistrationCoordinator(
                providerConfigured = true, authorityStore = store, routingReady = { true },
                sdk = sdk, mainDispatcher = StandardTestDispatcher(testScheduler), now = { NOW },
            )
            coordinator.enable()
            assertTrue(coordinator.register(authorization()) { true })
            val admitted = coordinator.confirmIncomingAuthority { scope ->
                assertEquals(VoiceRecoveryScope(ORGANIZATION, PROJECT, USER, INSTALLATION), scope)
                installation()
            }
            assertNotNull(admitted)
            assertNull(coordinator.confirmIncomingAuthority { changed })
            assertFalse(coordinator.isIncomingPermitCurrent(checkNotNull(admitted)))
            assertNull(store.voiceIncomingGate())
            assertEquals(listOf("register"), sdk.calls)
        }
    }

    @Test
    fun higherRevisionRegistersSeparatelyAndRetainsUnconfirmedOldCleanup() = runTest {
        val memory = MemorySecureValueStore()
        val store = DeviceAuthorityStore(memory)
        val sdk = ScriptedVoiceSdk()
        val coordinator = VoiceRegistrationCoordinator(
            providerConfigured = true, authorityStore = store, routingReady = { true },
            sdk = sdk, mainDispatcher = StandardTestDispatcher(testScheduler), now = { NOW },
        )
        coordinator.enable()
        assertTrue(coordinator.register(authorization()) { true })
        val oldPermit = checkNotNull(coordinator.currentIncomingPermit())
        val next = authorization().let { it.copy(
            installationRevision = 3,
            session = it.session.copy(installationRevision = 3, identityDigest = "c".repeat(64)),
        ) }
        assertTrue(coordinator.register(next) { true })
        assertEquals(listOf("register", "register"), sdk.calls)
        assertEquals(1, coordinator.pendingProviderCleanupCount())
        assertEquals(store.pendingVoiceCleanup(), DeviceAuthorityStore(memory).pendingVoiceCleanup())
        assertFalse(coordinator.isIncomingPermitCurrent(oldPermit))
        assertEquals(3, store.voiceRegistration()?.installationRevision)
        assertEquals("c".repeat(64), coordinator.currentIncomingPermit()?.authority?.identityDigest)
        assertTrue(coordinator.disable({ next }))
        assertEquals(listOf("register", "register", "unregister"), sdk.calls)
        assertEquals(1, coordinator.pendingProviderCleanupCount())
    }

    @Test
    fun anotherInstallationCannotSupersedeExistingProviderIdentity() = runTest {
        val store = DeviceAuthorityStore(MemorySecureValueStore())
        val sdk = ScriptedVoiceSdk()
        val coordinator = VoiceRegistrationCoordinator(
            providerConfigured = true, authorityStore = store, routingReady = { true },
            sdk = sdk, mainDispatcher = StandardTestDispatcher(testScheduler), now = { NOW },
        )
        coordinator.enable()
        assertTrue(coordinator.register(authorization()) { true })
        val wrong = authorization().let { it.copy(
            installationId = "40000000-0000-4000-8000-000000000002", installationRevision = 3,
            session = it.session.copy(installationId = "40000000-0000-4000-8000-000000000002",
                installationRevision = 3, identityDigest = "c".repeat(64)),
        ) }
        assertFalse(coordinator.register(wrong) { true })
        assertEquals(listOf("register"), sdk.calls)
        assertEquals(0, coordinator.pendingProviderCleanupCount())
        assertEquals(INSTALLATION, store.voiceRegistration()?.installationId)
    }

    private fun installation() = NativeInstallation(
        schema = "sitesourcery.responder-native-installation/v1", id = INSTALLATION,
        organizationId = ORGANIZATION, projectId = PROJECT, customerUserId = USER,
        platform = NativePlatform.android, bundleId = "com.sitesourcery.responder",
        appEnvironment = NativeAppEnvironment.sandbox, appVersion = "1.0.0", buildNumber = "1",
        installationKeyDigest = DIGEST_A, state = NativeInstallationState.active, revision = 2,
        createdAt = NOW.toString(), pushRegistrations = listOf(NativePushRegistration(
            purpose = NativePushPurpose.voip, tokenReferenceDigest = DIGEST_B,
            keyVersion = "fixture-v1", registeredAt = NOW.toString(), revision = 2, active = true,
        )), voipSessionState = "verified", providerEffects = false, pushDeliveryEffects = false,
        voiceCallEffects = false, carrierCommandEffects = false, messageSendEffects = false,
    )

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
