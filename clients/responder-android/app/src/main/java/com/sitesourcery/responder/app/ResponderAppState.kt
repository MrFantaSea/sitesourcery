package com.sitesourcery.responder.app

import com.sitesourcery.responder.core.CommandLedger
import com.sitesourcery.responder.core.ForwardingList
import com.sitesourcery.responder.core.NativeInstallation
import com.sitesourcery.responder.core.OrganizationSummary
import com.sitesourcery.responder.core.ProjectSummary
import com.sitesourcery.responder.core.ReceiptValidator
import com.sitesourcery.responder.core.ResponderCapabilities
import com.sitesourcery.responder.core.ResponderDashboard
import com.sitesourcery.responder.core.ResponderDigest
import com.sitesourcery.responder.core.UserSummary
import com.sitesourcery.responder.nativeclient.NativeRegistrationCoordinator
import com.sitesourcery.responder.network.ApiException
import com.sitesourcery.responder.network.ResponderApi
import com.sitesourcery.responder.voice.VoiceRegistrationState
import com.sitesourcery.responder.voice.VoiceRecoveryScope
import java.time.Instant
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

enum class LaunchPhase { starting, signedOut, selectingWorkspace, ready, configurationFailure }

data class ResponderUiState(
    val phase: LaunchPhase = LaunchPhase.starting,
    val user: UserSummary? = null,
    val organizations: List<OrganizationSummary> = emptyList(),
    val projects: List<ProjectSummary> = emptyList(),
    val selectedOrganization: OrganizationSummary? = null,
    val selectedProject: ProjectSummary? = null,
    val capabilities: ResponderCapabilities? = null,
    val dashboard: ResponderDashboard? = null,
    val forwarding: ForwardingList? = null,
    val installation: NativeInstallation? = null,
    val notificationPermission: String = "not_requested",
    val microphonePermission: String = "not_requested",
    val voiceState: VoiceRegistrationState = VoiceRegistrationState.held,
    val busy: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
) {
    val forwardingReady: Boolean
        get() = capabilities?.responderForwarding?.let { it.ready && it.mounted } == true

    val nativeBackendReady: Boolean
        get() = capabilities?.responderNativeClient?.let { it.backendReady && it.mounted } == true

    val allExternalEffectsHeld: Boolean
        get() = capabilities?.let {
            !it.responderForwarding.providerEffects &&
                !it.responderForwarding.remoteWriteEffects &&
                !it.responderForwarding.messageSendEffects &&
                !it.responderNativeClient.providerAuthorizationEffects &&
                !it.responderNativeClient.providerEffects &&
                !it.responderNativeClient.pushDeliveryEffects &&
                !it.responderNativeClient.voiceCallEffects &&
                !it.responderNativeClient.carrierCommandEffects &&
                !it.responderNativeClient.messageSendEffects
        } ?: true
}

internal fun authenticationOnlySignOutRequired(
    currentUserId: String?,
    recoveryActorIds: Set<String>,
    recoveryScopesCongruent: Boolean,
): Boolean = currentUserId != null && recoveryActorIds.isNotEmpty() &&
    (!recoveryScopesCongruent || recoveryActorIds != setOf(currentUserId))

class ResponderAppState(
    private val api: ResponderApi,
    private val commandLedger: CommandLedger,
    private val nativeRegistration: NativeRegistrationCoordinator,
    private val prepareVoice: suspend () -> Boolean,
    private val disableVoice: suspend () -> Boolean,
    private val enableVoice: suspend () -> Unit,
    private val voiceState: () -> VoiceRegistrationState,
    private val voiceRecoveryScope: suspend () -> VoiceRecoveryScope?,
) {
    private val operationLane = Mutex()
    private val mutable = MutableStateFlow(ResponderUiState())
    val state: StateFlow<ResponderUiState> = mutable.asStateFlow()

    suspend fun launch() = perform {
        val me = api.me()
        mutable.value = mutable.value.copy(
            user = me.user,
            organizations = me.organizations.orEmpty(),
            phase = if (me.user == null) LaunchPhase.signedOut else LaunchPhase.selectingWorkspace,
        )
        if (me.user != null) chooseInitialWorkspace()
    }

    suspend fun signIn(email: String, password: String) = perform {
        require(email.isNotBlank() && password.length >= 12)
        val semantic = "auth.signin.${ResponderDigest.sha256(email.lowercase())}"
        val commandId = commandLedger.idempotencyKey(semantic)
        val authenticated = api.signIn(email, password, commandId)
        commandLedger.complete(semantic, commandId)
        val me = api.me()
        mutable.value = mutable.value.copy(
            user = authenticated.user,
            organizations = me.organizations.orEmpty(),
            phase = LaunchPhase.selectingWorkspace,
            notice = null,
        )
        chooseInitialWorkspace()
    }

    suspend fun register(
        name: String,
        organizationName: String,
        email: String,
        password: String,
    ) = perform {
        require(name.isNotBlank() && organizationName.isNotBlank())
        require(email.isNotBlank() && password.length >= 12)
        val semantic = "auth.register.${ResponderDigest.sha256(email.lowercase())}"
        val commandId = commandLedger.idempotencyKey(semantic)
        val response = api.register(name, organizationName, email, password, commandId)
        require(response.accepted && response.verificationRequired)
        commandLedger.complete(semantic, commandId)
        mutable.value = mutable.value.copy(
            notice = "Registration accepted. Enter the verification token sent to your email.",
        )
    }

    suspend fun completeRegistration(token: String) = perform {
        require(token.isNotBlank())
        val semantic = "auth.verify.${ResponderDigest.sha256(token)}"
        val commandId = commandLedger.idempotencyKey(semantic)
        val authenticated = api.completeRegistration(token, commandId)
        commandLedger.complete(semantic, commandId)
        val me = api.me()
        mutable.value = mutable.value.copy(
            user = authenticated.user,
            organizations = me.organizations.orEmpty(),
            notice = null,
            phase = LaunchPhase.selectingWorkspace,
        )
        chooseInitialWorkspace()
    }

    suspend fun requestRecovery(email: String) = perform {
        require(email.isNotBlank())
        val semantic = "auth.recovery.${ResponderDigest.sha256(email.lowercase())}"
        val commandId = commandLedger.idempotencyKey(semantic)
        val response = api.requestRecovery(email, commandId)
        require(response.accepted)
        commandLedger.complete(semantic, commandId)
        mutable.value = mutable.value.copy(
            notice = "If the account exists, recovery instructions were sent.",
        )
    }

    suspend fun completeRecovery(token: String, password: String) = perform {
        require(token.isNotBlank() && password.length >= 12)
        val semantic = "auth.recovery.complete.${ResponderDigest.sha256(token)}"
        val commandId = commandLedger.idempotencyKey(semantic)
        require(api.completeRecovery(token, password, commandId).completed)
        commandLedger.complete(semantic, commandId)
        mutable.value = mutable.value.copy(notice = "Password updated. Sign in to continue.")
    }

    suspend fun selectOrganization(organization: OrganizationSummary) = perform {
        requireRecoveryScope(organization.id, null)
        releaseWorkspaceAuthorityIfNeeded(organization.id, null)
        api.selectOrganization(organization.id)
        val projects = api.projects(organization.id).projects
        mutable.value = mutable.value.copy(
            selectedOrganization = organization,
            selectedProject = null,
            projects = projects,
            phase = LaunchPhase.selectingWorkspace,
        )
        if (projects.size == 1) selectProjectInternal(organization, projects.single())
    }

    suspend fun selectProject(project: ProjectSummary) = perform {
        val organization = mutable.value.selectedOrganization
            ?: throw IllegalStateException("Choose a business first.")
        selectProjectInternal(organization, project)
    }

    suspend fun refreshWorkspace() = perform {
        refreshWorkspaceInternal()
    }

    suspend fun createForwarding(
        businessLine: String,
        numberBindingId: String,
    ) = perform {
        val project = requireProject()
        val organization = requireOrganization()
        val user = requireUser()
        val bindingId = ResponderApi.validUuid(numberBindingId)
        val acceptedAt = Instant.now().toString()
        val evidence = ResponderDigest.forwardingConsent(
            project.id,
            bindingId,
            businessLine,
            acceptedAt,
        )
        val semantic = "forwarding.create.${project.id}." +
            "${ResponderDigest.sha256(bindingId)}.$evidence"
        val commandId = commandLedger.idempotencyKey(semantic)
        val receipt = api.createForwarding(
            project.id,
            businessLine,
            evidence,
            bindingId,
            commandId,
        )
        ReceiptValidator.forwardingCreate(
            receipt,
            commandId,
            organization.id,
            project.id,
            user.id,
            bindingId,
        )
        commandLedger.complete(semantic, commandId)
        mutable.value = mutable.value.copy(
            forwarding = loadForwarding(organization.id, project.id, user.id),
            notice = "Forwarding request recorded. Carrier setup remains human-executed.",
        )
    }

    suspend fun retireForwarding(onboardingId: String, revision: Int) = perform {
        val project = requireProject()
        val organization = requireOrganization()
        val user = requireUser()
        val prior = mutable.value.forwarding?.onboardings?.singleOrNull {
            it.id == onboardingId && it.revision == revision
        } ?: throw ApiException(
            "RESPONDER_FORWARDING_STATE_REQUIRED",
            "Refresh the forwarding setup before cancelling it.",
            409,
        )
        val evidence = ResponderDigest.forwardingCancellation(onboardingId, revision)
        val semantic = "forwarding.cancel.$onboardingId.r$revision.$evidence"
        val commandId = commandLedger.idempotencyKey(semantic)
        val receipt = api.retireForwarding(
            project.id,
            onboardingId,
            revision,
            evidence,
            commandId,
        )
        ReceiptValidator.forwardingRetire(
            receipt,
            commandId,
            prior,
            revision,
        )
        commandLedger.complete(semantic, commandId)
        mutable.value = mutable.value.copy(
            forwarding = loadForwarding(organization.id, project.id, user.id),
            notice = "Cancellation recorded. Complete the displayed carrier cancellation steps.",
        )
    }

    suspend fun signOut() = perform {
        val voiceRecovery = voiceRecoveryScope()
        val nativeRecovery = nativeRegistration.recoveryScope()
        val recoveryActors = buildSet {
            voiceRecovery?.customerUserId?.let { add(it) }
            nativeRecovery?.customerUserId?.let { add(it) }
        }
        val recoveryScopesCongruent = voiceRecovery == null || nativeRecovery == null ||
            (voiceRecovery.organizationId == nativeRecovery.organizationId &&
                voiceRecovery.projectId == nativeRecovery.projectId &&
                voiceRecovery.customerUserId == nativeRecovery.customerUserId &&
                (nativeRecovery.installationId == null ||
                    voiceRecovery.installationId == nativeRecovery.installationId))
        if (authenticationOnlySignOutRequired(
                mutable.value.user?.id,
                recoveryActors,
                recoveryScopesCongruent,
            )) {
            revokeAuthenticatedSession()
            mutable.value = ResponderUiState(
                phase = LaunchPhase.signedOut,
                voiceState = voiceState(),
            )
            return@perform
        }
        val released = disableVoice()
        if (!released) {
            throw ApiException(
                "VOICE_DEREGISTRATION_REQUIRED",
                "Responder must confirm Voice deregistration before sign-out. Try again.",
                409,
            )
        }
        nativeRegistration.suspendForLogout()
        revokeAuthenticatedSession()
        nativeRegistration.resetSession()
        mutable.value = ResponderUiState(
            phase = LaunchPhase.signedOut,
            voiceState = voiceState(),
        )
    }

    suspend fun enableVoiceAndRefresh() = perform {
        enableVoice()
        prepareVoice()
        mutable.value = mutable.value.copy(voiceState = voiceState())
    }

    fun updatePermissions(notification: String, microphone: String) {
        mutable.value = mutable.value.copy(
            notificationPermission = notification,
            microphonePermission = microphone,
        )
    }

    fun clearError() {
        mutable.value = mutable.value.copy(error = null)
    }

    fun clearNotice() {
        mutable.value = mutable.value.copy(notice = null)
    }

    fun acceptNativeUpdate(installation: NativeInstallation) {
        val current = mutable.value.selectedProject
        val organization = mutable.value.selectedOrganization
        val user = mutable.value.user
        if (current == null || organization == null || user == null) return
        ReceiptValidator.nativeInstallation(
            installation,
            organization.id,
            current.id,
            user.id,
        )
        mutable.value = mutable.value.copy(installation = installation)
    }

    fun acceptBackgroundFailure(error: Throwable) {
        mutable.value = mutable.value.copy(error = safeMessage(error))
    }

    fun refreshVoiceState() {
        mutable.value = mutable.value.copy(voiceState = voiceState())
    }

    private suspend fun chooseInitialWorkspace() {
        val organizations = mutable.value.organizations
        val user = mutable.value.user
        val recovery = combinedRecoveryScope()
        if (recovery != null) {
            if (user?.id != recovery.customerUserId) {
                throw ApiException(
                    "DEVICE_RECOVERY_ACTOR_REQUIRED",
                    "Sign in as the customer who owns the pending device cleanup.",
                    409,
                )
            }
            val selected = organizations.firstOrNull { it.id == recovery.organizationId }
                ?: throw ApiException(
                    "DEVICE_RECOVERY_WORKSPACE_REQUIRED",
                    "The business needed to finish device cleanup is unavailable.",
                    409,
                )
            api.selectOrganization(selected.id)
            val projects = api.projects(selected.id).projects
            val project = projects.firstOrNull { it.id == recovery.projectId }
                ?: throw ApiException(
                    "DEVICE_RECOVERY_WORKSPACE_REQUIRED",
                    "The project needed to finish device cleanup is unavailable.",
                    409,
                )
            mutable.value = mutable.value.copy(
                selectedOrganization = selected,
                projects = projects,
                phase = LaunchPhase.selectingWorkspace,
            )
            selectProjectInternal(selected, project)
            return
        }
        if (organizations.size == 1) {
            val selected = organizations.single()
            api.selectOrganization(selected.id)
            val projects = api.projects(selected.id).projects
            mutable.value = mutable.value.copy(
                selectedOrganization = selected,
                projects = projects,
                phase = LaunchPhase.selectingWorkspace,
            )
            if (projects.size == 1) selectProjectInternal(selected, projects.single())
        } else {
            mutable.value = mutable.value.copy(phase = LaunchPhase.selectingWorkspace)
        }
    }

    private suspend fun selectProjectInternal(
        organization: OrganizationSummary,
        project: ProjectSummary,
    ) {
        requireRecoveryScope(organization.id, project.id)
        releaseWorkspaceAuthorityIfNeeded(organization.id, project.id)
        api.selectOrganization(organization.id)
        mutable.value = mutable.value.copy(
            selectedOrganization = organization,
            selectedProject = project,
            phase = LaunchPhase.ready,
            capabilities = null,
            dashboard = null,
            forwarding = null,
            installation = null,
        )
        refreshWorkspaceInternal()
    }

    private suspend fun releaseWorkspaceAuthorityIfNeeded(
        nextOrganizationId: String,
        nextProjectId: String?,
    ) {
        val currentOrganization = mutable.value.selectedOrganization ?: return
        val currentProject = mutable.value.selectedProject ?: return
        if (currentOrganization.id == nextOrganizationId && currentProject.id == nextProjectId) return
        api.selectOrganization(currentOrganization.id)
        if (!disableVoice()) {
            throw ApiException(
                "VOICE_DEREGISTRATION_REQUIRED",
                "Finish releasing the current Voice registration before switching workspaces.",
                409,
            )
        }
        nativeRegistration.suspendForLogout()
        nativeRegistration.resetSession()
    }

    private suspend fun refreshWorkspaceInternal() {
        val project = requireProject()
        val organization = requireOrganization()
        val user = requireUser()
        val capabilities = api.capabilities()
        val dashboard = ReceiptValidator.dashboard(
            api.responderDashboard(),
            organization.id,
            user.id,
        )
        val forwarding = loadForwarding(organization.id, project.id, user.id)
        val installation = nativeRegistration.establish(
            project.id,
            organization.id,
            user.id,
        )
        mutable.value = mutable.value.copy(
            capabilities = capabilities,
            dashboard = dashboard,
            forwarding = forwarding,
            installation = installation,
            phase = LaunchPhase.ready,
            voiceState = voiceState(),
        )
        prepareVoice()
        mutable.value = mutable.value.copy(voiceState = voiceState())
    }

    private fun requireProject(): ProjectSummary = mutable.value.selectedProject
        ?: throw IllegalStateException("Choose a project first.")

    private fun requireOrganization(): OrganizationSummary = mutable.value.selectedOrganization
        ?: throw IllegalStateException("Choose a business first.")

    private fun requireUser(): UserSummary = mutable.value.user
        ?: throw IllegalStateException("Sign in first.")

    private suspend fun loadForwarding(
        organizationId: String,
        projectId: String,
        customerUserId: String,
    ): ForwardingList = ReceiptValidator.forwardingList(
        api.forwarding(projectId),
        organizationId,
        projectId,
        customerUserId,
    )

    private suspend fun requireRecoveryScope(
        organizationId: String,
        projectId: String?,
    ) {
        val recovery = combinedRecoveryScope() ?: return
        val currentOrganization = mutable.value.selectedOrganization?.id
        val currentProject = mutable.value.selectedProject?.id
        if (currentOrganization == recovery.organizationId &&
            currentProject == recovery.projectId) return
        if (organizationId != recovery.organizationId ||
            (projectId != null && projectId != recovery.projectId)) {
            throw ApiException(
                "DEVICE_RECOVERY_WORKSPACE_REQUIRED",
                "Finish pending device cleanup in its original workspace first.",
                409,
            )
        }
    }

    private suspend fun combinedRecoveryScope(): WorkspaceRecoveryScope? {
        val voice = voiceRecoveryScope()
        val native = nativeRegistration.recoveryScope()
        if (voice != null && native != null &&
            (voice.organizationId != native.organizationId ||
                voice.projectId != native.projectId ||
                voice.customerUserId != native.customerUserId ||
                (native.installationId != null &&
                    voice.installationId != native.installationId))) {
            throw ApiException(
                "DEVICE_RECOVERY_CONFLICT",
                "Voice and push authority require operator reconciliation before continuing.",
                409,
            )
        }
        return voice?.let {
            WorkspaceRecoveryScope(
                organizationId = it.organizationId,
                projectId = it.projectId,
                customerUserId = it.customerUserId,
                installationId = it.installationId,
            )
        } ?: native?.let {
            WorkspaceRecoveryScope(
                organizationId = it.organizationId,
                projectId = it.projectId,
                customerUserId = it.customerUserId,
                installationId = it.installationId,
            )
        }
    }

    private suspend fun revokeAuthenticatedSession() {
        val semantic = "auth.signout.${mutable.value.user?.id ?: "session"}"
        val commandId = commandLedger.idempotencyKey(semantic)
        api.signOut(commandId)
        commandLedger.complete(semantic, commandId)
    }

    private data class WorkspaceRecoveryScope(
        val organizationId: String,
        val projectId: String,
        val customerUserId: String,
        val installationId: String?,
    )

    private suspend fun perform(block: suspend () -> Unit) = operationLane.withLock {
        mutable.value = mutable.value.copy(busy = true, error = null)
        try {
            block()
        } catch (error: Throwable) {
            mutable.value = mutable.value.copy(
                error = safeMessage(error),
                phase = if (mutable.value.phase == LaunchPhase.starting) {
                    LaunchPhase.signedOut
                } else {
                    mutable.value.phase
                },
            )
        } finally {
            mutable.value = mutable.value.copy(busy = false, voiceState = voiceState())
        }
    }

    private fun safeMessage(error: Throwable): String = when (error) {
        is ApiException -> error.requestId?.let { "${error.message} Reference: $it" } ?: error.message
        is IllegalArgumentException -> "Check the entered information and try again."
        else -> "Responder could not finish that request. Try again."
    }
}
