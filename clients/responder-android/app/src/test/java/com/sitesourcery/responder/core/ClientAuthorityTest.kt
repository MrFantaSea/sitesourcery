package com.sitesourcery.responder.core

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ClientAuthorityTest {
    @Test
    fun nativeTokenReceiptMatchesBackendFixedVector() {
        assertEquals(
            "2970ba920f5054b317897cce8b4a846ffa610b3200f7f6026bf4c63807ba0093",
            ResponderDigest.nativeTokenReceipt(
                installation(revision = 1, registrations = emptyList()),
                NativePushPurpose.voip,
                TOKEN,
            ),
        )
    }

    @Test
    fun nativeRegisterBindsTenantPurposeAndImmediateRevision() {
        val prior = installation(
            revision = 1,
            registrations = listOf(registration(NativePushPurpose.notification, 1)),
        )
        val result = installation(
            revision = 2,
            registrations = listOf(
                registration(NativePushPurpose.notification, 1),
                registration(NativePushPurpose.voip, 2),
            ),
        )
        val validated = ReceiptValidator.nativeRegister(
            nativeReceipt("register_token", result),
            COMMAND,
            prior,
            NativePushPurpose.voip,
            TOKEN,
        )
        assertEquals(2, validated.revision)

        assertThrows(IllegalArgumentException::class.java) {
            ReceiptValidator.nativeRegister(
                nativeReceipt(
                    "register_token",
                    result.copy(organizationId = OTHER_ORGANIZATION),
                ),
                COMMAND,
                prior,
                NativePushPurpose.voip,
                TOKEN,
            )
        }
    }

    @Test
    fun nativeSemanticExactCurrentRegisterIsTheOnlyNoRevisionCase() {
        val current = installation(
            revision = 2,
            registrations = listOf(
                registration(NativePushPurpose.notification, 1),
                registration(NativePushPurpose.voip, 2),
            ),
        )
        val semantic = nativeReceipt(
            operation = "register_token",
            value = current,
            commandId = ORIGINAL_COMMAND,
            replayed = true,
            semanticReplay = true,
        )
        assertEquals(
            current,
            ReceiptValidator.nativeRegister(
                semantic,
                COMMAND,
                current,
                NativePushPurpose.voip,
                TOKEN,
            ),
        )

        assertThrows(IllegalArgumentException::class.java) {
            ReceiptValidator.nativeRegister(
                semantic.copy(
                    tokenReceiptDigest = ResponderDigest.nativeTokenReceipt(
                        current,
                        NativePushPurpose.voip,
                        OTHER_TOKEN,
                    ),
                ),
                COMMAND,
                current,
                NativePushPurpose.voip,
                TOKEN,
            )
        }

        assertThrows(IllegalArgumentException::class.java) {
            ReceiptValidator.nativeRetire(
                nativeReceipt(
                    operation = "retire_token",
                    value = current.copy(
                        revision = 3,
                        pushRegistrations = listOf(registration(NativePushPurpose.notification, 1)),
                    ),
                    commandId = ORIGINAL_COMMAND,
                    replayed = true,
                    semanticReplay = true,
                ),
                COMMAND,
                current,
                NativePushPurpose.voip,
            )
        }
    }

    @Test
    fun voiceSessionBindsActorProviderDigestsAndFiveMinuteExpiry() {
        val selected = installation(
            revision = 2,
            registrations = listOf(registration(NativePushPurpose.voip, 2)),
        )
        val issued = Instant.parse("2030-01-01T00:00:00Z")
        val session = NativeVoiceSession(
            schema = "sitesourcery.responder-native-voice-session/v1",
            sessionId = SESSION,
            commandId = COMMAND,
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
            identityDigest = DIGEST_B,
            credentialDigest = DIGEST_C,
            accessToken = "x".repeat(64),
            issuedAt = issued.toString(),
            expiresAt = issued.plusSeconds(300).toString(),
            incomingAllowed = true,
            outgoingAllowed = false,
            providerAuthorizationEffects = true,
            providerEffects = false,
            pushDeliveryEffects = false,
            voiceCallEffects = false,
            carrierCommandEffects = false,
            messageSendEffects = false,
        )
        assertEquals(
            session,
            ReceiptValidator.voice(session, COMMAND, selected, issued.plusSeconds(1)),
        )
        assertThrows(IllegalArgumentException::class.java) {
            ReceiptValidator.voice(
                session.copy(credentialDigest = "bad"),
                COMMAND,
                selected,
                issued.plusSeconds(1),
            )
        }
        assertThrows(VoiceSessionExpiredException::class.java) {
            ReceiptValidator.voice(session, COMMAND, selected, issued.plusSeconds(300))
        }
    }

    @Test
    fun forwardingReplayKeepsOriginalResultWhileCurrentProjectionAdvances() {
        val current = onboarding(state = "ready_held", revision = 3)
        val receipt = ForwardingCommandReceipt(
            schema = "sitesourcery.responder-forwarding-command-receipt/v1",
            commandId = ORIGINAL_COMMAND,
            onboardingId = ONBOARDING,
            commandKind = "create",
            requestDigest = DIGEST_A,
            resultingState = "setup_pending",
            resultingRevision = 1,
            onboarding = current,
            replayed = false,
            semanticReplay = true,
            automaticCarrierCommands = false,
            remoteWriteEffects = false,
            providerEffects = false,
            messageSendEffects = false,
        )
        assertEquals(
            current,
            ReceiptValidator.forwardingCreate(
                receipt,
                COMMAND,
                ORGANIZATION,
                PROJECT,
                USER,
                BINDING,
            ),
        )
    }

    @Test
    fun forwardingRetirementIsTerminalAndBoundToPriorIdentity() {
        val prior = onboarding(state = "ready_held", revision = 3)
        val retired = prior.copy(
            state = "retired",
            revision = 4,
            updatedAt = "2030-01-01T00:01:00Z",
            retiredReason = "customer_cancelled",
            retiredAt = "2030-01-01T00:01:00Z",
        )
        val receipt = ForwardingCommandReceipt(
            schema = "sitesourcery.responder-forwarding-command-receipt/v1",
            commandId = COMMAND,
            onboardingId = ONBOARDING,
            commandKind = "retire",
            requestDigest = DIGEST_A,
            resultingState = "retired",
            resultingRevision = 4,
            onboarding = retired,
            replayed = false,
            semanticReplay = false,
            automaticCarrierCommands = false,
            remoteWriteEffects = false,
            providerEffects = false,
            messageSendEffects = false,
        )
        assertEquals(retired, ReceiptValidator.forwardingRetire(receipt, COMMAND, prior, 3))
        assertThrows(IllegalArgumentException::class.java) {
            ReceiptValidator.forwardingRetire(
                receipt.copy(onboarding = retired.copy(numberBindingId = OTHER_BINDING)),
                COMMAND,
                prior,
                3,
            )
        }
    }

    private fun installation(
        revision: Int,
        registrations: List<NativePushRegistration>,
    ): NativeInstallation = NativeInstallation(
        schema = "sitesourcery.responder-native-installation/v1",
        id = INSTALLATION,
        organizationId = ORGANIZATION,
        projectId = PROJECT,
        customerUserId = USER,
        platform = NativePlatform.android,
        bundleId = "com.sitesourcery.responder",
        appEnvironment = NativeAppEnvironment.sandbox,
        appVersion = "1.0.0",
        buildNumber = "1",
        installationKeyDigest = DIGEST_A,
        state = NativeInstallationState.active,
        revision = revision,
        createdAt = "2030-01-01T00:00:00Z",
        pushRegistrations = registrations,
        voipSessionState = "verified",
        providerEffects = false,
        pushDeliveryEffects = false,
        voiceCallEffects = false,
        carrierCommandEffects = false,
        messageSendEffects = false,
    )

    private fun registration(purpose: NativePushPurpose, revision: Int) =
        NativePushRegistration(
            purpose = purpose,
            tokenReferenceDigest = if (purpose == NativePushPurpose.voip) DIGEST_B else DIGEST_C,
            keyVersion = "test-v1",
            registeredAt = "2030-01-01T00:00:00Z",
            revision = revision,
            active = true,
        )

    private fun nativeReceipt(
        operation: String,
        value: NativeInstallation,
        commandId: String = COMMAND,
        replayed: Boolean = false,
        semanticReplay: Boolean = false,
    ): NativeCommandReceipt {
        val receiptDigest = if (operation == "register_token") {
            ResponderDigest.nativeTokenReceipt(value, NativePushPurpose.voip, TOKEN)
        } else {
            null
        }
        return NativeCommandReceipt(
            schema = "sitesourcery.responder-native-command-receipt/v1",
            commandId = commandId,
            requestDigest = DIGEST_A,
            operation = operation,
            replayed = replayed,
            semanticReplay = semanticReplay,
            tokenReceiptDigest = receiptDigest,
            installation = value,
            providerEffects = false,
            pushDeliveryEffects = false,
            voiceCallEffects = false,
            carrierCommandEffects = false,
            messageSendEffects = false,
        )
    }

    private fun onboarding(state: String, revision: Int) = ForwardingOnboarding(
        schema = "sitesourcery.responder-forwarding-onboarding/v1",
        id = ONBOARDING,
        organizationId = ORGANIZATION,
        projectId = PROJECT,
        customerUserId = USER,
        numberBindingId = BINDING,
        transportAdapter = "twilio",
        launchMode = "conditional_no_answer_forwarding",
        instructionContract = "provider-assisted-conditional-no-answer-v1",
        businessLineConfigured = true,
        businessLineKeyVersion = "test-v1",
        state = state,
        revision = revision,
        createdAt = "2030-01-01T00:00:00Z",
        updatedAt = "2030-01-01T00:00:00Z",
        automaticCarrierCommands = false,
        remoteWriteEffects = false,
        providerEffects = false,
        messageSendEffects = false,
    )

    companion object {
        private const val ORGANIZATION = "10000000-0000-4000-8000-000000000001"
        private const val OTHER_ORGANIZATION = "10000000-0000-4000-8000-000000000002"
        private const val PROJECT = "20000000-0000-4000-8000-000000000001"
        private const val USER = "30000000-0000-4000-8000-000000000001"
        private const val INSTALLATION = "40000000-0000-4000-8000-000000000001"
        private const val SESSION = "50000000-0000-4000-8000-000000000001"
        private const val BINDING = "60000000-0000-4000-8000-000000000001"
        private const val OTHER_BINDING = "60000000-0000-4000-8000-000000000002"
        private const val ONBOARDING = "70000000-0000-4000-8000-000000000001"
        private const val COMMAND = "android.11111111111111111111111111111111"
        private const val ORIGINAL_COMMAND = "android.22222222222222222222222222222222"
        private const val TOKEN = "fcm-token-aaaaaaaaaaaaaaaaaaaa"
        private const val OTHER_TOKEN = "fcm-token-bbbbbbbbbbbbbbbbbbbb"
        private val DIGEST_A = "a".repeat(64)
        private val DIGEST_B = "b".repeat(64)
        private val DIGEST_C = "c".repeat(64)
    }
}
