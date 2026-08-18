package com.sitesourcery.responder.security

import com.sitesourcery.responder.MemorySecureValueStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceAuthorityStoreTest {
    @Test
    fun voiceAuthorityAndNativeScopeRoundTripExactly() {
        val memory = MemorySecureValueStore()
        val store = DeviceAuthorityStore(memory)
        val authority = voiceAuthority()
        store.saveVoiceRegistration(authority)
        assertEquals(authority, store.voiceRegistration())
        assertTrue(store.openVoiceIncomingGate(authority))
        assertEquals(authority, store.voiceIncomingGate())

        val scope = NativeInstallationScope(
            organizationId = ORGANIZATION,
            projectId = PROJECT,
            customerUserId = USER,
            installationId = INSTALLATION,
            installationKeyDigest = DIGEST_A,
            phase = NativeInstallationScopePhase.release_pending,
            releaseReason = "logout",
        )
        assertTrue(store.claimNativeInstallationScope(scope))
        assertEquals(scope, store.nativeInstallationScope())

        memory.inject(
            "sitesourcery.responder.voice-registration.v2.current",
            "corrupt",
        )
        assertThrows(IllegalArgumentException::class.java) { store.voiceRegistration() }
    }

    @Test
    fun voiceAttemptCasPreventsStaleOverwriteAndResolution() {
        val store = DeviceAuthorityStore(MemorySecureValueStore())
        val target = voiceAuthority()
        val first = VoiceProviderAttempt(
            id = ATTEMPT_ONE,
            kind = VoiceProviderAttemptKind.register,
            target = target,
            startedAt = "2030-01-01T00:00:00Z",
        )
        val second = VoiceProviderAttempt(
            id = ATTEMPT_TWO,
            kind = VoiceProviderAttemptKind.unregister,
            target = target.copy(
                installationRevision = 3,
                sessionId = SESSION_TWO,
                authorizationExpiresAt = "2030-01-01T00:10:00Z",
            ),
            startedAt = "2030-01-01T00:01:00Z",
        )
        assertTrue(store.recordVoiceAttempt(first))
        assertFalse(store.recordVoiceAttempt(first.copy(id = ATTEMPT_TWO)))
        assertFalse(store.replaceVoiceAttemptForCleanup(ATTEMPT_TWO, second))
        assertTrue(store.replaceVoiceAttemptForCleanup(ATTEMPT_ONE, second))
        assertFalse(store.resolveVoiceAttempt(ATTEMPT_ONE, true))
        assertEquals(second, store.voiceAttempt())
        assertTrue(store.resolveVoiceAttempt(ATTEMPT_TWO, true))
        assertNull(store.voiceAttempt())
        assertNull(store.voiceRegistration())
        assertNull(store.voiceIncomingGate())
    }

    private fun voiceAuthority() = VoiceProviderAuthority(
        organizationId = ORGANIZATION,
        projectId = PROJECT,
        customerUserId = USER,
        installationId = INSTALLATION,
        installationRevision = 2,
        appEnvironment = "sandbox",
        clientPlatform = "android",
        transport = "twilio_voice_android",
        fcmToken = "fcm-token-aaaaaaaaaaaaaaaaaaaa",
        sessionId = SESSION_ONE,
        identityDigest = DIGEST_A,
        credentialDigest = DIGEST_B,
        authorizationExpiresAt = "2030-01-01T00:05:00Z",
    )

    companion object {
        private const val ORGANIZATION = "10000000-0000-4000-8000-000000000001"
        private const val PROJECT = "20000000-0000-4000-8000-000000000001"
        private const val USER = "30000000-0000-4000-8000-000000000001"
        private const val INSTALLATION = "40000000-0000-4000-8000-000000000001"
        private const val SESSION_ONE = "50000000-0000-4000-8000-000000000001"
        private const val SESSION_TWO = "50000000-0000-4000-8000-000000000002"
        private const val ATTEMPT_ONE = "60000000-0000-4000-8000-000000000001"
        private const val ATTEMPT_TWO = "60000000-0000-4000-8000-000000000002"
        private val DIGEST_A = "a".repeat(64)
        private val DIGEST_B = "b".repeat(64)
    }
}
