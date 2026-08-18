package com.sitesourcery.responder.nativeclient

import com.sitesourcery.responder.core.CommandLedger
import com.sitesourcery.responder.core.NativeAppEnvironment
import com.sitesourcery.responder.core.NativeInstallation
import com.sitesourcery.responder.core.NativeInstallationState
import com.sitesourcery.responder.core.NativePlatform
import com.sitesourcery.responder.core.NativePushPurpose
import com.sitesourcery.responder.core.NativeVoiceSession
import com.sitesourcery.responder.core.ReceiptValidator
import com.sitesourcery.responder.core.ResponderDigest
import com.sitesourcery.responder.core.VoiceSessionExpiredException
import com.sitesourcery.responder.network.ApiException
import com.sitesourcery.responder.network.NativeClientApi
import com.sitesourcery.responder.network.ResponderApi
import com.sitesourcery.responder.security.DeviceAuthorityStore
import com.sitesourcery.responder.security.NativeInstallationScope
import com.sitesourcery.responder.security.NativeInstallationScopePhase
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class NativeClientBuild(
    val environment: NativeAppEnvironment,
    val appVersion: String,
    val buildNumber: String,
)

data class VoiceAuthorization(
    val session: NativeVoiceSession,
    val fcmToken: String,
    val generation: Long,
    val organizationId: String,
    val projectId: String,
    val customerUserId: String,
    val installationId: String,
    val installationRevision: Int,
    val appEnvironment: NativeAppEnvironment,
)

class NativeRegistrationCoordinator(
    private val api: NativeClientApi,
    private val build: NativeClientBuild,
    private val authorityStore: DeviceAuthorityStore,
    private val commandLedger: CommandLedger,
) {
    private val mutationLane = Mutex()
    private val pendingTokens = linkedMapOf<NativePushPurpose, String>()
    private var installation: NativeInstallation? = null
    private var authorizationGeneration = 0L

    suspend fun recoveryScope(): NativeInstallationScope? = mutationLane.withLock {
        authorityStore.nativeInstallationScope()
    }

    suspend fun establish(
        projectId: String,
        organizationId: String,
        customerUserId: String,
    ): NativeInstallation = mutationLane.withLock {
        val current = installation
        if (current != null &&
            (current.projectId != projectId || current.organizationId != organizationId ||
                current.customerUserId != customerUserId)) {
            throw ApiException(
                "NATIVE_WORKSPACE_RELEASE_REQUIRED",
                "Release the current Responder workspace before selecting another one.",
                409,
            )
        }
        val secret = authorityStore.installationSecret(projectId)
        val keyDigest = ResponderDigest.installationKey(secret)
        var recoveryScope = authorityStore.nativeInstallationScope()
        if (recoveryScope != null &&
            (recoveryScope.projectId != projectId ||
                recoveryScope.organizationId != organizationId ||
                recoveryScope.customerUserId != customerUserId ||
                recoveryScope.installationKeyDigest != keyDigest)) {
            throw ApiException(
                "NATIVE_RECOVERY_WORKSPACE_REQUIRED",
                "Finish releasing the prior native workspace before selecting another one.",
                409,
            )
        }
        if (recoveryScope == null) {
            recoveryScope = NativeInstallationScope(
                organizationId = organizationId,
                projectId = projectId,
                customerUserId = customerUserId,
                installationId = null,
                installationKeyDigest = keyDigest,
                phase = NativeInstallationScopePhase.active,
            )
            check(authorityStore.claimNativeInstallationScope(recoveryScope)) {
                "Native installation scope could not be claimed."
            }
        }
        val list = ReceiptValidator.nativeList(
            api.nativeInstallations(projectId),
            organizationId,
            projectId,
            customerUserId,
        )
        val match = if (recoveryScope.installationId == null) {
            list.installations.singleOrNull {
                it.platform == NativePlatform.android &&
                    it.bundleId == ResponderApi.BUNDLE_ID &&
                    it.appEnvironment == build.environment &&
                    it.installationKeyDigest == keyDigest
            }
        } else {
            list.installations.singleOrNull { it.id == recoveryScope.installationId }
        }
        if (recoveryScope.phase == NativeInstallationScopePhase.release_pending) {
            if (match == null) {
                check(authorityStore.clearNativeInstallationScope(recoveryScope))
                throw ApiException(
                    "NATIVE_RELEASE_COMPLETED",
                    "The prior native installation is no longer active. Refresh to continue.",
                    409,
                )
            }
            installation = match
            return@withLock releasePendingLocked(match, recoveryScope)
        }
        installation = when {
            match?.state == NativeInstallationState.revoked -> {
                check(authorityStore.clearNativeInstallationScope(recoveryScope))
                throw ApiException(
                    "NATIVE_INSTALLATION_REVOKED",
                    "This device identity was revoked. Contact Site Sourcery before registering it again.",
                    409,
                )
            }
            match?.state == NativeInstallationState.suspended -> resumeLocked(match)
            match != null -> match
            else -> createLocked(projectId, organizationId, customerUserId, keyDigest)
        }
        var selected = checkNotNull(installation)
        recoveryScope = bindScope(recoveryScope, selected)
        if (selected.state == NativeInstallationState.suspended) {
            selected = resumeLocked(selected)
            installation = selected
        }
        if (selected.state == NativeInstallationState.revoked) {
            throw ApiException(
                "NATIVE_INSTALLATION_REVOKED",
                "This device identity was revoked. Contact Site Sourcery before registering it again.",
                409,
            )
        }
        selected = reconcileRetirementsLocked(selected)
        authorityStore.fcmToken()?.let { token ->
            for (purpose in NativePushPurpose.entries) {
                if (authorityStore.pushPurposeEnabled(purpose.name) &&
                    needsRegistration(selected, purpose, token)) {
                    pendingTokens[purpose] = token
                }
            }
        }
        selected = drainLocked(selected)
        selected
    }

    suspend fun receiveFcmToken(token: String): NativeInstallation? = mutationLane.withLock {
        authorityStore.saveFcmToken(token)
        authorizationGeneration += 1
        for (purpose in NativePushPurpose.entries) {
            if (authorityStore.pushPurposeEnabled(purpose.name)) {
                pendingTokens[purpose] = token
            } else {
                pendingTokens.remove(purpose)
            }
        }
        installation?.let { drainLocked(it) }
    }

    suspend fun updatePurposeAuthority(
        notificationEnabled: Boolean,
        voipEnabled: Boolean,
    ): NativeInstallation? = mutationLane.withLock {
        val enabled = mapOf(
            NativePushPurpose.notification to notificationEnabled,
            NativePushPurpose.voip to voipEnabled,
        )
        enabled.forEach { (purpose, isEnabled) ->
            authorityStore.setPushPurposeEnabled(purpose.name, isEnabled)
            if (!isEnabled) {
                pendingTokens.remove(purpose)
                authorityStore.markGlobalRetirement(purpose.name)
                installation?.projectId?.let { projectId ->
                    authorityStore.markRetirement(projectId, purpose.name)
                }
                authorityStore.nativeInstallationScope()?.let { scope ->
                    authorityStore.markRetirement(scope.projectId, purpose.name)
                }
            }
        }
        authorizationGeneration += 1
        var selected = installation ?: return@withLock null
        for ((purpose, isEnabled) in enabled) {
            if (!isEnabled) selected = retireLocked(selected, purpose)
        }
        authorityStore.fcmToken()?.let { token ->
            for ((purpose, isEnabled) in enabled) {
                if (isEnabled && needsRegistration(selected, purpose, token)) {
                    pendingTokens[purpose] = token
                }
            }
        }
        selected = drainLocked(selected)
        installation = selected
        selected
    }

    suspend fun retireFcmAuthority(): NativeInstallation? = mutationLane.withLock {
        authorityStore.clearFcmToken()
        for (purpose in NativePushPurpose.entries) {
            authorityStore.setPushPurposeEnabled(purpose.name, false)
            authorityStore.markGlobalRetirement(purpose.name)
            installation?.projectId?.let { projectId ->
                authorityStore.markRetirement(projectId, purpose.name)
            }
            authorityStore.nativeInstallationScope()?.let { scope ->
                authorityStore.markRetirement(scope.projectId, purpose.name)
            }
        }
        authorizationGeneration += 1
        pendingTokens.clear()
        var selected = installation ?: return@withLock null
        selected = retireLocked(selected, NativePushPurpose.notification)
        selected = retireLocked(selected, NativePushPurpose.voip)
        installation = selected
        selected
    }

    suspend fun suspendForLogout(): NativeInstallation? = mutationLane.withLock {
        var selected = installation
        var scope = authorityStore.nativeInstallationScope()
        if (selected == null && scope != null) {
            val list = ReceiptValidator.nativeList(
                api.nativeInstallations(scope.projectId),
                scope.organizationId,
                scope.projectId,
                scope.customerUserId,
            )
            selected = scope.installationId?.let { id ->
                list.installations.singleOrNull { it.id == id }
            } ?: list.installations.singleOrNull {
                it.platform == NativePlatform.android &&
                    it.installationKeyDigest == scope.installationKeyDigest
            }
            if (selected == null) {
                check(authorityStore.clearNativeInstallationScope(scope))
                return@withLock null
            }
            installation = selected
            scope = bindScope(scope, selected)
        }
        selected ?: return@withLock null
        if (scope == null) scope = ensureBoundScope(selected)
        scope = markReleasePending(scope, selected, "logout")
        releasePendingLocked(selected, scope)
    }

    suspend fun revoke(reason: String): NativeInstallation? = mutationLane.withLock {
        val selected = installation ?: return@withLock null
        require(reason in setOf("customer_request", "device_lost", "token_compromise"))
        var scope = ensureBoundScope(selected)
        scope = markReleasePending(scope, selected, reason)
        releasePendingLocked(selected, scope)
    }

    suspend fun requestVoiceAuthorization(): VoiceAuthorization? = mutationLane.withLock {
        val selected = installation ?: return@withLock null
        if (selected.state != NativeInstallationState.active) return@withLock null
        val fcmToken = authorityStore.fcmToken() ?: return@withLock null
        val hasVoiceToken = selected.pushRegistrations.any {
            it.active && it.purpose == NativePushPurpose.voip
        }
        if (!hasVoiceToken ||
            authorityStore.registeredTokenFingerprint(
                selected.projectId,
                NativePushPurpose.voip.name,
            ) != ResponderDigest.sha256(fcmToken)) return@withLock null
        val generation = authorizationGeneration
        val semantic = "native.voice.${selected.id}.r${selected.revision}." +
            ResponderDigest.sha256(fcmToken)
        var commandId = commandLedger.idempotencyKey(semantic)
        suspend fun request(selectedCommandId: String) = ReceiptValidator.voice(
            api.requestVoipSession(
                selected.projectId,
                selected.id,
                selected.revision,
                selectedCommandId,
            ),
            selectedCommandId,
            selected,
        )
        val session = try {
            request(commandId)
        } catch (error: Throwable) {
            val expired = error is VoiceSessionExpiredException ||
                (error is ApiException && error.status == 409 &&
                    error.code == "RESPONDER_NATIVE_VOIP_SESSION_EXPIRED")
            if (!expired) throw error
            commandId = commandLedger.renewExpired(semantic, commandId)
            request(commandId)
        }
        if (generation != authorizationGeneration || installation != selected ||
            authorityStore.fcmToken() != fcmToken) {
            return@withLock null
        }
        commandLedger.complete(semantic, commandId)
        VoiceAuthorization(
            session,
            fcmToken,
            generation,
            selected.organizationId,
            selected.projectId,
            selected.customerUserId,
            selected.id,
            selected.revision,
            selected.appEnvironment,
            )
    }

    suspend fun isCurrent(value: VoiceAuthorization): Boolean = mutationLane.withLock {
        val selected = installation
        selected != null &&
            value.generation == authorizationGeneration &&
            selected.organizationId == value.organizationId &&
            selected.customerUserId == value.customerUserId &&
            selected.projectId == value.projectId &&
            selected.id == value.installationId &&
            selected.revision == value.installationRevision &&
            authorityStore.fcmToken() == value.fcmToken
    }

    suspend fun currentInstallation(): NativeInstallation? = mutationLane.withLock { installation }

    suspend fun resetSession() = mutationLane.withLock {
        authorityStore.nativeInstallationScope()?.let { scope ->
            val selected = installation
            check(
                scope.phase == NativeInstallationScopePhase.release_pending &&
                    scope.releaseReason == "logout" &&
                    selected != null &&
                    selected.state != NativeInstallationState.active &&
                    authorityStore.clearNativeInstallationScope(scope)
            ) { "Native release must be proved before resetting its session." }
        }
        installation = null
        pendingTokens.clear()
        authorizationGeneration += 1
    }

    private suspend fun createLocked(
        projectId: String,
        organizationId: String,
        customerUserId: String,
        keyDigest: String,
    ): NativeInstallation {
        val semantic = "native.create.$projectId.$keyDigest"
        val commandId = commandLedger.idempotencyKey(semantic)
        val receipt = api.createNativeInstallation(
            projectId,
            build.environment,
            build.appVersion,
            build.buildNumber,
            keyDigest,
            commandId,
        )
        val created = ReceiptValidator.nativeCreate(
            receipt,
            commandId,
            organizationId,
            projectId,
            customerUserId,
            build.environment,
            build.appVersion,
            build.buildNumber,
            keyDigest,
        )
        commandLedger.complete(semantic, commandId)
        return created
    }

    private suspend fun resumeLocked(selected: NativeInstallation): NativeInstallation {
        var current = selected
        repeat(MAX_RECONCILIATION_STEPS) {
            if (current.state == NativeInstallationState.active) return current
            if (current.state == NativeInstallationState.revoked) {
                throw ApiException(
                    "NATIVE_INSTALLATION_REVOKED",
                    "This device identity was revoked. Contact Site Sourcery before continuing.",
                    409,
                )
            }
            val evidence = ResponderDigest.nativeTransition(current.id, current.revision, "login")
            val semantic = "native.resume.${current.id}.r${current.revision}.$evidence"
            val commandId = commandLedger.idempotencyKey(semantic)
            val receipt = api.resumeNativeInstallation(
                current.projectId,
                current.id,
                current.revision,
                evidence,
                commandId,
            )
            val updated = ReceiptValidator.nativeResume(receipt, commandId, current)
            commandLedger.complete(semantic, commandId)
            current = updated
        }
        throw reconciliationRequired("resume")
    }

    private suspend fun reconcileRetirementsLocked(starting: NativeInstallation): NativeInstallation {
        var selected = starting
        for (purpose in listOf(NativePushPurpose.notification, NativePushPurpose.voip)) {
            if (authorityStore.hasRetirement(selected.projectId, purpose.name) ||
                authorityStore.hasGlobalRetirement(purpose.name)) {
                selected = retireLocked(selected, purpose)
            }
        }
        return selected
    }

    private suspend fun retireLocked(
        selected: NativeInstallation,
        purpose: NativePushPurpose,
    ): NativeInstallation {
        var current = selected
        authorityStore.markRetirement(current.projectId, purpose.name)
        repeat(MAX_RECONCILIATION_STEPS) {
            val active = current.pushRegistrations.any { it.purpose == purpose && it.active }
            if (!active) {
                authorityStore.clearRetirement(current.projectId, purpose.name)
                authorityStore.clearRegisteredTokenFingerprint(current.projectId, purpose.name)
                return current
            }
            if (current.state != NativeInstallationState.active) return current
            val evidence = ResponderDigest.nativeTokenRetirement(
                current.id,
                current.revision,
                purpose,
            )
            val semantic = "native.token.retire.${current.id}.${purpose.name}." +
                "r${current.revision}.$evidence"
            val commandId = commandLedger.idempotencyKey(semantic)
            val receipt = api.retirePushToken(
                current.projectId,
                current.id,
                current.revision,
                purpose,
                evidence,
                commandId,
            )
            val updated = ReceiptValidator.nativeRetire(
                receipt,
                commandId,
                current,
                purpose,
            )
            commandLedger.complete(semantic, commandId)
            installation = updated
            current = updated
        }
        throw reconciliationRequired("${purpose.name} retirement")
    }

    private suspend fun drainLocked(starting: NativeInstallation): NativeInstallation {
        var selected = starting
        for (purpose in listOf(NativePushPurpose.notification, NativePushPurpose.voip)) {
            val token = pendingTokens[purpose] ?: continue
            var confirmed = false
            var attempts = 0
            while (!confirmed && attempts < MAX_RECONCILIATION_STEPS) {
                attempts += 1
                if (!needsRegistration(selected, purpose, token)) {
                    confirmed = true
                    break
                }
                val priorRevision = selected.revision
                val tokenDigest = ResponderDigest.sha256(token)
                val semantic = "native.token.${selected.id}.${purpose.name}." +
                    "r$priorRevision.$tokenDigest"
                val commandId = commandLedger.idempotencyKey(semantic)
                val receipt = api.registerPushToken(
                    selected.projectId,
                    selected.id,
                    priorRevision,
                    purpose,
                    token,
                    commandId,
                )
                val updated = ReceiptValidator.nativeRegister(
                    receipt,
                    commandId,
                    selected,
                    purpose,
                    token,
                )
                commandLedger.complete(semantic, commandId)
                selected = updated
                installation = updated
                confirmed = updated.revision == priorRevision + 1 ||
                    (receipt.semanticReplay && updated.revision == priorRevision)
            }
            if (!confirmed) throw reconciliationRequired("${purpose.name} registration")
            authorityStore.saveRegisteredTokenFingerprint(selected.projectId, purpose.name, token)
            if (pendingTokens[purpose] == token) pendingTokens.remove(purpose)
        }
        return selected
    }

    private fun needsRegistration(
        selected: NativeInstallation,
        purpose: NativePushPurpose,
        token: String,
    ): Boolean {
        val active = selected.pushRegistrations.any { it.purpose == purpose && it.active }
        val fingerprint = authorityStore.registeredTokenFingerprint(
            selected.projectId,
            purpose.name,
        )
        return !active || fingerprint != ResponderDigest.sha256(token)
    }

    private fun reconciliationRequired(operation: String): ApiException = ApiException(
        "NATIVE_RECONCILIATION_REQUIRED",
        "Responder could not stabilize $operation. Refresh and try again.",
        409,
    )

    private fun ensureBoundScope(selected: NativeInstallation): NativeInstallationScope {
        val current = authorityStore.nativeInstallationScope()
        if (current != null) return bindScope(current, selected)
        val created = NativeInstallationScope(
            organizationId = selected.organizationId,
            projectId = selected.projectId,
            customerUserId = selected.customerUserId,
            installationId = selected.id,
            installationKeyDigest = selected.installationKeyDigest,
            phase = NativeInstallationScopePhase.active,
        )
        check(authorityStore.claimNativeInstallationScope(created)) {
            "Native installation scope could not be claimed."
        }
        return created
    }

    private fun bindScope(
        current: NativeInstallationScope,
        selected: NativeInstallation,
    ): NativeInstallationScope {
        require(
            current.organizationId == selected.organizationId &&
                current.projectId == selected.projectId &&
                current.customerUserId == selected.customerUserId &&
                current.installationKeyDigest == selected.installationKeyDigest &&
                (current.installationId == null || current.installationId == selected.id)
        ) { "Native installation recovery authority conflicts." }
        if (current.installationId == selected.id) return current
        val replacement = current.copy(installationId = selected.id)
        check(authorityStore.replaceNativeInstallationScope(current, replacement)) {
            "Native installation scope changed while it was being bound."
        }
        return replacement
    }

    private fun markReleasePending(
        current: NativeInstallationScope,
        selected: NativeInstallation,
        reason: String,
    ): NativeInstallationScope {
        val bound = bindScope(current, selected)
        if (bound.phase == NativeInstallationScopePhase.release_pending) {
            require(bound.releaseReason == reason) {
                "A different native release is already pending."
            }
            return bound
        }
        val replacement = bound.copy(
            phase = NativeInstallationScopePhase.release_pending,
            releaseReason = reason,
        )
        check(authorityStore.replaceNativeInstallationScope(bound, replacement)) {
            "Native release intent could not be recorded."
        }
        return replacement
    }

    private suspend fun releasePendingLocked(
        starting: NativeInstallation,
        scope: NativeInstallationScope,
    ): NativeInstallation {
        require(scope.phase == NativeInstallationScopePhase.release_pending)
        val reason = checkNotNull(scope.releaseReason)
        var selected = starting
        repeat(MAX_RECONCILIATION_STEPS) {
            val complete = if (reason == "logout") {
                selected.state != NativeInstallationState.active
            } else {
                selected.state == NativeInstallationState.revoked
            }
            if (complete) {
                if (reason != "logout") {
                    check(authorityStore.clearNativeInstallationScope(scope)) {
                        "Native release scope changed before completion."
                    }
                }
                pendingTokens.clear()
                installation = selected
                authorizationGeneration += 1
                return selected
            }
            val evidence = ResponderDigest.nativeTransition(
                selected.id,
                selected.revision,
                reason,
            )
            val semantic = if (reason == "logout") {
                "native.suspend.${selected.id}.r${selected.revision}.$evidence"
            } else {
                "native.revoke.${selected.id}.r${selected.revision}.$reason.$evidence"
            }
            val commandId = commandLedger.idempotencyKey(semantic)
            val receipt = if (reason == "logout") {
                api.suspendNativeInstallation(
                    selected.projectId,
                    selected.id,
                    selected.revision,
                    evidence,
                    commandId,
                )
            } else {
                api.revokeNativeInstallation(
                    selected.projectId,
                    selected.id,
                    selected.revision,
                    reason,
                    evidence,
                    commandId,
                )
            }
            val updated = if (reason == "logout") {
                ReceiptValidator.nativeSuspend(receipt, commandId, selected)
            } else {
                ReceiptValidator.nativeRevoke(receipt, commandId, selected, reason)
            }
            commandLedger.complete(semantic, commandId)
            installation = updated
            selected = updated
        }
        throw reconciliationRequired("release")
    }

    companion object {
        private const val MAX_RECONCILIATION_STEPS = 3
    }
}
