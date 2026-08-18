import AVFAudio
import Foundation
import SwiftUI
import UIKit
import UserNotifications

@MainActor
final class AppModel: ObservableObject {
    enum LaunchState: Equatable {
        case starting
        case signedOut
        case selectingWorkspace
        case ready
        case configurationFailure(String)
    }

    @Published private(set) var launchState: LaunchState = .starting
    @Published private(set) var user: UserSummary?
    @Published private(set) var organizations: [OrganizationSummary] = []
    @Published private(set) var projects: [ProjectSummary] = []
    @Published private(set) var selectedOrganization: OrganizationSummary?
    @Published private(set) var selectedProject: ProjectSummary?
    @Published private(set) var capabilities: ResponderCapabilities?
    @Published private(set) var dashboard: ResponderDashboard?
    @Published private(set) var forwarding: ForwardingList?
    @Published private(set) var nativeInstallation: NativeInstallation?
    @Published private(set) var notificationAuthorization = "not_requested"
    @Published private(set) var microphoneAuthorization = "not_requested"
    @Published private(set) var voiceTransportState = "held"
    @Published private(set) var isBusy = false
    @Published var presentedError: String?

    var onVoiceSession: ((NativeVoiceSession, Data) -> Void)?
    var onVoiceDisable: ((NativeVoiceSession?, Data?) async -> Bool)?

    private let configuration: AppConfiguration?
    private let api: ResponderAPIClient?
    private let secureStore = KeychainStore()
    private let commandLedger: CommandLedger?
    private let pushRegistration: PushRegistrationCoordinator?
    private var currentNotificationToken: Data?
    private var currentVoIPToken: Data?
    private var voiceAuthorizationGeneration = 0

    init() {
        do {
            let configuration = try AppConfiguration.current()
            let api = try ResponderAPIClient(
                baseURL: configuration.apiBaseURL,
                session: configuration.makeSession()
            )
            let ledger = CommandLedger(store: secureStore)
            self.configuration = configuration
            self.api = api
            self.commandLedger = ledger
            self.pushRegistration = PushRegistrationCoordinator(
                api: api,
                configuration: configuration,
                secureStore: secureStore,
                commandLedger: ledger
            )
        } catch {
            self.configuration = nil
            self.api = nil
            self.commandLedger = nil
            self.pushRegistration = nil
            self.launchState = .configurationFailure(error.localizedDescription)
        }
    }

    var forwardingReady: Bool {
        capabilities?.responderForwarding.ready == true &&
            capabilities?.responderForwarding.mounted == true
    }

    var nativeBackendReady: Bool {
        capabilities?.responderNativeClient.backendReady == true &&
            capabilities?.responderNativeClient.mounted == true
    }

    var allExternalEffectsHeld: Bool {
        guard let capabilities else { return true }
        return !capabilities.responderForwarding.providerEffects &&
            !capabilities.responderForwarding.remoteWriteEffects &&
            !capabilities.responderForwarding.messageSendEffects &&
            !capabilities.responderNativeClient.providerAuthorizationEffects &&
            !capabilities.responderNativeClient.providerEffects &&
            !capabilities.responderNativeClient.pushDeliveryEffects &&
            !capabilities.responderNativeClient.voiceCallEffects &&
            !capabilities.responderNativeClient.carrierCommandEffects &&
            !capabilities.responderNativeClient.messageSendEffects
    }

    func launch() async {
        guard let api else { return }
        await refreshSystemAuthorization()
        await perform {
            let me = try await api.me()
            self.user = me.user
            self.organizations = me.organizations ?? []
            if me.user == nil {
                self.launchState = .signedOut
            } else {
                try await self.chooseInitialWorkspace()
            }
        }
    }

    func signIn(email: String, password: String) async {
        guard let api, let commandLedger else { return }
        await perform {
            let semantic = "auth.signin.\(ResponderDigest.sha256(email.lowercased()))"
            let commandId = try await commandLedger.idempotencyKey(for: semantic)
            let authenticated = try await api.signIn(
                email: email,
                password: password,
                idempotencyKey: commandId
            )
            try await commandLedger.complete(
                semanticIdentity: semantic,
                idempotencyKey: commandId
            )
            self.user = authenticated.user
            let me = try await api.me()
            self.organizations = me.organizations ?? []
            try await self.chooseInitialWorkspace()
        }
    }

    func register(
        name: String,
        organizationName: String,
        email: String,
        password: String
    ) async -> Bool {
        guard let api, let commandLedger else { return false }
        var accepted = false
        await perform {
            let semantic = "auth.register.\(ResponderDigest.sha256(email.lowercased()))"
            let commandId = try await commandLedger.idempotencyKey(for: semantic)
            let response = try await api.register(
                name: name,
                organizationName: organizationName,
                email: email,
                password: password,
                idempotencyKey: commandId
            )
            try await commandLedger.complete(
                semanticIdentity: semantic,
                idempotencyKey: commandId
            )
            accepted = response.accepted && response.verificationRequired
        }
        return accepted
    }

    func completeRegistration(token: String) async {
        guard let api, let commandLedger else { return }
        await perform {
            let semantic = "auth.verify.\(ResponderDigest.sha256(token))"
            let commandId = try await commandLedger.idempotencyKey(for: semantic)
            let authenticated = try await api.completeRegistration(
                token: token,
                idempotencyKey: commandId
            )
            try await commandLedger.complete(
                semanticIdentity: semantic,
                idempotencyKey: commandId
            )
            self.user = authenticated.user
            let me = try await api.me()
            self.organizations = me.organizations ?? []
            try await self.chooseInitialWorkspace()
        }
    }

    func requestRecovery(email: String) async -> Bool {
        guard let api, let commandLedger else { return false }
        var accepted = false
        await perform {
            let semantic = "auth.recovery.request.\(ResponderDigest.sha256(email.lowercased()))"
            let commandId = try await commandLedger.idempotencyKey(for: semantic)
            let response = try await api.requestRecovery(
                email: email,
                idempotencyKey: commandId
            )
            try await commandLedger.complete(
                semanticIdentity: semantic,
                idempotencyKey: commandId
            )
            accepted = response.accepted
        }
        return accepted
    }

    func completeRecovery(token: String, password: String) async -> Bool {
        guard let api, let commandLedger else { return false }
        var completed = false
        await perform {
            let semantic = "auth.recovery.complete.\(ResponderDigest.sha256(token))"
            let commandId = try await commandLedger.idempotencyKey(for: semantic)
            let response = try await api.completeRecovery(
                token: token,
                password: password,
                idempotencyKey: commandId
            )
            try await commandLedger.complete(
                semanticIdentity: semantic,
                idempotencyKey: commandId
            )
            completed = response.completed
        }
        return completed
    }

    func selectOrganization(_ organization: OrganizationSummary) async {
        guard let api else { return }
        await perform {
            try await self.releaseCurrentWorkspaceAuthorityIfNeeded(
                nextOrganizationId: organization.id,
                nextProjectId: nil
            )
            try await api.selectOrganization(organization.id)
            self.selectedOrganization = organization
            self.selectedProject = nil
            self.projects = try await api.projects(organizationId: organization.id).projects
            self.launchState = .selectingWorkspace
            if self.projects.count == 1, let project = self.projects.first {
                try await self.selectProjectInternal(project)
            }
        }
    }

    func selectProject(_ project: ProjectSummary) async {
        await perform { try await self.selectProjectInternal(project) }
    }

    func refresh() async {
        guard selectedProject != nil else { return }
        await perform { try await self.refreshWorkspace() }
    }

    func requestNotificationAccess() async {
        do {
            let center = UNUserNotificationCenter.current()
            let allowed = try await center.requestAuthorization(options: [.alert, .badge, .sound])
            notificationAuthorization = allowed ? "authorized" : "denied"
            if allowed { UIApplication.shared.registerForRemoteNotifications() }
        } catch {
            present(error)
        }
    }

    func requestVoiceAccess() async {
        let allowed = await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission {
                continuation.resume(returning: $0)
            }
        }
        microphoneAuthorization = allowed ? "authorized" : "denied"
        guard allowed else {
            await disableVoiceTransport(requestFreshAuthorization: true)
            return
        }
        do {
            try await prepareVoiceTransportIfAuthorized()
        } catch {
            present(error)
        }
    }

    func receiveAPNsToken(_ data: Data, purpose: NativePushPurpose) async {
        guard let pushRegistration else { return }
        do {
            if purpose == .voip {
                if currentVoIPToken != data { voiceAuthorizationGeneration += 1 }
                currentVoIPToken = data
            } else {
                currentNotificationToken = data
            }
            let priorRevision = nativeInstallation?.revision
            if let updated = try await pushRegistration.receive(
                tokenData: data,
                purpose: purpose,
                projectId: selectedProject?.id
            ) {
                nativeInstallation = updated
                if purpose == .voip || (
                    currentVoIPToken != nil &&
                    updated.state == .active &&
                    updated.revision != priorRevision
                ) {
                    try await prepareVoiceTransportIfAuthorized()
                }
            }
        } catch {
            present(error)
        }
    }

    func invalidateVoIPToken() async {
        voiceAuthorizationGeneration += 1
        currentVoIPToken = nil
        voiceTransportState = "token_invalidated"
        guard let pushRegistration else { return }
        do {
            nativeInstallation = try await pushRegistration.invalidate(purpose: .voip)
        } catch {
            present(error)
        }
    }

    func setVoiceTransportState(_ state: String) {
        let allowed = [
            "held", "registering", "registered", "registration_failed",
            "token_invalidated", "disabled", "unavailable", "call_connected",
            "call_failed", "incoming_call", "launch_pending",
            "unregister_pending", "microphone_required", "microphone_denied"
        ]
        voiceTransportState = allowed.contains(state) ? state : "unavailable"
    }

    func createForwarding(
        businessLine: String,
        numberBindingId: String
    ) async -> Bool {
        guard
            let api,
            let commandLedger,
            let projectId = selectedProject?.id
        else { return false }
        var created = false
        await perform {
            let acceptedAt = ISO8601DateFormatter.responderFractional.string(from: Date())
            let evidence = try ResponderDigest.forwardingConsent(
                projectId: projectId,
                numberBindingId: numberBindingId,
                retainedBusinessLine: businessLine,
                acceptedAt: acceptedAt
            )
            let semantic = "forwarding.create.\(projectId).\(numberBindingId).\(evidence)"
            let commandId = try await commandLedger.idempotencyKey(for: semantic)
            _ = try await api.createForwarding(
                projectId: projectId,
                businessLine: businessLine,
                consentEvidenceDigest: evidence,
                numberBindingId: numberBindingId,
                idempotencyKey: commandId
            )
            try await commandLedger.complete(
                semanticIdentity: semantic,
                idempotencyKey: commandId
            )
            self.forwarding = try await api.forwarding(projectId: projectId)
            created = true
        }
        return created
    }

    func cancelForwarding(_ onboarding: ForwardingOnboarding) async {
        guard
            let api,
            let commandLedger,
            let projectId = selectedProject?.id
        else { return }
        await perform {
            let evidence = try ResponderDigest.forwardingCancellation(
                onboardingId: onboarding.id,
                expectedRevision: onboarding.revision
            )
            let semantic = "forwarding.cancel.\(onboarding.id).r\(onboarding.revision).\(evidence)"
            let commandId = try await commandLedger.idempotencyKey(for: semantic)
            _ = try await api.retireForwarding(
                projectId: projectId,
                onboardingId: onboarding.id,
                expectedRevision: onboarding.revision,
                evidenceDigest: evidence,
                idempotencyKey: commandId
            )
            try await commandLedger.complete(
                semanticIdentity: semantic,
                idempotencyKey: commandId
            )
            self.forwarding = try await api.forwarding(projectId: projectId)
        }
    }

    func signOut() async {
        guard let api, let commandLedger else { return }
        await perform {
            let voiceDisabled = await self.disableVoiceTransport(
                requestFreshAuthorization: true
            )
            guard voiceDisabled else {
                throw APIError(
                    code: "VOICE_DEREGISTRATION_PENDING",
                    message: "Responder is still retiring this phone's Voice registration. Try signing out again in a moment.",
                    status: 0,
                    requestId: nil,
                    retryable: true
                )
            }
            self.nativeInstallation = try await self.pushRegistration?
                .suspendForLogout()
            let semantic = "auth.signout.current-session"
            let commandId = try await commandLedger.idempotencyKey(for: semantic)
            do {
                _ = try await api.signOut(idempotencyKey: commandId)
            } catch let error as APIError where error.status == 401 {
                // A repeated sign-out is already complete.
            }
            try await commandLedger.complete(
                semanticIdentity: semantic,
                idempotencyKey: commandId
            )
            await self.pushRegistration?.resetSession()
            self.clearWorkspace()
            self.launchState = .signedOut
        }
    }

    private func chooseInitialWorkspace() async throws {
        guard let api else { return }
        guard !organizations.isEmpty else {
            launchState = .selectingWorkspace
            return
        }
        if organizations.count == 1, let organization = organizations.first {
            try await api.selectOrganization(organization.id)
            selectedOrganization = organization
            projects = try await api.projects(organizationId: organization.id).projects
            if projects.count == 1, let project = projects.first {
                try await selectProjectInternal(project)
            } else {
                launchState = .selectingWorkspace
            }
        } else {
            launchState = .selectingWorkspace
        }
    }

    private func selectProjectInternal(_ project: ProjectSummary) async throws {
        guard projects.contains(where: { $0.id == project.id }) else {
            throw APIError(
                code: "PROJECT_SELECTION_REQUIRED",
                message: "Choose a project from the active organization.",
                status: 0,
                requestId: nil,
                retryable: false
            )
        }
        guard let organizationId = selectedOrganization?.id else {
            throw APIError(
                code: "ORGANIZATION_SELECTION_REQUIRED",
                message: "Choose an organization before selecting a project.",
                status: 0,
                requestId: nil,
                retryable: false
            )
        }
        try await releaseCurrentWorkspaceAuthorityIfNeeded(
            nextOrganizationId: organizationId,
            nextProjectId: project.id
        )
        selectedProject = project
        try await refreshWorkspace()
        launchState = .ready
    }

    private func releaseCurrentWorkspaceAuthorityIfNeeded(
        nextOrganizationId: String,
        nextProjectId: String?
    ) async throws {
        guard let selected = nativeInstallation else { return }
        let organizationChanges = selected.organizationId != nextOrganizationId
        let projectChanges = nextProjectId.map {
            selected.projectId != $0
        } ?? false
        guard organizationChanges || projectChanges else { return }
        guard let api, let pushRegistration else {
            throw APIError(
                code: "NATIVE_WORKSPACE_RELEASE_UNAVAILABLE",
                message: "Responder cannot safely release the current workspace.",
                status: 0,
                requestId: nil,
                retryable: true
            )
        }

        try await api.selectOrganization(selected.organizationId)
        let voiceDisabled = await disableVoiceTransport(
            requestFreshAuthorization: true
        )
        guard voiceDisabled else {
            throw APIError(
                code: "VOICE_DEREGISTRATION_PENDING",
                message: "Responder is still retiring the current workspace's Voice registration. Try switching again in a moment.",
                status: 0,
                requestId: nil,
                retryable: true
            )
        }
        if selected.state == .active {
            nativeInstallation = try await pushRegistration.suspendForLogout()
        }
        await pushRegistration.resetSession()
        nativeInstallation = nil
    }

    private func refreshWorkspace() async throws {
        guard let api, let projectId = selectedProject?.id else { return }
        async let capabilities = api.capabilities()
        async let dashboard = api.responderDashboard()
        async let forwarding = api.forwarding(projectId: projectId)
        let selectedCapabilities = try await capabilities
        let selectedDashboard = try await dashboard
        let selectedForwarding = try await forwarding
        self.capabilities = selectedCapabilities
        self.dashboard = selectedDashboard
        self.forwarding = selectedForwarding
        if selectedCapabilities.responderNativeClient.backendReady &&
            selectedCapabilities.responderNativeClient.mounted {
            nativeInstallation = try await pushRegistration?.establish(
                projectId: projectId
            )
            if let currentNotificationToken {
                nativeInstallation = try await pushRegistration?.receive(
                    tokenData: currentNotificationToken,
                    purpose: .notification,
                    projectId: projectId
                ) ?? nativeInstallation
            }
            if let currentVoIPToken {
                nativeInstallation = try await pushRegistration?.receive(
                    tokenData: currentVoIPToken,
                    purpose: .voip,
                    projectId: projectId
                ) ?? nativeInstallation
            }
        } else {
            await disableVoiceTransport(requestFreshAuthorization: false)
            nativeInstallation = nil
        }
        try await prepareVoiceTransportIfAuthorized()
    }

    private func prepareVoiceTransportIfAuthorized() async throws {
        guard
            let api,
            let commandLedger,
            let token = currentVoIPToken,
            let installation = nativeInstallation,
            let projectId = selectedProject?.id,
            installation.state == .active,
            installation.pushRegistrations.contains(where: {
                $0.purpose == .voip && $0.active
            })
        else {
            await disableVoiceTransport(requestFreshAuthorization: true)
            return
        }
        guard
            capabilities?.responderNativeClient.mounted == true,
            capabilities?.responderNativeClient.backendReady == true,
            capabilities?.responderNativeClient.voipSessionState == "verified",
            capabilities?.responderNativeClient.providerAuthorizationEffects == true,
            microphoneAuthorization == "authorized"
        else {
            if microphoneAuthorization == "denied" {
                voiceTransportState = "microphone_denied"
            } else if microphoneAuthorization != "authorized" {
                voiceTransportState = "microphone_required"
            } else {
                voiceTransportState = "held"
            }
            await disableVoiceTransport(requestFreshAuthorization: true)
            return
        }
        let generation = voiceAuthorizationGeneration
        voiceTransportState = "registering"
        let session = try await requestVoiceSession(
            api: api,
            commandLedger: commandLedger,
            projectId: projectId,
            installation: installation,
            token: token,
            intent: "register"
        )
        guard
            generation == voiceAuthorizationGeneration,
            selectedProject?.id == projectId,
            nativeInstallation?.id == installation.id,
            nativeInstallation?.revision == installation.revision,
            currentVoIPToken == token
        else { return }
        onVoiceSession?(session, token)
    }

    private func requestVoiceSession(
        api: ResponderAPIClient,
        commandLedger: CommandLedger,
        projectId: String,
        installation: NativeInstallation,
        token: Data,
        intent: String
    ) async throws -> NativeVoiceSession {
        let tokenDigest = ResponderDigest.sha256(token)
        let semantic = "native.voice.session.\(installation.id)." +
            "r\(installation.revision).\(tokenDigest).\(intent)"
        let commandId = try await commandLedger.idempotencyKey(for: semantic)
        let session = try await api.requestVoIPSession(
            projectId: projectId,
            installationId: installation.id,
            expectedRevision: installation.revision,
            idempotencyKey: commandId
        )
        guard
            session.installationId == installation.id,
            session.installationRevision == installation.revision,
            session.provider == "twilio",
            session.transport == "twilio_voice_ios",
            session.incomingAllowed,
            !session.outgoingAllowed,
            session.providerAuthorizationEffects,
            !session.providerEffects,
            !session.pushDeliveryEffects,
            !session.voiceCallEffects,
            !session.carrierCommandEffects,
            !session.messageSendEffects,
            !session.accessToken.isEmpty
        else {
            throw APIError(
                code: "INVALID_VOICE_SESSION",
                message: "Responder returned an invalid Voice session.",
                status: 0,
                requestId: nil,
                retryable: false
            )
        }
        try await commandLedger.complete(
            semanticIdentity: semantic,
            idempotencyKey: commandId
        )
        return session
    }

    @discardableResult
    private func disableVoiceTransport(
        requestFreshAuthorization: Bool
    ) async -> Bool {
        voiceAuthorizationGeneration += 1
        var freshSession: NativeVoiceSession?
        if requestFreshAuthorization,
           let api,
           let commandLedger,
           let token = currentVoIPToken,
           let installation = nativeInstallation,
           installation.state == .active,
           installation.pushRegistrations.contains(where: {
               $0.purpose == .voip && $0.active
           }),
           capabilities?.responderNativeClient.mounted == true,
           capabilities?.responderNativeClient.backendReady == true,
           capabilities?.responderNativeClient.voipSessionState == "verified",
           capabilities?.responderNativeClient.providerAuthorizationEffects == true {
            freshSession = try? await requestVoiceSession(
                api: api,
                commandLedger: commandLedger,
                projectId: installation.projectId,
                installation: installation,
                token: token,
                intent: "unregister"
            )
        }
        let removed = await onVoiceDisable?(freshSession, currentVoIPToken) ?? true
        if !removed { voiceTransportState = "unregister_pending" }
        return removed
    }

    private func refreshSystemAuthorization() async {
        let notificationSettings = await UNUserNotificationCenter.current()
            .notificationSettings()
        switch notificationSettings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            notificationAuthorization = "authorized"
            UIApplication.shared.registerForRemoteNotifications()
        case .denied:
            notificationAuthorization = "denied"
        case .notDetermined:
            notificationAuthorization = "not_requested"
        @unknown default:
            notificationAuthorization = "unavailable"
        }
        switch AVAudioApplication.shared.recordPermission {
        case .granted:
            microphoneAuthorization = "authorized"
        case .denied:
            microphoneAuthorization = "denied"
        case .undetermined:
            microphoneAuthorization = "not_requested"
        @unknown default:
            microphoneAuthorization = "unavailable"
        }
    }

    private func clearWorkspace() {
        user = nil
        organizations = []
        projects = []
        selectedOrganization = nil
        selectedProject = nil
        capabilities = nil
        dashboard = nil
        forwarding = nil
        nativeInstallation = nil
        voiceTransportState = "disabled"
    }

    private func perform(_ work: () async throws -> Void) async {
        isBusy = true
        defer { isBusy = false }
        do {
            try await work()
        } catch {
            present(error)
            if launchState == .starting { launchState = .signedOut }
        }
    }

    private func present(_ error: Error) {
        if let apiError = error as? APIError {
            presentedError = apiError.requestId.map {
                "\(apiError.message) Reference: \($0)"
            } ?? apiError.message
        } else {
            presentedError = error.localizedDescription
        }
    }
}

private extension ISO8601DateFormatter {
    @MainActor
    static let responderFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
