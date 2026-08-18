import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct APIError: Error, Sendable, Equatable, LocalizedError {
    public let code: String
    public let message: String
    public let status: Int
    public let requestId: String?
    public let retryable: Bool

    public var errorDescription: String? { message }
}

private struct ErrorEnvelope: Decodable {
    struct Body: Decodable {
        let code: String
        let message: String
        let requestId: String?
    }
    let error: Body
}

private struct CSRFResponse: Decodable {
    let csrfToken: String
}

private struct EmptyBody: Encodable {}
private struct SignInBody: Encodable { let email: String; let password: String }
private struct RegisterBody: Encodable {
    let name: String
    let organizationName: String
    let email: String
    let password: String
}
private struct TokenBody: Encodable { let token: String }
private struct RecoveryBody: Encodable { let email: String }
private struct RecoveryCompleteBody: Encodable {
    let token: String
    let password: String
}
private struct NativeCreateBody: Encodable {
    let platform: NativePlatform
    let bundleId: String
    let appEnvironment: NativeAppEnvironment
    let appVersion: String
    let buildNumber: String
    let installationKeyDigest: String
}
private struct NativeTokenBody: Encodable {
    let expectedRevision: Int
    let purpose: NativePushPurpose
    let token: String
}
private struct NativeTokenRetirementBody: Encodable {
    let expectedRevision: Int
    let purpose: NativePushPurpose
    let evidenceDigest: String
}
private struct NativeTransitionBody: Encodable {
    let expectedRevision: Int
    let reason: String
    let evidenceDigest: String
}
private struct NativeResumeBody: Encodable {
    let expectedRevision: Int
    let evidenceDigest: String
}
private struct NativeVoIPBody: Encodable { let expectedRevision: Int }
private struct ForwardingCreateBody: Encodable {
    let businessLine: String
    let consentEvidenceDigest: String
    let numberBindingId: String
}
private struct ForwardingRetireBody: Encodable {
    let expectedRevision: Int
    let reason: String
    let evidenceDigest: String
}
private struct HandoffBody: Encodable {
    let evidenceDigest: String
    let expectedRevision: Int
    let projectId: String
    let reason: String
}
private struct HeldMessageBody: Encodable {
    let contactAuthorityId: String
    let contentDigest: String
    let messageKind: String
    let projectId: String
}
private struct StopBody: Encodable {
    let occurredAt: String
    let payloadDigest: String
    let projectId: String
    let providerEventIdDigest: String
    let routeDigest: String
}

public struct RecoveryCompletionResponse: Sendable, Equatable, Codable {
    public let completed: Bool
}

public actor ResponderAPIClient {
    public static let bundleId = "com.sitesourcery.responder"
    public static let maximumResponseBytes = 1_048_576

    private let baseURL: URL
    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private var csrfToken: String?
    private var selectedOrganizationId: String?

    public init(baseURL: URL, session: URLSession = .shared) throws {
        guard
            baseURL.scheme == "https",
            baseURL.user == nil,
            baseURL.password == nil,
            baseURL.query == nil,
            baseURL.fragment == nil,
            baseURL.path == "/api/v1" || baseURL.path == "/api/v1/"
        else {
            throw APIError(
                code: "INVALID_API_ORIGIN",
                message: "The Site Sourcery API address is invalid.",
                status: 0,
                requestId: nil,
                retryable: false
            )
        }
        self.baseURL = baseURL
        self.session = session
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
    }

    public func selectOrganization(_ organizationId: String?) throws {
        selectedOrganizationId = try organizationId.map(validUUID)
    }

    public func currentOrganization() -> String? { selectedOrganizationId }

    public func bootstrapCSRF() async throws {
        let response: CSRFResponse = try await read("csrf", includeTenant: false)
        guard response.csrfToken.count >= 32 else {
            throw invalidResponse()
        }
        csrfToken = response.csrfToken
    }

    public func me() async throws -> MeResponse {
        let response: MeResponse = try await read("me", includeTenant: false)
        guard response.csrfToken.count >= 32 else { throw invalidResponse() }
        csrfToken = response.csrfToken
        return response
    }

    public func register(
        name: String,
        organizationName: String,
        email: String,
        password: String,
        idempotencyKey: String
    ) async throws -> RegistrationResponse {
        try await write(
            "auth/register",
            method: "POST",
            body: RegisterBody(
                name: name,
                organizationName: organizationName,
                email: email,
                password: password
            ),
            idempotencyKey: idempotencyKey,
            includeTenant: false
        )
    }

    public func completeRegistration(
        token: String,
        idempotencyKey: String
    ) async throws -> AuthenticationResponse {
        try await write(
            "auth/register/complete",
            method: "POST",
            body: TokenBody(token: token),
            idempotencyKey: idempotencyKey,
            includeTenant: false
        )
    }

    public func signIn(
        email: String,
        password: String,
        idempotencyKey: String
    ) async throws -> AuthenticationResponse {
        try await write(
            "auth/sessions",
            method: "POST",
            body: SignInBody(email: email, password: password),
            idempotencyKey: idempotencyKey,
            includeTenant: false
        )
    }

    public func signOut(idempotencyKey: String) async throws -> SignOutResponse {
        defer {
            csrfToken = nil
            selectedOrganizationId = nil
        }
        return try await write(
            "auth/sessions/current",
            method: "DELETE",
            body: EmptyBody(),
            idempotencyKey: idempotencyKey,
            includeTenant: false
        )
    }

    public func requestRecovery(
        email: String,
        idempotencyKey: String
    ) async throws -> RecoveryResponse {
        try await write(
            "auth/recovery",
            method: "POST",
            body: RecoveryBody(email: email),
            idempotencyKey: idempotencyKey,
            includeTenant: false
        )
    }

    public func completeRecovery(
        token: String,
        password: String,
        idempotencyKey: String
    ) async throws -> RecoveryCompletionResponse {
        try await write(
            "auth/recovery/complete",
            method: "POST",
            body: RecoveryCompleteBody(token: token, password: password),
            idempotencyKey: idempotencyKey,
            includeTenant: false
        )
    }

    public func organizations() async throws -> OrganizationsResponse {
        try await read("organizations", includeTenant: false)
    }

    public func projects(organizationId: String) async throws -> ProjectsResponse {
        let organizationId = try validUUID(organizationId)
        return try await read(
            "organizations/\(organizationId)/projects",
            includeTenant: false
        )
    }

    public func capabilities() async throws -> ResponderCapabilities {
        try await read("capabilities", includeTenant: false)
    }

    public func responderDashboard() async throws -> ResponderDashboard {
        try requireTenant()
        return try await read("responder", includeTenant: true)
    }

    public func forwarding(projectId: String) async throws -> ForwardingList {
        try requireTenant()
        let projectId = try validUUID(projectId)
        return try await read(
            "responder/projects/\(projectId)/forwarding",
            includeTenant: true
        )
    }

    public func createForwarding(
        projectId: String,
        businessLine: String,
        consentEvidenceDigest: String,
        numberBindingId: String,
        idempotencyKey: String
    ) async throws -> ForwardingCommandReceipt {
        let projectId = try validUUID(projectId)
        return try await write(
            "responder/projects/\(projectId)/forwarding",
            method: "POST",
            body: ForwardingCreateBody(
                businessLine: businessLine,
                consentEvidenceDigest: try validDigest(consentEvidenceDigest),
                numberBindingId: try validUUID(numberBindingId)
            ),
            idempotencyKey: idempotencyKey,
            includeTenant: true
        )
    }

    public func retireForwarding(
        projectId: String,
        onboardingId: String,
        expectedRevision: Int,
        evidenceDigest: String,
        idempotencyKey: String
    ) async throws -> ForwardingCommandReceipt {
        let projectId = try validUUID(projectId)
        let onboardingId = try validUUID(onboardingId)
        return try await write(
            "responder/projects/\(projectId)/forwarding/\(onboardingId)/retire",
            method: "POST",
            body: ForwardingRetireBody(
                expectedRevision: try validRevision(expectedRevision),
                reason: "customer_cancelled",
                evidenceDigest: try validDigest(evidenceDigest)
            ),
            idempotencyKey: idempotencyKey,
            includeTenant: true
        )
    }

    public func nativeInstallations(projectId: String) async throws -> NativeInstallationList {
        try requireTenant()
        let projectId = try validUUID(projectId)
        return try await read(
            "responder/projects/\(projectId)/native-installations",
            includeTenant: true
        )
    }

    public func createNativeInstallation(
        projectId: String,
        environment: NativeAppEnvironment,
        appVersion: String,
        buildNumber: String,
        installationKeyDigest: String,
        idempotencyKey: String
    ) async throws -> NativeCommandReceipt {
        let projectId = try validUUID(projectId)
        return try await write(
            "responder/projects/\(projectId)/native-installations",
            method: "POST",
            body: NativeCreateBody(
                platform: .ios,
                bundleId: Self.bundleId,
                appEnvironment: environment,
                appVersion: appVersion,
                buildNumber: buildNumber,
                installationKeyDigest: try validDigest(installationKeyDigest)
            ),
            idempotencyKey: idempotencyKey,
            includeTenant: true
        )
    }

    public func registerPushToken(
        projectId: String,
        installationId: String,
        expectedRevision: Int,
        purpose: NativePushPurpose,
        token: String,
        idempotencyKey: String
    ) async throws -> NativeCommandReceipt {
        let projectId = try validUUID(projectId)
        let installationId = try validUUID(installationId)
        guard token.range(
            of: "^(?:[0-9a-f]{2}){1,512}$",
            options: .regularExpression
        ) != nil else {
            throw invalidInput("The APNs token is invalid.")
        }
        return try await write(
            "responder/projects/\(projectId)/native-installations/" +
                "\(installationId)/push-tokens",
            method: "POST",
            body: NativeTokenBody(
                expectedRevision: try validRevision(expectedRevision),
                purpose: purpose,
                token: token
            ),
            idempotencyKey: idempotencyKey,
            includeTenant: true
        )
    }

    public func suspendNativeInstallation(
        projectId: String,
        installationId: String,
        expectedRevision: Int,
        evidenceDigest: String,
        idempotencyKey: String
    ) async throws -> NativeCommandReceipt {
        try await nativeTransition(
            projectId: projectId,
            installationId: installationId,
            expectedRevision: expectedRevision,
            reason: "logout",
            evidenceDigest: evidenceDigest,
            idempotencyKey: idempotencyKey
        )
    }

    public func revokeNativeInstallation(
        projectId: String,
        installationId: String,
        expectedRevision: Int,
        reason: String,
        evidenceDigest: String,
        idempotencyKey: String
    ) async throws -> NativeCommandReceipt {
        guard ["customer_request", "device_lost", "token_compromise"].contains(reason) else {
            throw invalidInput("The revocation reason is invalid.")
        }
        return try await nativeTransition(
            projectId: projectId,
            installationId: installationId,
            expectedRevision: expectedRevision,
            reason: reason,
            evidenceDigest: evidenceDigest,
            idempotencyKey: idempotencyKey
        )
    }

    public func resumeNativeInstallation(
        projectId: String,
        installationId: String,
        expectedRevision: Int,
        evidenceDigest: String,
        idempotencyKey: String
    ) async throws -> NativeCommandReceipt {
        let projectId = try validUUID(projectId)
        let installationId = try validUUID(installationId)
        return try await write(
            "responder/projects/\(projectId)/native-installations/" +
                "\(installationId)/resume",
            method: "POST",
            body: NativeResumeBody(
                expectedRevision: try validRevision(expectedRevision),
                evidenceDigest: try validDigest(evidenceDigest)
            ),
            idempotencyKey: idempotencyKey,
            includeTenant: true
        )
    }

    public func retirePushToken(
        projectId: String,
        installationId: String,
        expectedRevision: Int,
        purpose: NativePushPurpose,
        evidenceDigest: String,
        idempotencyKey: String
    ) async throws -> NativeCommandReceipt {
        let projectId = try validUUID(projectId)
        let installationId = try validUUID(installationId)
        return try await write(
            "responder/projects/\(projectId)/native-installations/" +
                "\(installationId)/push-tokens/retire",
            method: "POST",
            body: NativeTokenRetirementBody(
                expectedRevision: try validRevision(expectedRevision),
                purpose: purpose,
                evidenceDigest: try validDigest(evidenceDigest)
            ),
            idempotencyKey: idempotencyKey,
            includeTenant: true
        )
    }

    public func requestVoIPSession(
        projectId: String,
        installationId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> NativeVoiceSession {
        let projectId = try validUUID(projectId)
        let installationId = try validUUID(installationId)
        return try await write(
            "responder/projects/\(projectId)/native-installations/" +
                "\(installationId)/voip-session",
            method: "POST",
            body: NativeVoIPBody(expectedRevision: try validRevision(expectedRevision)),
            idempotencyKey: idempotencyKey,
            includeTenant: true
        )
    }

    public func requestHandoff(
        projectId: String,
        interactionId: String,
        expectedRevision: Int,
        reason: String,
        evidenceDigest: String,
        idempotencyKey: String
    ) async throws -> JSONValue {
        let projectId = try validUUID(projectId)
        let interactionId = try validUUID(interactionId)
        return try await write(
            "responder/interactions/\(interactionId)/handoff",
            method: "POST",
            body: HandoffBody(
                evidenceDigest: try validDigest(evidenceDigest),
                expectedRevision: try validRevision(expectedRevision),
                projectId: projectId,
                reason: reason
            ),
            idempotencyKey: idempotencyKey,
            includeTenant: true
        )
    }

    public func reserveHeldMessage(
        projectId: String,
        interactionId: String,
        contactAuthorityId: String,
        messageKind: String,
        contentDigest: String,
        idempotencyKey: String
    ) async throws -> JSONValue {
        let projectId = try validUUID(projectId)
        let interactionId = try validUUID(interactionId)
        return try await write(
            "responder/interactions/\(interactionId)/held-messages",
            method: "POST",
            body: HeldMessageBody(
                contactAuthorityId: try validUUID(contactAuthorityId),
                contentDigest: try validDigest(contentDigest),
                messageKind: messageKind,
                projectId: projectId
            ),
            idempotencyKey: idempotencyKey,
            includeTenant: true
        )
    }

    public func recordStop(
        projectId: String,
        contactAuthorityId: String,
        occurredAt: String,
        payloadDigest: String,
        providerEventIdDigest: String,
        routeDigest: String,
        idempotencyKey: String
    ) async throws -> JSONValue {
        let projectId = try validUUID(projectId)
        let contactAuthorityId = try validUUID(contactAuthorityId)
        return try await write(
            "responder/contacts/\(contactAuthorityId)/stop",
            method: "POST",
            body: StopBody(
                occurredAt: occurredAt,
                payloadDigest: try validDigest(payloadDigest),
                projectId: projectId,
                providerEventIdDigest: try validDigest(providerEventIdDigest),
                routeDigest: try validDigest(routeDigest)
            ),
            idempotencyKey: idempotencyKey,
            includeTenant: true
        )
    }

    private func nativeTransition(
        projectId: String,
        installationId: String,
        expectedRevision: Int,
        reason: String,
        evidenceDigest: String,
        idempotencyKey: String
    ) async throws -> NativeCommandReceipt {
        let projectId = try validUUID(projectId)
        let installationId = try validUUID(installationId)
        return try await write(
            "responder/projects/\(projectId)/native-installations/" +
                "\(installationId)/revoke",
            method: "POST",
            body: NativeTransitionBody(
                expectedRevision: try validRevision(expectedRevision),
                reason: reason,
                evidenceDigest: try validDigest(evidenceDigest)
            ),
            idempotencyKey: idempotencyKey,
            includeTenant: true
        )
    }

    private func read<Response: Decodable>(
        _ path: String,
        includeTenant: Bool
    ) async throws -> Response {
        let request = try makeRequest(
            path: path,
            method: "GET",
            body: nil,
            idempotencyKey: nil,
            csrf: nil,
            includeTenant: includeTenant
        )
        return try await perform(request)
    }

    private func write<Response: Decodable, Body: Encodable>(
        _ path: String,
        method: String,
        body: Body,
        idempotencyKey: String,
        includeTenant: Bool
    ) async throws -> Response {
        let key = try validCommandId(idempotencyKey)
        if csrfToken == nil { try await bootstrapCSRF() }
        let encoded = try encoder.encode(body)
        do {
            let request = try makeRequest(
                path: path,
                method: method,
                body: encoded,
                idempotencyKey: key,
                csrf: csrfToken,
                includeTenant: includeTenant
            )
            return try await perform(request)
        } catch let error as APIError where error.code == "CSRF_TOKEN_REQUIRED" {
            csrfToken = nil
            try await bootstrapCSRF()
            let retry = try makeRequest(
                path: path,
                method: method,
                body: encoded,
                idempotencyKey: key,
                csrf: csrfToken,
                includeTenant: includeTenant
            )
            return try await perform(retry)
        }
    }

    private func makeRequest(
        path: String,
        method: String,
        body: Data?,
        idempotencyKey: String?,
        csrf: String?,
        includeTenant: Bool
    ) throws -> URLRequest {
        guard
            !path.hasPrefix("/"),
            !path.contains(".."),
            !path.contains("?"),
            !path.contains("#"),
            let url = URL(string: path, relativeTo: normalizedBaseURL())?.absoluteURL,
            url.scheme == baseURL.scheme,
            url.host == baseURL.host,
            url.port == baseURL.port
        else { throw invalidInput("The API route is invalid.") }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let idempotencyKey {
            request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        }
        if let csrf {
            request.setValue(csrf, forHTTPHeaderField: "X-CSRF-Token")
        }
        if includeTenant {
            guard let selectedOrganizationId else { throw tenantRequired() }
            request.setValue(
                selectedOrganizationId,
                forHTTPHeaderField: "X-SiteSourcery-Organization-Id"
            )
        }
        return request
    }

    private func perform<Response: Decodable>(_ request: URLRequest) async throws -> Response {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError(
                code: "NETWORK_UNAVAILABLE",
                message: "Site Sourcery could not confirm the request. Retry with the same action key.",
                status: 0,
                requestId: nil,
                retryable: true
            )
        }
        guard
            let http = response as? HTTPURLResponse,
            data.count <= Self.maximumResponseBytes
        else { throw invalidResponse() }
        let requestId = http.value(forHTTPHeaderField: "X-Request-Id")
        guard (200..<300).contains(http.statusCode) else {
            if let envelope = try? decoder.decode(ErrorEnvelope.self, from: data) {
                throw APIError(
                    code: envelope.error.code,
                    message: envelope.error.message,
                    status: http.statusCode,
                    requestId: envelope.error.requestId ?? requestId,
                    retryable: http.statusCode == 409 || http.statusCode == 429 ||
                        http.statusCode >= 500
                )
            }
            throw APIError(
                code: "REQUEST_FAILED",
                message: "Site Sourcery could not complete the request.",
                status: http.statusCode,
                requestId: requestId,
                retryable: http.statusCode >= 500
            )
        }
        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw invalidResponse(requestId: requestId)
        }
    }

    private func normalizedBaseURL() -> URL {
        baseURL.path.hasSuffix("/") ? baseURL : baseURL.appendingPathComponent("")
    }

    private func requireTenant() throws {
        guard selectedOrganizationId != nil else { throw tenantRequired() }
    }

    private func validUUID(_ value: String) throws -> String {
        guard let parsed = UUID(uuidString: value) else {
            throw invalidInput("The account selection is invalid.")
        }
        return parsed.uuidString.lowercased()
    }

    private func validDigest(_ value: String) throws -> String {
        guard value.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else {
            throw invalidInput("The evidence digest is invalid.")
        }
        return value
    }

    private func validRevision(_ value: Int) throws -> Int {
        guard value > 0 else { throw invalidInput("The revision is invalid.") }
        return value
    }

    private func validCommandId(_ value: String) throws -> String {
        guard value.range(
            of: "^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$",
            options: .regularExpression
        ) != nil else {
            throw invalidInput("The action identity is invalid.")
        }
        return value
    }

    private func invalidInput(_ message: String) -> APIError {
        APIError(
            code: "INVALID_CLIENT_INPUT",
            message: message,
            status: 0,
            requestId: nil,
            retryable: false
        )
    }

    private func invalidResponse(requestId: String? = nil) -> APIError {
        APIError(
            code: "INVALID_SERVER_RESPONSE",
            message: "Site Sourcery returned an invalid response.",
            status: 0,
            requestId: requestId,
            retryable: true
        )
    }

    private func tenantRequired() -> APIError {
        APIError(
            code: "ORGANIZATION_SELECTION_REQUIRED",
            message: "Choose an organization before opening Responder.",
            status: 0,
            requestId: nil,
            retryable: false
        )
    }
}
