@preconcurrency import AVFAudio
@preconcurrency import TwilioVoice
import Foundation

@MainActor
final class TwilioVoiceCoordinator: NSObject,
    @preconcurrency NotificationDelegate,
    @preconcurrency CallDelegate {
    var onState: ((String) -> Void)?

    private struct Credential {
        let authorityId: String
        let accessToken: String
        let deviceToken: Data
        let expiresAt: Date
    }

    private enum Operation {
        case registering(UUID, Credential)
        case unregistering(UUID)
    }

    private enum RetryKind {
        case registration
        case unregistration
    }

    private let callKit: CallKitCoordinator
    private let audioDevice = DefaultAudioDevice()
    private let defaults: UserDefaults
    private static let explicitlyDisabledKey =
        "sitesourcery.responder.voice-explicitly-disabled.v1"
    private static let pendingUnregisterKey =
        "sitesourcery.responder.voice-unregister-pending.v1"

    private var invitations: [UUID: CallInvite] = [:]
    private var invitationPushIds: [UUID: UUID] = [:]
    private var calls: [UUID: Call] = [:]
    private var pendingPushes: [UUID: () -> Void] = [:]
    private var claimedPushes = Set<UUID>()
    private var synchronouslyHandlingPush: UUID?

    private var operation: Operation?
    private var currentCredential: Credential?
    private var desiredCredential: Credential?
    private var unregisterAuthorization: Credential?
    private var explicitlyDisabled: Bool
    private var pendingUnregister: Bool
    private var disabledState = "disabled"
    private var disableWaiters: [UUID: CheckedContinuation<Bool, Never>] = [:]
    private var retryTask: Task<Void, Never>?
    private var retryGeneration = 0
    private var registrationRetryAttempt = 0
    private var unregistrationRetryAttempt = 0
    private static let maximumRetryAttempts = 3

    init(
        callKit: CallKitCoordinator,
        defaults: UserDefaults = .standard
    ) {
        self.callKit = callKit
        self.defaults = defaults
        self.explicitlyDisabled = defaults.bool(
            forKey: Self.explicitlyDisabledKey
        )
        self.pendingUnregister = defaults.bool(
            forKey: Self.pendingUnregisterKey
        )
        super.init()
        TwilioVoiceSDK.audioDevice = audioDevice
        callKit.onAnswer = { [weak self] callId in
            self?.answer(callId: callId) ?? false
        }
        callKit.onEnd = { [weak self] callId in
            self?.end(callId: callId) ?? false
        }
        callKit.onReset = { [weak self] in self?.resetCalls() }
        callKit.onAudioSessionActivated = { [weak self] _ in
            self?.audioDevice.isEnabled = true
        }
        callKit.onAudioSessionDeactivated = { [weak self] _ in
            self?.audioDevice.isEnabled = false
        }
    }

    func register(session: NativeVoiceSession, deviceToken: Data) {
        guard let credential = credential(
            session: session,
            deviceToken: deviceToken
        ) else {
            onState?("unavailable")
            return
        }
        beginRetryWindow()
        explicitlyDisabled = false
        defaults.set(false, forKey: Self.explicitlyDisabledKey)
        disabledState = "disabled"
        desiredCredential = credential
        if let currentCredential {
            let replacingAuthority =
                currentCredential.authorityId != credential.authorityId
            let replacingToken =
                currentCredential.deviceToken != credential.deviceToken
            if replacingAuthority || replacingToken {
                unregisterAuthorization = replacingAuthority
                    ? currentCredential
                    : credential
                setPendingUnregister(true)
            } else {
                self.currentCredential = credential
                unregisterAuthorization = credential
                desiredCredential = nil
                onState?("registered")
                return
            }
        } else {
            unregisterAuthorization = credential
        }
        reconcile()
    }

    func invalidate(deviceToken: Data?) {
        beginRetryWindow()
        desiredCredential = nil
        explicitlyDisabled = true
        defaults.set(true, forKey: Self.explicitlyDisabledKey)
        disabledState = "token_invalidated"
        if let deviceToken, !deviceToken.isEmpty {
            if let currentCredential,
               currentCredential.deviceToken == deviceToken {
                unregisterAuthorization = currentCredential
            }
            setPendingUnregister(true)
        }
        rejectAndDisconnectAll()
        reconcile()
    }

    func disable(
        session: NativeVoiceSession?,
        deviceToken: Data?
    ) async -> Bool {
        beginRetryWindow()
        explicitlyDisabled = true
        defaults.set(true, forKey: Self.explicitlyDisabledKey)
        disabledState = "disabled"
        desiredCredential = nil
        if let session, let deviceToken,
           let fresh = credential(session: session, deviceToken: deviceToken) {
            unregisterAuthorization = fresh
            setPendingUnregister(true)
        } else if currentCredential != nil {
            setPendingUnregister(true)
        }
        rejectAndDisconnectAll()
        if operation == nil && !pendingUnregister && currentCredential == nil {
            publishLifecycleState()
            return true
        }
        let waiterId = UUID()
        return await withCheckedContinuation { continuation in
            disableWaiters[waiterId] = continuation
            reconcile()
            Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(8))
                self?.finishDisableWaiter(id: waiterId, result: false)
            }
        }
    }

    func handleNotification(
        _ payload: [AnyHashable: Any],
        completion: @escaping () -> Void
    ) {
        let pendingId = UUID()
        pendingPushes[pendingId] = completion
        synchronouslyHandlingPush = pendingId
        let handled = TwilioVoiceSDK.handleNotification(
            payload,
            delegate: self,
            delegateQueue: .main
        )
        synchronouslyHandlingPush = nil
        if !handled { finishPush(id: pendingId) }
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(4))
            self?.finishPush(id: pendingId)
        }
    }

    func callInviteReceived(callInvite: CallInvite) {
        let pushId = claimPendingPush()
        let callId = callInvite.uuid
        invitations[callId] = callInvite
        if let pushId { invitationPushIds[callId] = pushId }
        callKit.reportIncoming(callId: callId) { [weak self] error in
            Task { @MainActor in
                guard let self else { return }
                if let pushId { self.finishPush(id: pushId) }
                guard
                    error == nil,
                    !self.explicitlyDisabled,
                    self.microphoneReady
                else {
                    self.invitations.removeValue(forKey: callId)?.reject()
                    self.invitationPushIds.removeValue(forKey: callId)
                    self.callKit.end(callId: callId, reason: .failed)
                    self.publishLifecycleState()
                    return
                }
                self.onState?("incoming_call")
            }
        }
    }

    func cancelledCallInviteReceived(
        cancelledCallInvite: CancelledCallInvite,
        error: Error
    ) {
        let cancellationPushId = claimPendingPush()
        let matched = invitations.first {
            $0.value.callSid == cancelledCallInvite.callSid
        }
        if let (callId, invitation) = matched {
            invitation.reject()
            invitations.removeValue(forKey: callId)
            if let invitationPushId = invitationPushIds.removeValue(
                forKey: callId
            ) {
                finishPush(id: invitationPushId)
            }
            callKit.end(callId: callId, reason: .remoteEnded)
        }
        if let cancellationPushId { finishPush(id: cancellationPushId) }
    }

    func callDidConnect(call: Call) {
        guard let callId = call.uuid else {
            call.disconnect()
            onState?("call_failed")
            return
        }
        calls[callId] = call
        onState?("call_connected")
    }

    func callDidFailToConnect(call: Call, error: Error) {
        guard let callId = call.uuid else {
            onState?("call_failed")
            return
        }
        calls.removeValue(forKey: callId)
        callKit.end(callId: callId, reason: .failed)
        onState?("call_failed")
    }

    func callDidDisconnect(call: Call, error: Error?) {
        guard let callId = call.uuid else {
            publishLifecycleState()
            return
        }
        calls.removeValue(forKey: callId)
        callKit.end(
            callId: callId,
            reason: error == nil ? .remoteEnded : .failed
        )
        publishLifecycleState()
    }

    private var microphoneReady: Bool {
        AVAudioApplication.shared.recordPermission == .granted
    }

    private func credential(
        session: NativeVoiceSession,
        deviceToken: Data
    ) -> Credential? {
        guard
            session.schema == "sitesourcery.responder-native-voice-session/v1",
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
            !session.accessToken.isEmpty,
            let expiresAt = ISO8601DateFormatter.responderVoice.date(
                from: session.expiresAt
            ),
            expiresAt > Date(),
            !deviceToken.isEmpty,
            deviceToken.count <= 512
        else { return nil }
        return Credential(
            authorityId: session.installationId,
            accessToken: session.accessToken,
            deviceToken: deviceToken,
            expiresAt: expiresAt
        )
    }

    private func reconcile() {
        guard operation == nil else { return }
        if explicitlyDisabled {
            guard pendingUnregister || currentCredential != nil else {
                publishLifecycleState()
                finishDisableWaiters(result: true)
                return
            }
            guard let authorization = unregisterAuthorization ?? currentCredential
            else {
                setPendingUnregister(true)
                onState?("unregister_pending")
                finishDisableWaiters(result: false)
                return
            }
            guard credentialIsUsable(authorization) else {
                setPendingUnregister(true)
                onState?("unregister_pending")
                finishDisableWaiters(result: false)
                return
            }
            beginUnregister(
                accessToken: authorization.accessToken,
                deviceToken: currentCredential?.deviceToken ?? authorization.deviceToken
            )
            return
        }

        if pendingUnregister || (
            currentCredential != nil && desiredCredential != nil &&
            currentCredential?.deviceToken != desiredCredential?.deviceToken
        ) {
            guard let authorization = unregisterAuthorization ?? desiredCredential,
                  let target = currentCredential?.deviceToken ??
                    unregisterAuthorization?.deviceToken ?? desiredCredential?.deviceToken
            else {
                onState?("unregister_pending")
                return
            }
            guard credentialIsUsable(authorization) else {
                onState?("unregister_pending")
                finishDisableWaiters(result: false)
                return
            }
            setPendingUnregister(true)
            beginUnregister(
                accessToken: authorization.accessToken,
                deviceToken: target
            )
            return
        }

        guard let desiredCredential else {
            publishLifecycleState()
            return
        }
        guard credentialIsUsable(desiredCredential) else {
            onState?("registration_failed")
            return
        }
        beginRegister(desiredCredential)
    }

    private func beginRegister(_ credential: Credential) {
        let operationId = UUID()
        operation = .registering(operationId, credential)
        onState?("registering")
        TwilioVoiceSDK.register(
            accessToken: credential.accessToken,
            deviceToken: credential.deviceToken
        ) { [weak self] error in
            Task { @MainActor in
                guard let self,
                      case .registering(let selectedId, _) = self.operation,
                      selectedId == operationId
                else { return }
                self.operation = nil
                if error == nil {
                    self.registrationRetryAttempt = 0
                    self.currentCredential = credential
                    if self.credentialMatches(self.desiredCredential, credential) {
                        self.desiredCredential = nil
                    } else if self.desiredCredential != nil {
                        self.unregisterAuthorization = credential
                        self.setPendingUnregister(true)
                    }
                    if !self.explicitlyDisabled && self.desiredCredential == nil {
                        self.onState?("registered")
                    }
                    self.reconcile()
                } else if self.credentialMatches(
                    self.desiredCredential,
                    credential
                ) {
                    self.onState?("registration_failed")
                    self.scheduleRetry(.registration)
                } else {
                    self.reconcile()
                }
            }
        }
    }

    private func beginUnregister(accessToken: String, deviceToken: Data) {
        let operationId = UUID()
        operation = .unregistering(operationId)
        TwilioVoiceSDK.unregister(
            accessToken: accessToken,
            deviceToken: deviceToken
        ) { [weak self] error in
            Task { @MainActor in
                guard let self,
                      case .unregistering(let selectedId) = self.operation,
                      selectedId == operationId
                else { return }
                self.operation = nil
                if error == nil {
                    self.unregistrationRetryAttempt = 0
                    self.currentCredential = nil
                    self.unregisterAuthorization = nil
                    self.setPendingUnregister(false)
                    if self.explicitlyDisabled {
                        self.publishLifecycleState()
                        self.finishDisableWaiters(result: true)
                    } else {
                        self.reconcile()
                    }
                } else {
                    self.setPendingUnregister(true)
                    self.onState?("unregister_pending")
                    self.scheduleRetry(.unregistration)
                }
            }
        }
    }

    private func answer(callId: UUID) -> Bool {
        guard
            !explicitlyDisabled,
            microphoneReady,
            let invitation = invitations.removeValue(forKey: callId)
        else { return false }
        invitationPushIds.removeValue(forKey: callId)
        let options = AcceptOptions(callInvite: invitation) {
            $0.uuid = callId
        }
        let call = invitation.accept(options: options, delegate: self)
        calls[callId] = call
        return true
    }

    private func end(callId: UUID) -> Bool {
        invitationPushIds.removeValue(forKey: callId)
        if let invitation = invitations.removeValue(forKey: callId) {
            invitation.reject()
            return true
        }
        if let call = calls.removeValue(forKey: callId) {
            call.disconnect()
            return true
        }
        return false
    }

    private func rejectAndDisconnectAll() {
        for (callId, invitation) in invitations {
            invitation.reject()
            if let pushId = invitationPushIds.removeValue(forKey: callId) {
                finishPush(id: pushId)
            }
            callKit.end(callId: callId, reason: .declinedElsewhere)
        }
        invitations.removeAll()
        for call in calls.values { call.disconnect() }
        calls.removeAll()
        audioDevice.isEnabled = false
    }

    private func resetCalls() {
        rejectAndDisconnectAll()
        publishLifecycleState()
    }

    private func setPendingUnregister(_ value: Bool) {
        pendingUnregister = value
        defaults.set(value, forKey: Self.pendingUnregisterKey)
    }

    private func beginRetryWindow() {
        retryGeneration += 1
        retryTask?.cancel()
        retryTask = nil
        registrationRetryAttempt = 0
        unregistrationRetryAttempt = 0
    }

    private func credentialIsUsable(_ credential: Credential) -> Bool {
        credential.expiresAt > Date().addingTimeInterval(1)
    }

    private func credentialMatches(
        _ candidate: Credential?,
        _ expected: Credential
    ) -> Bool {
        candidate?.authorityId == expected.authorityId &&
            candidate?.deviceToken == expected.deviceToken
    }

    private func scheduleRetry(_ kind: RetryKind) {
        let attempt: Int
        switch kind {
        case .registration:
            guard registrationRetryAttempt < Self.maximumRetryAttempts else {
                onState?("registration_failed")
                return
            }
            registrationRetryAttempt += 1
            attempt = registrationRetryAttempt
        case .unregistration:
            guard unregistrationRetryAttempt < Self.maximumRetryAttempts else {
                onState?("unregister_pending")
                finishDisableWaiters(result: false)
                return
            }
            unregistrationRetryAttempt += 1
            attempt = unregistrationRetryAttempt
        }
        let generation = retryGeneration
        let delayMilliseconds = 250 * (1 << (attempt - 1))
        retryTask?.cancel()
        retryTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(delayMilliseconds))
            guard
                !Task.isCancelled,
                let self,
                self.retryGeneration == generation
            else { return }
            self.retryTask = nil
            self.reconcile()
        }
    }

    private func publishLifecycleState() {
        if pendingUnregister {
            onState?("unregister_pending")
        } else if explicitlyDisabled {
            onState?(disabledState)
        } else if operation != nil {
            onState?("registering")
        } else if currentCredential != nil {
            onState?("registered")
        } else {
            onState?("launch_pending")
        }
    }

    private func claimPendingPush() -> UUID? {
        let selected = synchronouslyHandlingPush.flatMap {
            pendingPushes[$0] == nil || claimedPushes.contains($0) ? nil : $0
        }
        if let selected { claimedPushes.insert(selected) }
        return selected
    }

    private func finishPush(id: UUID) {
        guard let completion = pendingPushes.removeValue(forKey: id)
        else { return }
        claimedPushes.remove(id)
        completion()
    }

    private func finishDisableWaiter(id: UUID, result: Bool) {
        disableWaiters.removeValue(forKey: id)?.resume(returning: result)
    }

    private func finishDisableWaiters(result: Bool) {
        let selected = disableWaiters.values
        disableWaiters.removeAll()
        for continuation in selected { continuation.resume(returning: result) }
    }
}

private extension ISO8601DateFormatter {
    @MainActor
    static let responderVoice: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
