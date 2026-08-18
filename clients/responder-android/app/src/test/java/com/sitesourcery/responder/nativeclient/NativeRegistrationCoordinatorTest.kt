package com.sitesourcery.responder.nativeclient

import com.sitesourcery.responder.MemorySecureValueStore
import com.sitesourcery.responder.core.CommandLedger
import com.sitesourcery.responder.core.NativeAppEnvironment
import com.sitesourcery.responder.core.NativeCommandReceipt
import com.sitesourcery.responder.core.NativeInstallation
import com.sitesourcery.responder.core.NativeInstallationList
import com.sitesourcery.responder.core.NativeInstallationState
import com.sitesourcery.responder.core.NativePlatform
import com.sitesourcery.responder.core.NativePushPurpose
import com.sitesourcery.responder.core.NativePushRegistration
import com.sitesourcery.responder.core.NativeVoiceSession
import com.sitesourcery.responder.core.ResponderDigest
import com.sitesourcery.responder.network.NativeClientApi
import com.sitesourcery.responder.network.ApiException
import com.sitesourcery.responder.security.DeviceAuthorityStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class NativeRegistrationCoordinatorTest {
    @Test
    fun concurrentFcmCallbacksDrainInOneRevisionOrderedLane() = runTest {
        val harness = Harness()
        harness.coordinator.establish(PROJECT, ORGANIZATION, USER)
        harness.coordinator.updatePurposeAuthority(notificationEnabled = true, voipEnabled = true)

        harness.api.blockNextRegistration()
        val first = async { harness.coordinator.receiveFcmToken(TOKEN_A) }
        harness.api.awaitBlockedRegistration()
        val second = async { harness.coordinator.receiveFcmToken(TOKEN_B) }
        runCurrent()
        assertFalse(second.isCompleted)

        harness.api.releaseBlockedRegistration()
        first.await()
        val final = checkNotNull(second.await())

        assertEquals(
            listOf(
                RegisterCall(NativePushPurpose.notification, TOKEN_A, 1),
                RegisterCall(NativePushPurpose.voip, TOKEN_A, 2),
                RegisterCall(NativePushPurpose.notification, TOKEN_B, 3),
                RegisterCall(NativePushPurpose.voip, TOKEN_B, 4),
            ),
            harness.api.registerCalls,
        )
        assertEquals(1, harness.api.maximumConcurrentMutations)
        assertEquals(5, final.revision)
        assertEquals(setOf(NativePushPurpose.notification, NativePushPurpose.voip),
            final.pushRegistrations.map { it.purpose }.toSet())
        NativePushPurpose.entries.forEach { purpose ->
            assertEquals(
                ResponderDigest.sha256(TOKEN_B),
                harness.store.registeredTokenFingerprint(PROJECT, purpose.name),
            )
        }
    }

    @Test
    fun coldStartRetirementReconcilesBeforeRegistrationAndSurvivesRotation() = runTest {
        val harness = Harness()
        harness.coordinator.establish(PROJECT, ORGANIZATION, USER)
        harness.coordinator.updatePurposeAuthority(notificationEnabled = true, voipEnabled = true)
        val both = checkNotNull(harness.coordinator.receiveFcmToken(TOKEN_A))
        assertEquals(3, both.revision)

        val permissionCallbackBeforeRecovery = harness.newCoordinator()
        assertNull(
            permissionCallbackBeforeRecovery.updatePurposeAuthority(
                notificationEnabled = true,
                voipEnabled = false,
            ),
        )
        assertTrue(harness.store.hasGlobalRetirement(NativePushPurpose.voip.name))

        val recovered = harness.newCoordinator()
        val retired = recovered.establish(PROJECT, ORGANIZATION, USER)
        assertEquals(4, retired.revision)
        assertEquals(
            listOf(RetireCall(NativePushPurpose.voip, 3)),
            harness.api.retireCalls,
        )
        assertEquals(
            listOf(NativePushPurpose.notification),
            retired.pushRegistrations.map { it.purpose },
        )
        assertFalse(harness.store.hasGlobalRetirement(NativePushPurpose.voip.name))
        assertNull(harness.store.registeredTokenFingerprint(PROJECT, NativePushPurpose.voip.name))

        val rotated = checkNotNull(recovered.receiveFcmToken(TOKEN_B))
        assertEquals(5, rotated.revision)
        assertEquals(NativePushPurpose.notification, harness.api.registerCalls.last().purpose)
        assertEquals(TOKEN_B, harness.api.registerCalls.last().token)
        assertEquals(
            ResponderDigest.sha256(TOKEN_B),
            harness.store.registeredTokenFingerprint(PROJECT, NativePushPurpose.notification.name),
        )
        assertNull(harness.store.registeredTokenFingerprint(PROJECT, NativePushPurpose.voip.name))

        val noPush = checkNotNull(recovered.retireFcmAuthority())
        assertEquals(6, noPush.revision)
        assertTrue(noPush.pushRegistrations.isEmpty())
        assertNull(harness.store.fcmToken())
    }

    @Test
    fun invalidationQueuesBehindInFlightRegistrationThenRetiresExactResult() = runTest {
        val harness = Harness()
        harness.coordinator.establish(PROJECT, ORGANIZATION, USER)
        harness.coordinator.updatePurposeAuthority(notificationEnabled = true, voipEnabled = true)

        harness.api.blockNextRegistration()
        val registering = async { harness.coordinator.receiveFcmToken(TOKEN_A) }
        harness.api.awaitBlockedRegistration()
        val invalidating = async {
            harness.coordinator.updatePurposeAuthority(
                notificationEnabled = false,
                voipEnabled = false,
            )
        }
        runCurrent()
        assertFalse(invalidating.isCompleted)

        harness.api.releaseBlockedRegistration()
        registering.await()
        val final = checkNotNull(invalidating.await())
        assertEquals(
            listOf(
                RegisterCall(NativePushPurpose.notification, TOKEN_A, 1),
                RegisterCall(NativePushPurpose.voip, TOKEN_A, 2),
            ),
            harness.api.registerCalls,
        )
        assertEquals(
            listOf(
                RetireCall(NativePushPurpose.notification, 3),
                RetireCall(NativePushPurpose.voip, 4),
            ),
            harness.api.retireCalls,
        )
        assertEquals(5, final.revision)
        assertTrue(final.pushRegistrations.isEmpty())
        NativePushPurpose.entries.forEach { purpose ->
            assertFalse(harness.store.pushPurposeEnabled(purpose.name))
            assertNull(harness.store.registeredTokenFingerprint(PROJECT, purpose.name))
        }
        assertEquals(1, harness.api.maximumConcurrentMutations)
    }

    @Test
    fun expiredVoiceReplayRenewsOnlyItsDurableCommandAndRecovers() = runTest {
        val harness = Harness()
        harness.coordinator.establish(PROJECT, ORGANIZATION, USER)
        harness.coordinator.updatePurposeAuthority(notificationEnabled = true, voipEnabled = true)
        harness.coordinator.receiveFcmToken(TOKEN_A)
        harness.api.expireNextVoiceRequest = true

        val authorization = harness.coordinator.requestVoiceAuthorization()
        assertNotNull(authorization)
        assertEquals(2, harness.api.voiceCommandIds.size)
        assertNotEquals(harness.api.voiceCommandIds[0], harness.api.voiceCommandIds[1])
        assertEquals(INSTALLATION, authorization?.installationId)
        assertEquals(TOKEN_A, authorization?.fcmToken)
    }

    @Test
    fun explicitVoiceDisableSurvivesImmediateLogoutAndResume() = runTest {
        val harness = Harness()
        harness.coordinator.establish(PROJECT, ORGANIZATION, USER)
        harness.coordinator.updatePurposeAuthority(notificationEnabled = true, voipEnabled = true)
        harness.coordinator.receiveFcmToken(TOKEN_A)

        val disabled = checkNotNull(
            harness.coordinator.updatePurposeAuthority(
                notificationEnabled = true,
                voipEnabled = false,
            ),
        )
        assertEquals(listOf(NativePushPurpose.notification), disabled.pushRegistrations.map {
            it.purpose
        })
        harness.coordinator.suspendForLogout()
        harness.coordinator.resetSession()

        val resumed = harness.newCoordinator().establish(PROJECT, ORGANIZATION, USER)
        assertEquals(NativeInstallationState.active, resumed.state)
        assertEquals(listOf(NativePushPurpose.notification), resumed.pushRegistrations.map {
            it.purpose
        })
        assertFalse(harness.store.pushPurposeEnabled(NativePushPurpose.voip.name))
        assertEquals(
            1,
            harness.api.registerCalls.count { it.purpose == NativePushPurpose.voip },
        )
    }

    private class Harness {
        private val memory = MemorySecureValueStore()
        val store = DeviceAuthorityStore(memory)
        val api = StatefulNativeApi()
        val coordinator = newCoordinator()

        fun newCoordinator() = NativeRegistrationCoordinator(
            api = api,
            build = NativeClientBuild(NativeAppEnvironment.sandbox, "1.0.0", "1"),
            authorityStore = store,
            commandLedger = CommandLedger(memory),
        )
    }

    private data class RegisterCall(
        val purpose: NativePushPurpose,
        val token: String,
        val expectedRevision: Int,
    )

    private data class RetireCall(
        val purpose: NativePushPurpose,
        val expectedRevision: Int,
    )

    private class StatefulNativeApi : NativeClientApi {
        var current: NativeInstallation? = null
        val registerCalls = mutableListOf<RegisterCall>()
        val retireCalls = mutableListOf<RetireCall>()
        val voiceCommandIds = mutableListOf<String>()
        var expireNextVoiceRequest = false
        var maximumConcurrentMutations = 0
            private set
        private var activeMutations = 0
        private var blockNext = false
        private var blocked = CompletableDeferred<Unit>()
        private var release = CompletableDeferred<Unit>()

        fun blockNextRegistration() {
            blockNext = true
            blocked = CompletableDeferred()
            release = CompletableDeferred()
        }

        suspend fun awaitBlockedRegistration() = blocked.await()

        fun releaseBlockedRegistration() = release.complete(Unit)

        override suspend fun nativeInstallations(projectId: String): NativeInstallationList =
            NativeInstallationList(
                schema = "sitesourcery.responder-native-installation-list/v1",
                organizationId = ORGANIZATION,
                projectId = projectId,
                installations = listOfNotNull(current).filter { it.projectId == projectId },
                voipSessionState = "held",
                providerEffects = false,
                pushDeliveryEffects = false,
                voiceCallEffects = false,
                carrierCommandEffects = false,
                messageSendEffects = false,
            )

        override suspend fun createNativeInstallation(
            projectId: String,
            environment: NativeAppEnvironment,
            appVersion: String,
            buildNumber: String,
            installationKeyDigest: String,
            idempotencyKey: String,
        ): NativeCommandReceipt {
            check(current == null)
            current = installation(
                projectId = projectId,
                environment = environment,
                appVersion = appVersion,
                buildNumber = buildNumber,
                installationKeyDigest = installationKeyDigest,
            )
            return receipt("create_installation", idempotencyKey, checkNotNull(current))
        }

        override suspend fun registerPushToken(
            projectId: String,
            installationId: String,
            expectedRevision: Int,
            purpose: NativePushPurpose,
            token: String,
            idempotencyKey: String,
        ): NativeCommandReceipt = mutation {
            val prior = exact(projectId, installationId, expectedRevision)
            registerCalls += RegisterCall(purpose, token, expectedRevision)
            if (blockNext) {
                blockNext = false
                blocked.complete(Unit)
                release.await()
            }
            val revision = prior.revision + 1
            val registrations = prior.pushRegistrations.filterNot { it.purpose == purpose } +
                NativePushRegistration(
                    purpose = purpose,
                    tokenReferenceDigest = ResponderDigest.sha256("reference:${purpose.name}:$token"),
                    keyVersion = "v1",
                    registeredAt = NOW,
                    revision = revision,
                    active = true,
                )
            current = prior.copy(revision = revision, pushRegistrations = registrations)
            receipt(
                operation = "register_token",
                commandId = idempotencyKey,
                installation = checkNotNull(current),
                tokenReceiptDigest = ResponderDigest.nativeTokenReceipt(prior, purpose, token),
            )
        }

        override suspend fun retirePushToken(
            projectId: String,
            installationId: String,
            expectedRevision: Int,
            purpose: NativePushPurpose,
            evidenceDigest: String,
            idempotencyKey: String,
        ): NativeCommandReceipt = mutation {
            val prior = exact(projectId, installationId, expectedRevision)
            check(evidenceDigest == ResponderDigest.nativeTokenRetirement(
                installationId,
                expectedRevision,
                purpose,
            ))
            retireCalls += RetireCall(purpose, expectedRevision)
            current = prior.copy(
                revision = prior.revision + 1,
                pushRegistrations = prior.pushRegistrations.filterNot { it.purpose == purpose },
            )
            receipt("retire_token", idempotencyKey, checkNotNull(current))
        }

        override suspend fun suspendNativeInstallation(
            projectId: String,
            installationId: String,
            expectedRevision: Int,
            evidenceDigest: String,
            idempotencyKey: String,
        ): NativeCommandReceipt = mutation {
            val prior = exact(projectId, installationId, expectedRevision)
            current = prior.copy(
                state = NativeInstallationState.suspended,
                revision = prior.revision + 1,
                suspendedAt = NOW,
                suspendedReason = "logout",
                pushRegistrations = prior.pushRegistrations.map { it.copy(active = false) },
            )
            receipt("suspend", idempotencyKey, checkNotNull(current))
        }

        override suspend fun revokeNativeInstallation(
            projectId: String,
            installationId: String,
            expectedRevision: Int,
            reason: String,
            evidenceDigest: String,
            idempotencyKey: String,
        ): NativeCommandReceipt = mutation {
            val prior = exact(projectId, installationId, expectedRevision)
            current = prior.copy(
                state = NativeInstallationState.revoked,
                revision = prior.revision + 1,
                revokedAt = NOW,
                revokedReason = reason,
                pushRegistrations = prior.pushRegistrations.map { it.copy(active = false) },
            )
            receipt("revoke", idempotencyKey, checkNotNull(current))
        }

        override suspend fun resumeNativeInstallation(
            projectId: String,
            installationId: String,
            expectedRevision: Int,
            evidenceDigest: String,
            idempotencyKey: String,
        ): NativeCommandReceipt = mutation {
            val prior = exact(projectId, installationId, expectedRevision)
            current = prior.copy(
                state = NativeInstallationState.active,
                revision = prior.revision + 1,
                suspendedAt = null,
                suspendedReason = null,
                pushRegistrations = prior.pushRegistrations.map { it.copy(active = true) },
            )
            receipt("resume", idempotencyKey, checkNotNull(current))
        }

        override suspend fun requestVoipSession(
            projectId: String,
            installationId: String,
            expectedRevision: Int,
            idempotencyKey: String,
        ): NativeVoiceSession {
            val selected = exact(projectId, installationId, expectedRevision)
            voiceCommandIds += idempotencyKey
            if (expireNextVoiceRequest) {
                expireNextVoiceRequest = false
                throw ApiException(
                    "RESPONDER_NATIVE_VOIP_SESSION_EXPIRED",
                    "The prior native VoIP session expired; use a new idempotency key.",
                    409,
                )
            }
            return NativeVoiceSession(
                schema = "sitesourcery.responder-native-voice-session/v1",
                sessionId = VOICE_SESSION,
                commandId = idempotencyKey,
                requestDigest = ResponderDigest.sha256("voice:$idempotencyKey"),
                replayed = false,
                semanticReplay = false,
                installationId = selected.id,
                installationRevision = selected.revision,
                organizationId = selected.organizationId,
                projectId = selected.projectId,
                customerUserId = selected.customerUserId,
                appEnvironment = selected.appEnvironment,
                provider = "twilio",
                clientPlatform = NativePlatform.android,
                transport = "twilio_voice_android",
                identityDigest = ResponderDigest.sha256("voice-identity"),
                credentialDigest = ResponderDigest.sha256("voice-credential"),
                accessToken = "voice-access-token-".padEnd(64, 'x'),
                issuedAt = NOW,
                expiresAt = "2030-01-01T00:05:00Z",
                incomingAllowed = true,
                outgoingAllowed = false,
                providerAuthorizationEffects = true,
                providerEffects = false,
                pushDeliveryEffects = false,
                voiceCallEffects = false,
                carrierCommandEffects = false,
                messageSendEffects = false,
            )
        }

        private suspend fun <T> mutation(block: suspend () -> T): T {
            activeMutations += 1
            maximumConcurrentMutations = maxOf(maximumConcurrentMutations, activeMutations)
            return try {
                block()
            } finally {
                activeMutations -= 1
            }
        }

        private fun exact(
            projectId: String,
            installationId: String,
            expectedRevision: Int,
        ): NativeInstallation = checkNotNull(current).also {
            check(it.projectId == projectId && it.id == installationId)
            check(it.revision == expectedRevision)
        }

        private fun installation(
            projectId: String,
            environment: NativeAppEnvironment,
            appVersion: String,
            buildNumber: String,
            installationKeyDigest: String,
        ) = NativeInstallation(
            schema = "sitesourcery.responder-native-installation/v1",
            id = INSTALLATION,
            organizationId = ORGANIZATION,
            projectId = projectId,
            customerUserId = USER,
            platform = NativePlatform.android,
            bundleId = "com.sitesourcery.responder",
            appEnvironment = environment,
            appVersion = appVersion,
            buildNumber = buildNumber,
            installationKeyDigest = installationKeyDigest,
            state = NativeInstallationState.active,
            revision = 1,
            createdAt = NOW,
            pushRegistrations = emptyList(),
            voipSessionState = "held",
            providerEffects = false,
            pushDeliveryEffects = false,
            voiceCallEffects = false,
            carrierCommandEffects = false,
            messageSendEffects = false,
        )

        private fun receipt(
            operation: String,
            commandId: String,
            installation: NativeInstallation,
            tokenReceiptDigest: String? = null,
        ) = NativeCommandReceipt(
            schema = "sitesourcery.responder-native-command-receipt/v1",
            commandId = commandId,
            requestDigest = ResponderDigest.sha256("request:$commandId"),
            operation = operation,
            replayed = false,
            semanticReplay = false,
            tokenReceiptDigest = tokenReceiptDigest,
            installation = installation,
            providerEffects = false,
            pushDeliveryEffects = false,
            voiceCallEffects = false,
            carrierCommandEffects = false,
            messageSendEffects = false,
        )
    }

    companion object {
        private const val NOW = "2030-01-01T00:00:00Z"
        private const val ORGANIZATION = "10000000-0000-4000-8000-000000000001"
        private const val PROJECT = "20000000-0000-4000-8000-000000000001"
        private const val USER = "30000000-0000-4000-8000-000000000001"
        private const val INSTALLATION = "40000000-0000-4000-8000-000000000001"
        private const val VOICE_SESSION = "50000000-0000-4000-8000-000000000001"
        private const val TOKEN_A = "fcm-token-aaaaaaaaaaaaaaaaaaaa"
        private const val TOKEN_B = "fcm-token-bbbbbbbbbbbbbbbbbbbb"
    }
}
