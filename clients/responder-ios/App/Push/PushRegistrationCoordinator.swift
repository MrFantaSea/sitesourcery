import Foundation

actor PushRegistrationCoordinator {
    private let api: ResponderAPIClient
    private let configuration: AppConfiguration
    private let secureStore: KeychainStore
    private let commandLedger: CommandLedger
    private var installation: NativeInstallation?
    private var pendingTokens: [NativePushPurpose: String] = [:]
    private var mutationInProgress = false
    private var mutationWaiters: [CheckedContinuation<Void, Never>] = []
    private let retirementIntentPrefix =
        "sitesourcery.responder.native-token-retirement-intent.v1."

    init(
        api: ResponderAPIClient,
        configuration: AppConfiguration,
        secureStore: KeychainStore,
        commandLedger: CommandLedger
    ) {
        self.api = api
        self.configuration = configuration
        self.secureStore = secureStore
        self.commandLedger = commandLedger
    }

    func establish(projectId: String) async throws -> NativeInstallation {
        await acquireMutationLane()
        defer { releaseMutationLane() }
        return try await establishWithinMutationLane(projectId: projectId)
    }

    private func establishWithinMutationLane(projectId: String) async throws
        -> NativeInstallation {
        if let installation, installation.projectId != projectId {
            throw APIError(
                code: "NATIVE_WORKSPACE_RELEASE_REQUIRED",
                message: "Finish releasing the current Responder workspace before selecting another one.",
                status: 0,
                requestId: nil,
                retryable: true
            )
        }
        let secret = try secureStore.installationSecret(projectId: projectId)
        let keyDigest = try ResponderDigest.installationKey(secret: secret)
        let list = try await api.nativeInstallations(projectId: projectId)
        if let match = list.installations.first(where: {
            $0.platform == .ios &&
                $0.bundleId == ResponderAPIClient.bundleId &&
                $0.appEnvironment == configuration.environment &&
                $0.installationKeyDigest == keyDigest
        }) {
            if match.state == .revoked {
                throw APIError(
                    code: "NATIVE_INSTALLATION_REVOKED",
                    message: "This device identity was revoked. Contact Site Sourcery before registering it again.",
                    status: 409,
                    requestId: nil,
                    retryable: false
                )
            }
            installation = match.state == .suspended
                ? try await resume(projectId: projectId, installation: match)
                : match
        } else {
            let semantic = "native.create.\(projectId).\(keyDigest)"
            let commandId = try await commandLedger.idempotencyKey(for: semantic)
            let receipt = try await api.createNativeInstallation(
                projectId: projectId,
                environment: configuration.environment,
                appVersion: configuration.appVersion,
                buildNumber: configuration.buildNumber,
                installationKeyDigest: keyDigest,
                idempotencyKey: commandId
            )
            let created = try validated(
                receipt,
                operation: "create_installation",
                expectedCommandId: commandId,
                projectId: projectId,
                installationId: nil,
                resultingRevision: 1
            )
            installation = created
            try await commandLedger.complete(
                semanticIdentity: semantic,
                idempotencyKey: commandId
            )
        }
        guard let installation else {
            throw APIError(
                code: "NATIVE_INSTALLATION_UNAVAILABLE",
                message: "Responder could not establish this device.",
                status: 0,
                requestId: nil,
                retryable: true
            )
        }
        let reconciled = try await reconcilePendingRetirements(
            projectId: projectId,
            installation: installation
        )
        return try await drainPending(
            projectId: projectId,
            installation: reconciled
        )
    }

    func receive(tokenData: Data, purpose: NativePushPurpose, projectId: String?) async throws
        -> NativeInstallation? {
        guard !tokenData.isEmpty, tokenData.count <= 512 else {
            throw APIError(
                code: "INVALID_APNS_TOKEN",
                message: "Apple returned an invalid notification identity.",
                status: 0,
                requestId: nil,
                retryable: true
            )
        }
        pendingTokens[purpose] = tokenData.map { String(format: "%02x", $0) }.joined()
        guard let projectId else { return nil }
        await acquireMutationLane()
        defer { releaseMutationLane() }
        guard let installation else { return nil }
        return try await drainPending(projectId: projectId, installation: installation)
    }

    func invalidate(purpose: NativePushPurpose) async throws -> NativeInstallation? {
        pendingTokens.removeValue(forKey: purpose)
        try secureStore.write(
            Data("pending".utf8),
            key: retirementIntentKey(purpose)
        )
        await acquireMutationLane()
        defer { releaseMutationLane() }
        guard let projectId = installation?.projectId else {
            // PushKit can invalidate before launch has loaded the server-side
            // installation. Preserve the durable intent for establish() to
            // reconcile against the latest registration state.
            return nil
        }
        return try await retireTokenWithinMutationLane(
            projectId: projectId,
            purpose: purpose
        )
    }

    func suspendForLogout() async throws -> NativeInstallation? {
        await acquireMutationLane()
        defer { releaseMutationLane() }
        guard let selected = installation, selected.state == .active else { return installation }
        let projectId = selected.projectId
        let evidence = try ResponderDigest.nativeTransition(
            installationId: selected.id,
            expectedRevision: selected.revision,
            reason: "logout"
        )
        let semantic = "native.suspend.\(selected.id).r\(selected.revision).\(evidence)"
        let commandId = try await commandLedger.idempotencyKey(for: semantic)
        let receipt = try await api.suspendNativeInstallation(
            projectId: projectId,
            installationId: selected.id,
            expectedRevision: selected.revision,
            evidenceDigest: evidence,
            idempotencyKey: commandId
        )
        let updated = try validated(
            receipt,
            operation: "suspend",
            expectedCommandId: commandId,
            projectId: projectId,
            installationId: selected.id,
            resultingRevision: selected.revision + 1
        )
        installation = updated
        try await commandLedger.complete(semanticIdentity: semantic, idempotencyKey: commandId)
        return updated
    }

    func retireToken(
        projectId: String,
        purpose: NativePushPurpose
    ) async throws -> NativeInstallation? {
        pendingTokens.removeValue(forKey: purpose)
        await acquireMutationLane()
        defer { releaseMutationLane() }
        return try await retireTokenWithinMutationLane(
            projectId: projectId,
            purpose: purpose
        )
    }

    private func retireTokenWithinMutationLane(
        projectId: String,
        purpose: NativePushPurpose
    ) async throws -> NativeInstallation? {
        guard
            let selected = installation,
            selected.state == .active,
            selected.pushRegistrations.contains(where: {
                $0.purpose == purpose && $0.active
            })
        else {
            try secureStore.remove(key: retirementIntentKey(purpose))
            return installation
        }
        try secureStore.write(
            Data("pending".utf8),
            key: retirementIntentKey(purpose)
        )
        let evidence = try ResponderDigest.nativeTokenRetirement(
            installationId: selected.id,
            expectedRevision: selected.revision,
            purpose: purpose
        )
        let semantic = "native.token.retire.\(selected.id)." +
            "\(purpose.rawValue).r\(selected.revision).\(evidence)"
        let commandId = try await commandLedger.idempotencyKey(for: semantic)
        let receipt = try await api.retirePushToken(
            projectId: projectId,
            installationId: selected.id,
            expectedRevision: selected.revision,
            purpose: purpose,
            evidenceDigest: evidence,
            idempotencyKey: commandId
        )
        let updated = try validated(
            receipt,
            operation: "retire_token",
            expectedCommandId: commandId,
            projectId: projectId,
            installationId: selected.id,
            resultingRevision: selected.revision + 1
        )
        installation = updated
        try await commandLedger.complete(
            semanticIdentity: semantic,
            idempotencyKey: commandId
        )
        try secureStore.remove(key: retirementIntentKey(purpose))
        return updated
    }

    func revoke(
        projectId: String,
        reason: String
    ) async throws -> NativeInstallation? {
        await acquireMutationLane()
        defer { releaseMutationLane() }
        guard let selected = installation, selected.state != .revoked else { return installation }
        let evidence = try ResponderDigest.nativeTransition(
            installationId: selected.id,
            expectedRevision: selected.revision,
            reason: reason
        )
        let semantic = "native.revoke.\(selected.id).r\(selected.revision).\(reason).\(evidence)"
        let commandId = try await commandLedger.idempotencyKey(for: semantic)
        let receipt = try await api.revokeNativeInstallation(
            projectId: projectId,
            installationId: selected.id,
            expectedRevision: selected.revision,
            reason: reason,
            evidenceDigest: evidence,
            idempotencyKey: commandId
        )
        let updated = try validated(
            receipt,
            operation: "revoke",
            expectedCommandId: commandId,
            projectId: projectId,
            installationId: selected.id,
            resultingRevision: selected.revision + 1
        )
        installation = updated
        try await commandLedger.complete(semanticIdentity: semantic, idempotencyKey: commandId)
        pendingTokens.removeAll()
        return updated
    }

    func currentInstallation() -> NativeInstallation? { installation }

    func resetSession() async {
        await acquireMutationLane()
        defer { releaseMutationLane() }
        installation = nil
    }

    private func resume(
        projectId: String,
        installation selected: NativeInstallation
    ) async throws -> NativeInstallation {
        let evidence = try ResponderDigest.nativeTransition(
            installationId: selected.id,
            expectedRevision: selected.revision,
            reason: "login"
        )
        let semantic = "native.resume.\(selected.id).r\(selected.revision).\(evidence)"
        let commandId = try await commandLedger.idempotencyKey(for: semantic)
        let receipt = try await api.resumeNativeInstallation(
            projectId: projectId,
            installationId: selected.id,
            expectedRevision: selected.revision,
            evidenceDigest: evidence,
            idempotencyKey: commandId
        )
        let updated = try validated(
            receipt,
            operation: "resume",
            expectedCommandId: commandId,
            projectId: projectId,
            installationId: selected.id,
            resultingRevision: selected.revision + 1
        )
        installation = updated
        try await commandLedger.complete(semanticIdentity: semantic, idempotencyKey: commandId)
        return updated
    }

    private func reconcilePendingRetirements(
        projectId: String,
        installation starting: NativeInstallation
    ) async throws -> NativeInstallation {
        installation = starting
        var selected = starting
        for purpose in [NativePushPurpose.notification, .voip] {
            guard try secureStore.read(key: retirementIntentKey(purpose)) != nil
            else { continue }
            if let updated = try await retireTokenWithinMutationLane(
                projectId: projectId,
                purpose: purpose
            ) {
                selected = updated
                installation = updated
            }
        }
        return selected
    }

    private func drainPending(
        projectId: String,
        installation starting: NativeInstallation
    ) async throws -> NativeInstallation {
        guard starting.projectId == projectId else {
            throw APIError(
                code: "NATIVE_WORKSPACE_RELEASE_REQUIRED",
                message: "Finish releasing the current Responder workspace before registering notifications.",
                status: 0,
                requestId: nil,
                retryable: true
            )
        }
        var selected = starting
        let orderedPurposes = [NativePushPurpose.notification, .voip]
        while let purpose = orderedPurposes.first(where: { pendingTokens[$0] != nil }),
              let token = pendingTokens[purpose] {
            let tokenDigest = ResponderDigest.sha256(token)
            let semantic = "native.token.\(selected.id).\(purpose.rawValue).r\(selected.revision).\(tokenDigest)"
            let commandId = try await commandLedger.idempotencyKey(for: semantic)
            let receipt = try await api.registerPushToken(
                projectId: projectId,
                installationId: selected.id,
                expectedRevision: selected.revision,
                purpose: purpose,
                token: token,
                idempotencyKey: commandId
            )
            selected = try validated(
                receipt,
                operation: "register_token",
                expectedCommandId: commandId,
                projectId: projectId,
                installationId: selected.id,
                resultingRevision: selected.revision + 1
            )
            installation = selected
            try await commandLedger.complete(semanticIdentity: semantic, idempotencyKey: commandId)
            if pendingTokens[purpose] == token {
                pendingTokens.removeValue(forKey: purpose)
            }
        }
        installation = selected
        return selected
    }

    private func acquireMutationLane() async {
        guard mutationInProgress else {
            mutationInProgress = true
            return
        }
        await withCheckedContinuation { continuation in
            mutationWaiters.append(continuation)
        }
    }

    private func releaseMutationLane() {
        guard !mutationWaiters.isEmpty else {
            mutationInProgress = false
            return
        }
        mutationWaiters.removeFirst().resume()
    }

    private func retirementIntentKey(_ purpose: NativePushPurpose) -> String {
        retirementIntentPrefix + purpose.rawValue
    }

    private func validated(
        _ receipt: NativeCommandReceipt,
        operation: String,
        expectedCommandId: String,
        projectId: String,
        installationId: String?,
        resultingRevision: Int
    ) throws -> NativeInstallation {
        guard
            receipt.schema == "sitesourcery.responder-native-command-receipt/v1",
            receipt.operation == operation,
            receipt.commandId == expectedCommandId,
            receipt.commandId.range(
                of: "^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$",
                options: .regularExpression
            ) != nil,
            receipt.requestDigest.range(
                of: "^[0-9a-f]{64}$",
                options: .regularExpression
            ) != nil,
            receipt.installation.projectId == projectId,
            installationId == nil || receipt.installation.id == installationId,
            (receipt.installation.revision == resultingRevision ||
                ((receipt.replayed || receipt.semanticReplay) &&
                    receipt.installation.revision == resultingRevision - 1)),
            !receipt.providerEffects,
            !receipt.pushDeliveryEffects,
            !receipt.voiceCallEffects,
            !receipt.carrierCommandEffects,
            !receipt.messageSendEffects
        else {
            throw APIError(
                code: "INVALID_NATIVE_COMMAND_RECEIPT",
                message: "Responder returned an invalid device receipt.",
                status: 0,
                requestId: nil,
                retryable: false
            )
        }
        return receipt.installation
    }
}
