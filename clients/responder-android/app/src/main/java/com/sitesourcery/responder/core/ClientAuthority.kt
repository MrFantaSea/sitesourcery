package com.sitesourcery.responder.core

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

interface SecureValueStore {
    fun read(key: String): ByteArray?
    fun write(key: String, value: ByteArray)
    fun remove(key: String)
}

class ClientAuthorityException(message: String) : IllegalArgumentException(message)
class VoiceSessionExpiredException : IllegalArgumentException(
    "The validated Voice session has expired."
)

object ResponderDigest {
    private val schemaPattern = Regex("^[a-z0-9][a-z0-9._/-]{7,119}$")
    private val fieldPattern = Regex("^[A-Za-z][A-Za-z0-9]{0,63}$")

    fun sha256(value: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(value)
        .joinToString("") { "%02x".format(it) }

    fun sha256(value: String): String = sha256(value.toByteArray(StandardCharsets.UTF_8))

    fun installationSecret(random: SecureRandom = SecureRandom()): ByteArray =
        ByteArray(32).also(random::nextBytes)

    fun installationKey(secret: ByteArray): String {
        require(secret.size == 32) { "Installation secret must be exactly 32 bytes." }
        return sha256(
            "sitesourcery.responder-installation-key/v1\u0000"
                .toByteArray(StandardCharsets.UTF_8) + secret
        )
    }

    fun evidence(schema: String, fields: Map<String, String>): String {
        require(schemaPattern.matches(schema)) { "Evidence schema is invalid." }
        require(fields.keys.all(fieldPattern::matches)) { "Evidence field is invalid." }
        require(fields.values.all { it.isNotEmpty() && it.length <= 512 }) {
            "Evidence value is invalid."
        }
        val payload = buildJsonObject {
            (fields + ("schema" to schema)).toSortedMap().forEach { (key, value) ->
                put(key, JsonPrimitive(value))
            }
        }
        return sha256(payload.toString())
    }

    fun nativeTransition(
        installationId: String,
        expectedRevision: Int,
        reason: String,
    ): String = evidence(
        schema = "sitesourcery.responder-native-transition-evidence/v1",
        fields = mapOf(
            "installationId" to installationId,
            "expectedRevision" to expectedRevision.toString(),
            "reason" to reason,
        ),
    )

    fun nativeTokenRetirement(
        installationId: String,
        expectedRevision: Int,
        purpose: NativePushPurpose,
    ): String = evidence(
        schema = "sitesourcery.responder-native-token-retirement-evidence/v1",
        fields = mapOf(
            "installationId" to installationId,
            "expectedRevision" to expectedRevision.toString(),
            "purpose" to purpose.name,
            "reason" to "customer_request",
        ),
    )

    fun nativeTokenReceipt(
        installation: NativeInstallation,
        purpose: NativePushPurpose,
        token: String,
    ): String {
        require(token.length in 20..4096 && token.all {
            it.isLetterOrDigit() || it in setOf('_', ':', '-')
        }) { "Android push token is invalid." }
        return evidence(
            schema = "sitesourcery.responder-native-token-receipt/v1",
            fields = mapOf(
                "organizationId" to installation.organizationId,
                "projectId" to installation.projectId,
                "customerUserId" to installation.customerUserId,
                "installationId" to installation.id,
                "platform" to installation.platform.name,
                "bundleId" to installation.bundleId,
                "appEnvironment" to installation.appEnvironment.name,
                "pushPurpose" to purpose.name,
                "tokenDigest" to sha256(token),
            ),
        )
    }

    fun forwardingConsent(
        projectId: String,
        numberBindingId: String,
        retainedBusinessLine: String,
        acceptedAt: String,
    ): String = evidence(
        schema = "sitesourcery.responder-forwarding-consent-evidence/v1",
        fields = mapOf(
            "projectId" to projectId,
            "numberBindingId" to numberBindingId,
            "retainedBusinessLine" to retainedBusinessLine,
            "acceptedAt" to acceptedAt,
            "launchMode" to "conditional_no_answer_forwarding",
        ),
    )

    fun forwardingCancellation(onboardingId: String, expectedRevision: Int): String = evidence(
        schema = "sitesourcery.responder-forwarding-cancellation-evidence/v1",
        fields = mapOf(
            "onboardingId" to onboardingId,
            "expectedRevision" to expectedRevision.toString(),
            "reason" to "customer_cancelled",
        ),
    )
}

class CommandLedger(private val store: SecureValueStore) {
    private val mutex = Mutex()
    private val namespace = "sitesourcery.responder.android.command.v1."
    private val semanticPattern = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$")
    private val commandPattern = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$")

    suspend fun idempotencyKey(semanticIdentity: String): String = mutex.withLock {
        require(semanticPattern.matches(semanticIdentity)) { "Semantic identity is invalid." }
        val storageKey = namespace + ResponderDigest.sha256(semanticIdentity)
        store.read(storageKey)?.decodeToString()?.let { existing ->
            if (!commandPattern.matches(existing)) {
                throw ClientAuthorityException("Stored command identity is corrupt.")
            }
            return@withLock existing
        }
        val command = "android." + UUID.randomUUID().toString().replace("-", "")
        store.write(storageKey, command.encodeToByteArray())
        command
    }

    suspend fun complete(semanticIdentity: String, idempotencyKey: String) = mutex.withLock {
        require(semanticPattern.matches(semanticIdentity)) { "Semantic identity is invalid." }
        val storageKey = namespace + ResponderDigest.sha256(semanticIdentity)
        val existing = store.read(storageKey)?.decodeToString() ?: return@withLock
        if (existing != idempotencyKey) {
            throw ClientAuthorityException("Receipt does not own the stored command identity.")
        }
        store.remove(storageKey)
    }

    suspend fun renewExpired(
        semanticIdentity: String,
        expiredIdempotencyKey: String,
    ): String = mutex.withLock {
        require(semanticPattern.matches(semanticIdentity)) { "Semantic identity is invalid." }
        val storageKey = namespace + ResponderDigest.sha256(semanticIdentity)
        val existing = store.read(storageKey)?.decodeToString()
            ?: throw ClientAuthorityException("Expired command identity is unavailable.")
        if (existing != expiredIdempotencyKey) {
            throw ClientAuthorityException("Expired command identity changed before renewal.")
        }
        val replacement = "android." + UUID.randomUUID().toString().replace("-", "")
        store.write(storageKey, replacement.encodeToByteArray())
        replacement
    }
}

object ReceiptValidator {
    private val digest = Regex("^[0-9a-f]{64}$")
    private val uuid = Regex(
        "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    )
    private val command = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$")
    private val keyVersion = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")

    fun nativeList(
        value: NativeInstallationList,
        organizationId: String,
        projectId: String,
        customerUserId: String,
    ): NativeInstallationList {
        require(value.schema == "sitesourcery.responder-native-installation-list/v1")
        require(value.organizationId == organizationId && value.projectId == projectId)
        require(value.voipSessionState in setOf("held", "verified"))
        require(noEffects(value))
        require(value.installations.size <= 50)
        require(value.installations.map { it.id }.toSet().size == value.installations.size)
        require(
            value.installations.map { it.installationKeyDigest }.toSet().size ==
                value.installations.size
        )
        value.installations.forEach {
            validateNativeInstallation(it, organizationId, projectId, customerUserId)
            require(it.voipSessionState == value.voipSessionState)
        }
        return value
    }

    fun nativeInstallation(
        value: NativeInstallation,
        organizationId: String,
        projectId: String,
        customerUserId: String,
    ): NativeInstallation = validateNativeInstallation(
        value,
        organizationId,
        projectId,
        customerUserId,
    )

    fun nativeCreate(
        receipt: NativeCommandReceipt,
        expectedCommandId: String,
        organizationId: String,
        projectId: String,
        customerUserId: String,
        environment: NativeAppEnvironment,
        appVersion: String,
        buildNumber: String,
        installationKeyDigest: String,
    ): NativeInstallation {
        validateNativeReceipt(receipt, expectedCommandId, "create_installation")
        val installation = validateNativeInstallation(
            receipt.installation,
            organizationId,
            projectId,
            customerUserId,
        )
        require(installation.platform == NativePlatform.android)
        require(installation.bundleId == "com.sitesourcery.responder")
        require(installation.appEnvironment == environment)
        require(installation.appVersion == appVersion && installation.buildNumber == buildNumber)
        require(installation.installationKeyDigest == installationKeyDigest)
        if (!receipt.replayed && !receipt.semanticReplay) {
            require(installation.state == NativeInstallationState.active)
            require(installation.revision == 1 && installation.pushRegistrations.isEmpty())
        } else {
            require(installation.revision >= 1)
        }
        return installation
    }

    fun nativeRegister(
        receipt: NativeCommandReceipt,
        expectedCommandId: String,
        prior: NativeInstallation,
        purpose: NativePushPurpose,
        submittedToken: String,
    ): NativeInstallation {
        require(prior.state == NativeInstallationState.active)
        require(
            receipt.tokenReceiptDigest ==
                ResponderDigest.nativeTokenReceipt(prior, purpose, submittedToken)
        )
        val installation = validateNativeMutation(
            receipt,
            expectedCommandId,
            "register_token",
            prior,
        )
        val minimum = if (receipt.semanticReplay) prior.revision else prior.revision + 1
        require(installation.revision >= minimum)
        if (installation.revision <= prior.revision + 1) {
            require(installation.state == NativeInstallationState.active)
            val registration = installation.pushRegistrations.singleOrNull {
                it.purpose == purpose && it.active
            }
            require(registration != null)
            if (installation.revision == prior.revision + 1) {
                require(registration.revision == installation.revision)
            }
            requireOtherPurposeUnchanged(prior, installation, purpose, active = true)
        }
        return installation
    }

    fun nativeRetire(
        receipt: NativeCommandReceipt,
        expectedCommandId: String,
        prior: NativeInstallation,
        purpose: NativePushPurpose,
    ): NativeInstallation {
        require(prior.state == NativeInstallationState.active)
        require(prior.pushRegistrations.any { it.purpose == purpose && it.active })
        require(!receipt.semanticReplay)
        val installation = validateNativeMutation(
            receipt,
            expectedCommandId,
            "retire_token",
            prior,
        )
        require(installation.revision >= prior.revision + 1)
        if (installation.revision == prior.revision + 1) {
            require(installation.state == NativeInstallationState.active)
            require(installation.pushRegistrations.none { it.purpose == purpose })
            requireOtherPurposeUnchanged(prior, installation, purpose, active = true)
        }
        return installation
    }

    fun nativeSuspend(
        receipt: NativeCommandReceipt,
        expectedCommandId: String,
        prior: NativeInstallation,
    ): NativeInstallation {
        require(prior.state == NativeInstallationState.active)
        val installation = validateNativeMutation(receipt, expectedCommandId, "suspend", prior)
        require(installation.revision >= prior.revision + 1)
        if (installation.revision == prior.revision + 1) {
            require(installation.state == NativeInstallationState.suspended)
            require(installation.suspendedReason == "logout" && installation.suspendedAt != null)
            require(
                installation.pushRegistrations ==
                    prior.pushRegistrations.map { it.copy(active = false) }
            )
        }
        return installation
    }

    fun nativeResume(
        receipt: NativeCommandReceipt,
        expectedCommandId: String,
        prior: NativeInstallation,
    ): NativeInstallation {
        require(prior.state == NativeInstallationState.suspended)
        val installation = validateNativeMutation(receipt, expectedCommandId, "resume", prior)
        require(installation.revision >= prior.revision + 1)
        if (installation.revision == prior.revision + 1) {
            require(installation.state == NativeInstallationState.active)
            require(
                installation.pushRegistrations ==
                    prior.pushRegistrations.map { it.copy(active = true) }
            )
        }
        return installation
    }

    fun nativeRevoke(
        receipt: NativeCommandReceipt,
        expectedCommandId: String,
        prior: NativeInstallation,
        reason: String,
    ): NativeInstallation {
        require(prior.state in setOf(NativeInstallationState.active, NativeInstallationState.suspended))
        val installation = validateNativeMutation(receipt, expectedCommandId, "revoke", prior)
        require(installation.revision == prior.revision + 1)
        require(installation.state == NativeInstallationState.revoked)
        require(installation.revokedReason == reason && installation.revokedAt != null)
        return installation
    }

    fun voice(
        session: NativeVoiceSession,
        expectedCommandId: String,
        installation: NativeInstallation,
        observedAt: java.time.Instant = java.time.Instant.now(),
    ): NativeVoiceSession {
        require(session.schema == "sitesourcery.responder-native-voice-session/v1")
        requireNativeCommandIdentity(
            session.commandId,
            expectedCommandId,
            session.replayed,
            session.semanticReplay,
        )
        require(digest.matches(session.requestDigest))
        require(uuid.matches(session.sessionId))
        require(session.installationId == installation.id)
        require(session.installationRevision == installation.revision)
        require(installation.state == NativeInstallationState.active)
        require(installation.pushRegistrations.any {
            it.purpose == NativePushPurpose.voip && it.active
        })
        require(session.organizationId == installation.organizationId)
        require(session.projectId == installation.projectId)
        require(session.customerUserId == installation.customerUserId)
        require(session.appEnvironment == installation.appEnvironment)
        require(session.provider == "twilio")
        require(session.clientPlatform == NativePlatform.android)
        require(session.transport == "twilio_voice_android")
        require(digest.matches(session.identityDigest) && digest.matches(session.credentialDigest))
        require(session.accessToken.length in 32..8192)
        val issuedAt = java.time.Instant.parse(session.issuedAt)
        val expiresAt = java.time.Instant.parse(session.expiresAt)
        require(expiresAt == issuedAt.plusSeconds(300))
        require(session.incomingAllowed && !session.outgoingAllowed)
        require(session.providerAuthorizationEffects)
        require(!session.providerEffects && !session.pushDeliveryEffects)
        require(!session.voiceCallEffects && !session.carrierCommandEffects)
        require(!session.messageSendEffects)
        if (!expiresAt.isAfter(observedAt)) throw VoiceSessionExpiredException()
        return session
    }

    fun forwardingList(
        value: ForwardingList,
        organizationId: String,
        projectId: String,
        customerUserId: String,
    ): ForwardingList {
        require(value.schema == "sitesourcery.responder-forwarding-list/v1")
        require(value.organizationId == organizationId && value.projectId == projectId)
        validateInstructionPlan(value.instructionPlan)
        require(!value.automaticCarrierCommands && !value.remoteWriteEffects)
        require(!value.providerEffects && !value.messageSendEffects)
        require(value.onboardings.size <= 100)
        require(value.onboardings.map { it.id }.toSet().size == value.onboardings.size)
        value.onboardings.forEach {
            validateForwardingOnboarding(it, organizationId, projectId, customerUserId)
        }
        val onboardingIds = value.onboardings.map { it.id }.toSet()
        require(value.observations.map { it.id }.toSet().size == value.observations.size)
        value.observations.forEach {
            require(uuid.matches(it.id) && it.onboardingId in onboardingIds)
            require(it.observationKind in setOf(
                "carrier_setup_attested",
                "unanswered_forwarding_reached",
                "answered_call_not_forwarded",
                "reply_path_confirmed",
                "stop_path_confirmed",
                "routing_ambiguous",
            ))
            require(it.inboundEventId == null || uuid.matches(it.inboundEventId))
            require(digest.matches(it.evidenceDigest) && digest.matches(it.observationDigest))
            java.time.Instant.parse(it.observedAt)
            java.time.Instant.parse(it.recordedAt)
        }
        return value
    }

    fun forwardingCreate(
        receipt: ForwardingCommandReceipt,
        expectedCommandId: String,
        organizationId: String,
        projectId: String,
        customerUserId: String,
        numberBindingId: String,
    ): ForwardingOnboarding {
        validateForwardingReceipt(receipt, expectedCommandId, "create")
        val onboarding = validateForwardingOnboarding(
            receipt.onboarding,
            organizationId,
            projectId,
            customerUserId,
        )
        require(receipt.onboardingId == onboarding.id)
        require(onboarding.numberBindingId == numberBindingId)
        require(receipt.resultingState == "setup_pending" && receipt.resultingRevision == 1)
        if (!receipt.replayed && !receipt.semanticReplay) {
            require(onboarding.state == "setup_pending" && onboarding.revision == 1)
        } else {
            require(onboarding.revision >= 1)
        }
        return onboarding
    }

    fun forwardingRetire(
        receipt: ForwardingCommandReceipt,
        expectedCommandId: String,
        prior: ForwardingOnboarding,
        expectedRevision: Int,
    ): ForwardingOnboarding {
        require(prior.state != "retired" && prior.revision == expectedRevision)
        validateForwardingReceipt(receipt, expectedCommandId, "retire")
        val onboarding = validateForwardingOnboarding(
            receipt.onboarding,
            prior.organizationId,
            prior.projectId,
            prior.customerUserId,
        )
        require(receipt.onboardingId == prior.id && onboarding.id == prior.id)
        require(onboarding.numberBindingId == prior.numberBindingId)
        require(onboarding.transportAdapter == prior.transportAdapter)
        require(onboarding.launchMode == prior.launchMode)
        require(onboarding.instructionContract == prior.instructionContract)
        require(onboarding.businessLineConfigured == prior.businessLineConfigured)
        require(onboarding.businessLineKeyVersion == prior.businessLineKeyVersion)
        require(onboarding.createdAt == prior.createdAt)
        require(receipt.resultingState == "retired")
        require(receipt.resultingRevision == expectedRevision + 1)
        require(onboarding.state == "retired" && onboarding.revision == expectedRevision + 1)
        require(onboarding.retiredReason == "customer_cancelled" && onboarding.retiredAt != null)
        return onboarding
    }

    fun dashboard(
        value: ResponderDashboard,
        organizationId: String,
        customerUserId: String,
    ): ResponderDashboard {
        require(value.schema == "sitesourcery.responder-surface-dashboard/v1")
        require(value.audience == "customer" && value.organizationId == organizationId)
        require(value.mode == "held" && !value.sellable)
        require(!value.billingEffects && !value.providerEffects)
        java.time.Instant.parse(value.observedAt)
        require(value.contacts.map { it.id }.toSet().size == value.contacts.size)
        value.contacts.forEach {
            require(uuid.matches(it.id) && uuid.matches(it.projectId))
            require(it.customerUserId == customerUserId)
            require(digest.matches(it.routeDigest) && it.revision > 0)
            java.time.Instant.parse(it.consentedAt)
            it.optedOutAt?.let(java.time.Instant::parse)
        }
        val contactIds = value.contacts.map { it.id }.toSet()
        require(value.interactions.map { it.id }.toSet().size == value.interactions.size)
        val eventIds = mutableSetOf<String>()
        val commandIds = mutableSetOf<String>()
        value.interactions.forEach { interaction ->
            require(uuid.matches(interaction.id) && uuid.matches(interaction.projectId))
            require(interaction.contactAuthorityId in contactIds)
            require(digest.matches(interaction.routeDigest) && interaction.revision > 0)
            java.time.Instant.parse(interaction.openedAt)
            java.time.Instant.parse(interaction.lastEventAt)
            interaction.events.forEach {
                require(uuid.matches(it.id) && it.interactionId == interaction.id)
                require(eventIds.add(it.id))
                require(!it.providerEffects)
                java.time.Instant.parse(it.occurredAt)
                java.time.Instant.parse(it.recordedAt)
            }
            interaction.heldCommands.forEach {
                require(uuid.matches(it.id) && it.interactionId == interaction.id)
                require(commandIds.add(it.id))
                require(it.contactAuthorityId == interaction.contactAuthorityId)
                require(!it.providerEffects && !it.deliveryClaimed)
                java.time.Instant.parse(it.requestedAt)
            }
        }
        return value
    }

    private fun validateNativeReceipt(
        receipt: NativeCommandReceipt,
        expectedCommandId: String,
        expectedOperation: String,
    ) {
        require(receipt.schema == "sitesourcery.responder-native-command-receipt/v1")
        requireNativeCommandIdentity(
            receipt.commandId,
            expectedCommandId,
            receipt.replayed,
            receipt.semanticReplay,
        )
        require(receipt.operation == expectedOperation)
        require(digest.matches(receipt.requestDigest) && noEffects(receipt))
        if (expectedOperation == "register_token") {
            require(digest.matches(receipt.tokenReceiptDigest ?: ""))
        } else {
            require(receipt.tokenReceiptDigest == null)
        }
    }

    private fun validateNativeMutation(
        receipt: NativeCommandReceipt,
        expectedCommandId: String,
        operation: String,
        prior: NativeInstallation,
    ): NativeInstallation {
        validateNativeReceipt(receipt, expectedCommandId, operation)
        val value = validateNativeInstallation(
            receipt.installation,
            prior.organizationId,
            prior.projectId,
            prior.customerUserId,
        )
        require(value.id == prior.id)
        require(value.platform == prior.platform && value.bundleId == prior.bundleId)
        require(value.appEnvironment == prior.appEnvironment)
        require(value.appVersion == prior.appVersion && value.buildNumber == prior.buildNumber)
        require(value.installationKeyDigest == prior.installationKeyDigest)
        require(value.createdAt == prior.createdAt)
        return value
    }

    private fun validateNativeInstallation(
        value: NativeInstallation,
        organizationId: String,
        projectId: String,
        customerUserId: String,
    ): NativeInstallation {
        require(value.schema == "sitesourcery.responder-native-installation/v1")
        require(uuid.matches(value.id) && uuid.matches(value.organizationId))
        require(uuid.matches(value.projectId) && uuid.matches(value.customerUserId))
        require(value.organizationId == organizationId && value.projectId == projectId)
        require(value.customerUserId == customerUserId)
        require(value.bundleId.length in 3..255)
        require(value.appVersion.length in 1..64 && value.buildNumber.length in 1..64)
        require(digest.matches(value.installationKeyDigest) && value.revision > 0)
        java.time.Instant.parse(value.createdAt)
        require(value.voipSessionState in setOf("held", "verified"))
        require(noEffects(value))
        require(value.pushRegistrations.map { it.purpose }.toSet().size == value.pushRegistrations.size)
        value.pushRegistrations.forEach {
            require(digest.matches(it.tokenReferenceDigest) && keyVersion.matches(it.keyVersion))
            require(it.revision in 1..value.revision)
            require(it.active == (value.state == NativeInstallationState.active))
            java.time.Instant.parse(it.registeredAt)
        }
        when (value.state) {
            NativeInstallationState.active -> require(
                value.suspendedAt == null && value.suspendedReason == null &&
                    value.revokedAt == null && value.revokedReason == null
            )
            NativeInstallationState.suspended -> {
                require(value.suspendedAt != null && value.suspendedReason == "logout")
                require(value.revokedAt == null && value.revokedReason == null)
                java.time.Instant.parse(value.suspendedAt)
            }
            NativeInstallationState.revoked -> {
                require(value.revokedAt != null && value.revokedReason in setOf(
                    "customer_request", "device_lost", "token_compromise"
                ))
                require(value.suspendedAt == null && value.suspendedReason == null)
                java.time.Instant.parse(value.revokedAt)
            }
        }
        return value
    }

    private fun requireNativeCommandIdentity(
        actualCommandId: String,
        expectedCommandId: String,
        replayed: Boolean,
        semanticReplay: Boolean,
    ) {
        require(command.matches(actualCommandId))
        if (semanticReplay) {
            require(replayed && actualCommandId != expectedCommandId)
        } else {
            require(actualCommandId == expectedCommandId)
        }
    }

    private fun validateForwardingReceipt(
        receipt: ForwardingCommandReceipt,
        expectedCommandId: String,
        commandKind: String,
    ) {
        require(receipt.schema == "sitesourcery.responder-forwarding-command-receipt/v1")
        require(command.matches(receipt.commandId))
        if (receipt.semanticReplay) {
            require(!receipt.replayed && receipt.commandId != expectedCommandId)
        } else {
            require(receipt.commandId == expectedCommandId)
        }
        require(receipt.commandKind == commandKind && digest.matches(receipt.requestDigest))
        require(!receipt.automaticCarrierCommands && !receipt.remoteWriteEffects)
        require(!receipt.providerEffects && !receipt.messageSendEffects)
    }

    private fun validateForwardingOnboarding(
        value: ForwardingOnboarding,
        organizationId: String,
        projectId: String,
        customerUserId: String,
    ): ForwardingOnboarding {
        require(value.schema == "sitesourcery.responder-forwarding-onboarding/v1")
        require(uuid.matches(value.id) && uuid.matches(value.organizationId))
        require(uuid.matches(value.projectId) && uuid.matches(value.customerUserId))
        require(uuid.matches(value.numberBindingId))
        require(value.organizationId == organizationId && value.projectId == projectId)
        require(value.customerUserId == customerUserId)
        require(value.transportAdapter == "twilio")
        require(value.launchMode == "conditional_no_answer_forwarding")
        require(value.instructionContract == "provider-assisted-conditional-no-answer-v1")
        require(value.businessLineConfigured && keyVersion.matches(value.businessLineKeyVersion))
        require(value.state in setOf("setup_pending", "manual_review", "ready_held", "retired"))
        require(value.revision > 0)
        java.time.Instant.parse(value.createdAt)
        java.time.Instant.parse(value.updatedAt)
        if (value.state == "retired") {
            require(value.retiredReason != null && value.retiredAt != null)
            java.time.Instant.parse(value.retiredAt)
        } else {
            require(value.retiredReason == null && value.retiredAt == null)
        }
        require(!value.automaticCarrierCommands && !value.remoteWriteEffects)
        require(!value.providerEffects && !value.messageSendEffects)
        return value
    }

    private fun validateInstructionPlan(value: ForwardingInstructionPlan) {
        require(value.schema == "sitesourcery.responder-forwarding-contract/v1")
        require(value.launchMode == "conditional_no_answer_forwarding")
        require(value.transportAuthority == "provider_neutral" && value.initialAdapter == "twilio")
        require(value.retainedCarrier)
        require(value.instructionContract == "provider-assisted-conditional-no-answer-v1")
        require(value.setupAuthority == "customer_carrier_or_voip_administrator")
        require(value.setupEffect == "human_executed")
        require(value.setupSteps.size == 5 && value.cancelSteps.size == 2)
        require(value.verificationRequirements == listOf(
            "carrier_setup_attested",
            "unanswered_forwarding_reached",
            "answered_call_not_forwarded",
            "reply_path_confirmed",
            "stop_path_confirmed",
        ))
        require(value.ambiguityBehavior == "manual_review")
        require(value.managedDestination == "assigned_after_provider_release")
        require(value.carrierCodes == "not_stored_or_automated")
        require(digest.matches(value.contractDigest))
        require(!value.automaticCarrierCommands && !value.remoteWriteEffects)
        require(!value.providerEffects && !value.messageSendEffects)
    }

    private fun requireOtherPurposeUnchanged(
        prior: NativeInstallation,
        result: NativeInstallation,
        changedPurpose: NativePushPurpose,
        active: Boolean,
    ) {
        NativePushPurpose.entries.filter { it != changedPurpose }.forEach { purpose ->
            val before = prior.pushRegistrations.singleOrNull { it.purpose == purpose }
            val after = result.pushRegistrations.singleOrNull { it.purpose == purpose }
            require(after == before?.copy(active = active))
        }
    }

    private fun noEffects(value: NativeCommandReceipt): Boolean =
        !value.providerEffects && !value.pushDeliveryEffects && !value.voiceCallEffects &&
            !value.carrierCommandEffects && !value.messageSendEffects

    private fun noEffects(value: NativeInstallation): Boolean =
        !value.providerEffects && !value.pushDeliveryEffects && !value.voiceCallEffects &&
            !value.carrierCommandEffects && !value.messageSendEffects

    private fun noEffects(value: NativeInstallationList): Boolean =
        !value.providerEffects && !value.pushDeliveryEffects && !value.voiceCallEffects &&
            !value.carrierCommandEffects && !value.messageSendEffects
}
