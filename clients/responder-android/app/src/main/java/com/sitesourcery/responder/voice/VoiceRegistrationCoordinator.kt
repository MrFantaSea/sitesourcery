package com.sitesourcery.responder.voice

import com.sitesourcery.responder.nativeclient.VoiceAuthorization
import com.sitesourcery.responder.security.DeviceAuthorityStore
import com.sitesourcery.responder.security.VoiceProviderAttempt
import com.sitesourcery.responder.security.VoiceProviderAttemptKind
import com.sitesourcery.responder.security.VoiceProviderAuthority
import com.twilio.voice.RegistrationException
import com.twilio.voice.RegistrationListener
import com.twilio.voice.UnregistrationListener
import com.twilio.voice.Voice
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

enum class VoiceRegistrationState {
    held,
    disabled,
    registering,
    registered,
    unregistering,
    retryRequired,
}

sealed interface VoiceSdkResult {
    data object Success : VoiceSdkResult
    data class Failure(val errorCode: Int?) : VoiceSdkResult
    data class Uncertain(val errorCode: Int? = null) : VoiceSdkResult
}

interface VoiceSdkPort {
    fun register(
        accessToken: String,
        fcmToken: String,
        completion: (VoiceSdkResult) -> Unit,
    )

    fun unregister(
        accessToken: String,
        fcmToken: String,
        completion: (VoiceSdkResult) -> Unit,
    )
}

class TwilioVoiceSdkPort : VoiceSdkPort {
    override fun register(
        accessToken: String,
        fcmToken: String,
        completion: (VoiceSdkResult) -> Unit,
    ) {
        Voice.register(
            accessToken,
            Voice.RegistrationChannel.FCM,
            fcmToken,
            object : RegistrationListener {
                override fun onRegistered(returnedAccessToken: String, returnedToken: String) {
                    completion(
                        if (returnedAccessToken == accessToken && returnedToken == fcmToken) {
                            VoiceSdkResult.Success
                        } else {
                            VoiceSdkResult.Uncertain()
                        }
                    )
                }

                override fun onError(
                    registrationException: RegistrationException,
                    returnedAccessToken: String,
                    returnedToken: String,
                ) {
                    completion(
                        if (returnedAccessToken == accessToken && returnedToken == fcmToken) {
                            VoiceSdkResult.Failure(registrationException.errorCode)
                        } else {
                            VoiceSdkResult.Uncertain(registrationException.errorCode)
                        }
                    )
                }
            },
        )
    }

    override fun unregister(
        accessToken: String,
        fcmToken: String,
        completion: (VoiceSdkResult) -> Unit,
    ) {
        Voice.unregister(
            accessToken,
            Voice.RegistrationChannel.FCM,
            fcmToken,
            object : UnregistrationListener {
                override fun onUnregistered(returnedAccessToken: String, returnedToken: String) {
                    completion(
                        if (returnedAccessToken == accessToken && returnedToken == fcmToken) {
                            VoiceSdkResult.Success
                        } else {
                            VoiceSdkResult.Uncertain()
                        }
                    )
                }

                override fun onError(
                    registrationException: RegistrationException,
                    returnedAccessToken: String,
                    returnedToken: String,
                ) {
                    completion(
                        if (returnedAccessToken == accessToken && returnedToken == fcmToken) {
                            VoiceSdkResult.Failure(registrationException.errorCode)
                        } else {
                            VoiceSdkResult.Uncertain(registrationException.errorCode)
                        }
                    )
                }
            },
        )
    }
}

data class VoiceRecoveryScope(
    val organizationId: String,
    val projectId: String,
    val customerUserId: String,
    val installationId: String,
)

class VoiceIncomingPermit internal constructor(
    val id: String,
    internal val authority: VoiceProviderAuthority,
)

class VoiceRegistrationCoordinator(
    private val providerConfigured: Boolean,
    private val authorityStore: DeviceAuthorityStore,
    private val sdk: VoiceSdkPort = TwilioVoiceSdkPort(),
    private val mainDispatcher: CoroutineDispatcher = Dispatchers.Main.immediate,
    private val now: () -> Instant = Instant::now,
    private val providerTimeoutMs: Long = PROVIDER_TIMEOUT_MS,
) {
    private val lane = Mutex()
    private val liveAttemptIds = ConcurrentHashMap.newKeySet<String>()
    @Volatile
    private var inheritedAttemptId: String? = authorityStore.voiceAttempt()?.id
    private var registered: VoiceProviderAuthority? = authorityStore.voiceRegistration()
    private var persistedIncomingGate: VoiceProviderAuthority? = authorityStore.voiceIncomingGate()
    private var processConfirmed: VoiceProviderAuthority? = null
    @Volatile
    private var explicitlyDisabled = authorityStore.voiceExplicitlyDisabled()

    @Volatile
    private var incomingPermit: VoiceIncomingPermit? =
        if (providerConfigured && !explicitlyDisabled &&
        inheritedAttemptId == null && persistedIncomingGate?.let { gate ->
            registered?.let { sameIncomingAuthority(it, gate) }
        } == true) {
            VoiceIncomingPermit(UUID.randomUUID().toString(), checkNotNull(persistedIncomingGate))
        } else {
            null
        }

    @Volatile
    var state: VoiceRegistrationState = when {
        !providerConfigured -> VoiceRegistrationState.held
        incomingPermit != null -> VoiceRegistrationState.registered
        registered != null || inheritedAttemptId != null -> VoiceRegistrationState.retryRequired
        else -> VoiceRegistrationState.disabled
    }
        private set

    fun currentIncomingPermit(): VoiceIncomingPermit? =
        incomingPermit?.takeIf { providerConfigured && !explicitlyDisabled }

    fun isIncomingPermitCurrent(permit: VoiceIncomingPermit): Boolean =
        providerConfigured && !explicitlyDisabled && incomingPermit == permit

    fun closeIncomingGate() {
        incomingPermit = null
        persistedIncomingGate = null
        authorityStore.closeVoiceIncomingGate()
    }

    suspend fun recoveryScope(): VoiceRecoveryScope? = lane.withLock {
        reloadLocked()
        val target = authorityStore.voiceAttempt()?.target ?: registered ?: return@withLock null
        VoiceRecoveryScope(
            target.organizationId,
            target.projectId,
            target.customerUserId,
            target.installationId,
        )
    }

    suspend fun register(
        authorization: VoiceAuthorization,
        stillCurrent: suspend () -> Boolean,
    ): Boolean = lane.withLock {
        reloadLocked()
        closeIncomingLocked()
        if (!providerConfigured || explicitlyDisabled) {
            state = if (providerConfigured) VoiceRegistrationState.disabled else VoiceRegistrationState.held
            return@withLock false
        }
        validateAuthorization(authorization)
        val desired = authority(authorization)

        val pending = authorityStore.voiceAttempt()
        if (pending != null) {
            if (liveAttemptIds.contains(pending.id) || pending.id != inheritedAttemptId) {
                state = VoiceRegistrationState.retryRequired
                return@withLock false
            }
            if (!sameProviderIdentity(pending.target, desired)) {
                state = VoiceRegistrationState.retryRequired
                return@withLock false
            }
            state = VoiceRegistrationState.unregistering
            val cleanup = retryProvider(
                VoiceProviderAttemptKind.unregister,
                authorization,
                pending.target.copy(
                    installationRevision = desired.installationRevision,
                    sessionId = desired.sessionId,
                    credentialDigest = desired.credentialDigest,
                    authorizationExpiresAt = desired.authorizationExpiresAt,
                ),
                inheritedAttemptId = pending.id,
            )
            reloadLocked()
            if (cleanup != ProviderResult.Success || registered != null ||
                authorityStore.voiceAttempt() != null) {
                state = VoiceRegistrationState.retryRequired
                return@withLock false
            }
        }

        registered?.let { current ->
            if (!sameProviderIdentity(current, desired)) {
                state = VoiceRegistrationState.retryRequired
                return@withLock false
            }
            if (!sameBinding(current, desired)) {
                state = VoiceRegistrationState.unregistering
                val cleanup = retryProvider(
                    VoiceProviderAttemptKind.unregister,
                    authorization,
                    current.copy(
                        installationRevision = desired.installationRevision,
                        sessionId = desired.sessionId,
                        credentialDigest = desired.credentialDigest,
                        authorizationExpiresAt = desired.authorizationExpiresAt,
                    ),
                )
                reloadLocked()
                if (cleanup != ProviderResult.Success || registered != null) {
                    state = VoiceRegistrationState.retryRequired
                    return@withLock false
                }
            } else if (processConfirmed?.let { sameBinding(it, desired) } == true) {
                if (!stillCurrent() || explicitlyDisabled ||
                    authorityStore.voiceExplicitlyDisabled()) {
                    state = VoiceRegistrationState.retryRequired
                    return@withLock false
                }
                authorityStore.saveVoiceRegistration(desired)
                registered = desired
                processConfirmed = desired
                openIncomingLocked(desired)
                state = VoiceRegistrationState.registered
                return@withLock true
            }
        }

        if (!stillCurrent()) {
            state = VoiceRegistrationState.disabled
            return@withLock false
        }
        state = VoiceRegistrationState.registering
        val result = retryProvider(VoiceProviderAttemptKind.register, authorization, desired)
        reloadLocked()
        if (result != ProviderResult.Success ||
            registered?.let { sameBinding(it, desired) } != true) {
            state = VoiceRegistrationState.retryRequired
            return@withLock false
        }
        processConfirmed = desired
        if (!stillCurrent() || explicitlyDisabled) {
            state = VoiceRegistrationState.unregistering
            val cleanup = retryProvider(
                VoiceProviderAttemptKind.unregister,
                authorization,
                desired,
            )
            reloadLocked()
            processConfirmed = null
            state = if (cleanup == ProviderResult.Success && registered == null) {
                VoiceRegistrationState.disabled
            } else {
                VoiceRegistrationState.retryRequired
            }
            return@withLock false
        }
        openIncomingLocked(desired)
        state = VoiceRegistrationState.registered
        true
    }

    suspend fun disable(
        freshAuthorization: suspend () -> VoiceAuthorization?,
        persistExplicitDisable: Boolean = true,
        quiesceCalls: suspend () -> Unit = {},
    ): Boolean {
        if (persistExplicitDisable) {
            explicitlyDisabled = true
            authorityStore.setVoiceExplicitlyDisabled(true)
        }
        closeIncomingGate()
        quiesceCalls()
        return lane.withLock {
            if (persistExplicitDisable) explicitlyDisabled = true
            closeIncomingLocked()
            reloadLocked()

            var pending = authorityStore.voiceAttempt()
        if (pending != null && liveAttemptIds.contains(pending.id)) {
            awaitAttemptSettlement(pending.id)
            reloadLocked()
            pending = authorityStore.voiceAttempt()
            if (pending != null) {
                state = VoiceRegistrationState.retryRequired
                return@withLock false
            }
        }

            val authorization = if (pending != null || registered != null) {
            freshAuthorization()
        } else {
            null
        }
            if (pending != null) {
            if (pending.id != inheritedAttemptId || authorization == null) {
                state = VoiceRegistrationState.retryRequired
                return@withLock false
            }
            validateAuthorization(authorization)
            val currentAuthority = authority(authorization)
            if (!sameProviderIdentity(pending.target, currentAuthority)) {
                state = VoiceRegistrationState.retryRequired
                return@withLock false
            }
            state = VoiceRegistrationState.unregistering
            val cleanup = retryProvider(
                VoiceProviderAttemptKind.unregister,
                authorization,
                pending.target.copy(
                    installationRevision = currentAuthority.installationRevision,
                    sessionId = currentAuthority.sessionId,
                    credentialDigest = currentAuthority.credentialDigest,
                    authorizationExpiresAt = currentAuthority.authorizationExpiresAt,
                ),
                inheritedAttemptId = pending.id,
            )
            reloadLocked()
            processConfirmed = null
            if (cleanup != ProviderResult.Success || registered != null ||
                authorityStore.voiceAttempt() != null) {
                state = VoiceRegistrationState.retryRequired
                return@withLock false
            }
        }

            val target = registered
            if (target == null) {
            processConfirmed = null
            state = if (providerConfigured) VoiceRegistrationState.disabled else VoiceRegistrationState.held
            return@withLock true
        }
            if (!providerConfigured || authorization == null) {
            state = if (providerConfigured) VoiceRegistrationState.retryRequired else VoiceRegistrationState.held
            return@withLock false
        }
            validateAuthorization(authorization)
            val currentAuthority = authority(authorization)
            if (!sameProviderIdentity(target, currentAuthority)) {
            state = VoiceRegistrationState.retryRequired
            return@withLock false
        }
            state = VoiceRegistrationState.unregistering
            val removed = retryProvider(
            VoiceProviderAttemptKind.unregister,
            authorization,
            target.copy(
                installationRevision = currentAuthority.installationRevision,
                sessionId = currentAuthority.sessionId,
                credentialDigest = currentAuthority.credentialDigest,
                authorizationExpiresAt = currentAuthority.authorizationExpiresAt,
            ),
        )
            reloadLocked()
            processConfirmed = null
            if (removed == ProviderResult.Success && registered == null &&
            authorityStore.voiceAttempt() == null) {
            state = VoiceRegistrationState.disabled
            true
            } else {
            state = VoiceRegistrationState.retryRequired
            false
            }
        }
    }

    suspend fun enable() = lane.withLock {
        explicitlyDisabled = false
        authorityStore.setVoiceExplicitlyDisabled(false)
        closeIncomingLocked()
        reloadLocked()
        state = if (!providerConfigured) {
            VoiceRegistrationState.held
        } else if (registered != null || authorityStore.voiceAttempt() != null) {
            VoiceRegistrationState.retryRequired
        } else {
            VoiceRegistrationState.disabled
        }
    }

    suspend fun isExplicitlyEnabled(): Boolean = lane.withLock { !explicitlyDisabled }

    suspend fun hasRegistration(): Boolean = lane.withLock {
        reloadLocked()
        registered != null || authorityStore.voiceAttempt() != null
    }

    private suspend fun retryProvider(
        kind: VoiceProviderAttemptKind,
        authorization: VoiceAuthorization,
        target: VoiceProviderAuthority,
        inheritedAttemptId: String? = null,
    ): ProviderResult {
        repeat(BACKOFF_MS.size + 1) { attemptIndex ->
            if (attemptIndex > 0) delay(BACKOFF_MS[attemptIndex - 1])
            val result = callProvider(
                kind,
                authorization,
                target,
                if (attemptIndex == 0) inheritedAttemptId else null,
            )
            when (result) {
                ProviderResult.Success -> return result
                ProviderResult.Uncertain -> return result
                is ProviderResult.Failure -> if (!result.retryable) return result
            }
        }
        return ProviderResult.Failure(retryable = false)
    }

    private suspend fun callProvider(
        kind: VoiceProviderAttemptKind,
        authorization: VoiceAuthorization,
        target: VoiceProviderAuthority,
        inheritedAttemptId: String?,
    ): ProviderResult {
        if (expiresSoon(authorization.session.expiresAt, 5)) {
            return ProviderResult.Failure(retryable = false)
        }
        val attempt = VoiceProviderAttempt(
            id = UUID.randomUUID().toString(),
            kind = kind,
            target = target,
            startedAt = now().toString(),
        )
        val claimed = if (inheritedAttemptId == null) {
            authorityStore.recordVoiceAttempt(attempt)
        } else {
            authorityStore.replaceVoiceAttemptForCleanup(inheritedAttemptId, attempt).also {
                if (it) this.inheritedAttemptId = null
            }
        }
        if (!claimed) return ProviderResult.Uncertain
        liveAttemptIds.add(attempt.id)
        val result = try {
            withContext(mainDispatcher) {
                withTimeoutOrNull(providerTimeoutMs) {
                    suspendCancellableCoroutine<VoiceSdkResult> { continuation ->
                        val completion: (VoiceSdkResult) -> Unit = { sdkResult ->
                            when (sdkResult) {
                                VoiceSdkResult.Success -> {
                                    authorityStore.resolveVoiceAttempt(attempt.id, true)
                                    liveAttemptIds.remove(attempt.id)
                                }
                                is VoiceSdkResult.Failure -> {
                                    authorityStore.resolveVoiceAttempt(attempt.id, false)
                                    liveAttemptIds.remove(attempt.id)
                                }
                                is VoiceSdkResult.Uncertain -> {
                                    preserveUncertainAttempt(attempt.id)
                                }
                            }
                            if (continuation.isActive) continuation.resume(sdkResult)
                        }
                        try {
                            if (kind == VoiceProviderAttemptKind.register) {
                                sdk.register(
                                    authorization.session.accessToken,
                                    target.fcmToken,
                                    completion,
                                )
                            } else {
                                sdk.unregister(
                                    authorization.session.accessToken,
                                    target.fcmToken,
                                    completion,
                                )
                            }
                        } catch (_: Exception) {
                            completion(VoiceSdkResult.Uncertain())
                        }
                    }
                }
            }
        } catch (error: Exception) {
            preserveUncertainAttempt(attempt.id)
            if (error is CancellationException) throw error
            VoiceSdkResult.Uncertain()
        }
        if (result == null) preserveUncertainAttempt(attempt.id)
        return when (result) {
            VoiceSdkResult.Success -> ProviderResult.Success
            is VoiceSdkResult.Failure -> ProviderResult.Failure(
                retryable = result.errorCode in RETRYABLE_PROVIDER_CODES,
            )
            is VoiceSdkResult.Uncertain, null -> ProviderResult.Uncertain
        }
    }

    private suspend fun awaitAttemptSettlement(attemptId: String) {
        withTimeoutOrNull(SETTLEMENT_WAIT_MS) {
            while (authorityStore.voiceAttempt()?.id == attemptId) delay(50)
        }
    }

    private fun validateAuthorization(value: VoiceAuthorization) {
        require(value.session.clientPlatform.name == "android")
        require(value.session.transport == "twilio_voice_android")
        require(value.session.organizationId == value.organizationId)
        require(value.session.projectId == value.projectId)
        require(value.session.customerUserId == value.customerUserId)
        require(value.session.installationId == value.installationId)
        require(value.session.installationRevision == value.installationRevision)
        require(value.session.appEnvironment == value.appEnvironment)
        require(!expiresSoon(value.session.expiresAt, 10))
    }

    private fun authority(value: VoiceAuthorization): VoiceProviderAuthority =
        VoiceProviderAuthority(
            organizationId = value.organizationId,
            projectId = value.projectId,
            customerUserId = value.customerUserId,
            installationId = value.installationId,
            installationRevision = value.installationRevision,
            appEnvironment = value.appEnvironment.name,
            clientPlatform = value.session.clientPlatform.name,
            transport = value.session.transport,
            fcmToken = value.fcmToken,
            sessionId = value.session.sessionId,
            identityDigest = value.session.identityDigest,
            credentialDigest = value.session.credentialDigest,
            authorizationExpiresAt = value.session.expiresAt,
        )

    private fun sameProviderIdentity(
        left: VoiceProviderAuthority,
        right: VoiceProviderAuthority,
    ): Boolean =
        left.organizationId == right.organizationId &&
            left.projectId == right.projectId &&
            left.customerUserId == right.customerUserId &&
            left.installationId == right.installationId &&
            left.appEnvironment == right.appEnvironment &&
            left.clientPlatform == right.clientPlatform &&
            left.transport == right.transport &&
            left.identityDigest == right.identityDigest &&
            left.credentialDigest == right.credentialDigest

    private fun sameBinding(
        left: VoiceProviderAuthority,
        right: VoiceProviderAuthority,
    ): Boolean = sameProviderIdentity(left, right) && left.fcmToken == right.fcmToken

    private fun expiresSoon(expiresAt: String, seconds: Long): Boolean =
        !Instant.parse(expiresAt).isAfter(now().plusSeconds(seconds))

    private fun reloadLocked() {
        registered = authorityStore.voiceRegistration()
        persistedIncomingGate = authorityStore.voiceIncomingGate()
        if (processConfirmed != null &&
            registered?.let { sameBinding(it, checkNotNull(processConfirmed)) } != true) {
            processConfirmed = null
        }
    }

    private fun closeIncomingLocked() {
        incomingPermit = null
        persistedIncomingGate = null
        authorityStore.closeVoiceIncomingGate()
    }

    private fun openIncomingLocked(value: VoiceProviderAuthority) {
        explicitlyDisabled = authorityStore.voiceExplicitlyDisabled()
        check(!explicitlyDisabled && authorityStore.openVoiceIncomingGate(value))
        persistedIncomingGate = value
        incomingPermit = VoiceIncomingPermit(UUID.randomUUID().toString(), value)
    }

    private fun sameIncomingAuthority(
        left: VoiceProviderAuthority,
        right: VoiceProviderAuthority,
    ): Boolean = left == right

    private fun preserveUncertainAttempt(attemptId: String) {
        liveAttemptIds.remove(attemptId)
        if (authorityStore.voiceAttempt()?.id == attemptId) {
            inheritedAttemptId = attemptId
        }
    }

    private sealed interface ProviderResult {
        data object Success : ProviderResult
        data object Uncertain : ProviderResult
        data class Failure(val retryable: Boolean) : ProviderResult
    }

    companion object {
        private const val PROVIDER_TIMEOUT_MS = 8_000L
        private const val SETTLEMENT_WAIT_MS = 1_000L
        private val BACKOFF_MS = longArrayOf(250, 500, 1_000)
        private val RETRYABLE_PROVIDER_CODES = setOf(
            31408,
            31429,
            31500,
            31502,
            31503,
            31504,
        )
    }
}
