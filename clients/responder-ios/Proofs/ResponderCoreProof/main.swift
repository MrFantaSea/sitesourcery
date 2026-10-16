import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif
import ResponderCore

private let origin = URL(string: "https://hosted.sitesourcery.test/api/v1")!
private let organizationId = "10000000-0000-4000-8000-000000000001"
private let projectId = "10000000-0000-4000-8000-000000000002"
private let installationId = "10000000-0000-4000-8000-000000000003"
private let userJSON = #"{"id":"20000000-0000-4000-8000-000000000001","name":"Owner","email":"owner@example.test","createdAt":"2026-08-15T12:00:00.000Z"}"#

private enum ProofFailure: Error, CustomStringConvertible {
    case failed(String)

    var description: String {
        switch self {
        case .failed(let label): return label
        }
    }
}

private func require(_ condition: @autoclosure () -> Bool, _ label: String) throws {
    guard condition() else { throw ProofFailure.failed(label) }
}

private func requireThrows(_ label: String, _ work: () async throws -> Void) async throws {
    do {
        try await work()
        throw ProofFailure.failed(label)
    } catch is ProofFailure {
        throw ProofFailure.failed(label)
    } catch {}
}

private final class Locked<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value

    init(_ value: Value) { self.value = value }

    func read<Result>(_ work: (Value) -> Result) -> Result {
        lock.lock()
        defer { lock.unlock() }
        return work(value)
    }

    func update<Result>(_ work: (inout Value) -> Result) -> Result {
        lock.lock()
        defer { lock.unlock() }
        return work(&value)
    }
}

private final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)
    private static let selectedHandler = Locked<Handler?>(nil)

    static func setHandler(_ handler: @escaping Handler) {
        selectedHandler.update { $0 = handler }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        do {
            guard let handler = Self.selectedHandler.read({ $0 }) else {
                throw URLError(.badServerResponse)
            }
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

private func stubSession() -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [StubURLProtocol.self]
    configuration.httpShouldSetCookies = true
    return URLSession(configuration: configuration)
}

private func stubResponse(
    _ request: URLRequest,
    status: Int = 200,
    body: String,
    headers: [String: String] = [:]
) -> (HTTPURLResponse, Data) {
    let response = HTTPURLResponse(
        url: request.url!,
        statusCode: status,
        httpVersion: "HTTP/1.1",
        headerFields: ["Content-Type": "application/json", "X-Request-Id": "req_ios_1"]
            .merging(headers, uniquingKeysWith: { _, new in new })
    )!
    return (response, Data(body.utf8))
}

private func requestBody(_ request: URLRequest) throws -> Data {
    if let body = request.httpBody { return body }
    guard let stream = request.httpBodyStream else { return Data() }
    stream.open()
    defer { stream.close() }
    var result = Data()
    var buffer = [UInt8](repeating: 0, count: 4_096)
    while stream.hasBytesAvailable {
        let count = stream.read(&buffer, maxLength: buffer.count)
        if count < 0 { throw stream.streamError ?? URLError(.cannotDecodeContentData) }
        if count == 0 { break }
        result.append(buffer, count: count)
    }
    return result
}

private func nativeReceiptJSON(revision: Int) -> String {
    """
    {
      "schema":"sitesourcery.responder-native-command-receipt/v1",
      "commandId":"ios.token.voip.0001","requestDigest":"\(String(repeating: "1", count: 64))",
      "operation":"register_token","replayed":false,"semanticReplay":false,
      "installation":{
        "schema":"sitesourcery.responder-native-installation/v1",
        "id":"\(installationId)","organizationId":"\(organizationId)",
        "projectId":"\(projectId)","customerUserId":"20000000-0000-4000-8000-000000000001",
        "platform":"ios","bundleId":"com.sitesourcery.responder",
        "appEnvironment":"sandbox","appVersion":"1.0.0","buildNumber":"1",
        "installationKeyDigest":"\(String(repeating: "2", count: 64))",
        "state":"active","revision":\(revision),"createdAt":"2026-08-15T12:00:00.000Z",
        "suspendedAt":null,"suspendedReason":null,"revokedAt":null,"revokedReason":null,
        "pushRegistrations":[],"voipSessionState":"held",
        "providerEffects":false,"pushDeliveryEffects":false,"voiceCallEffects":false,
        "carrierCommandEffects":false,"messageSendEffects":false
      },
      "providerEffects":false,"pushDeliveryEffects":false,"voiceCallEffects":false,
      "carrierCommandEffects":false,"messageSendEffects":false
    }
    """
}

private func decoded<T: Decodable>(_ value: [String: Any], as: T.Type) throws -> T {
    try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: value))
}

private func voiceCapabilityFixture() -> [String: Any] {
    ["ready": false, "backendReady": true, "clientsReady": false,
     "mounted": true, "mode": "native", "acceptedRegistrationPlatforms": ["ios"],
     "initialClient": "ios", "clientArtifacts": ["ios": false, "android": false],
     "tokenStorage": "sealed", "voipSessionState": "verified",
     "providerAuthorizationEffects": true, "providerEffects": false,
     "pushDeliveryEffects": false, "voiceCallEffects": false,
     "carrierCommandEffects": false, "messageSendEffects": false,
     "routingReady": true, "operationalCalls": true, "voiceRoutingMode": "verified-native-client"]
}

private func voiceSessionFixture(revision: Int = 3, digest: String = "a") -> [String: Any] {
    ["schema": "sitesourcery.responder-native-voice-session/v1",
     "sessionId": "session", "commandId": "command", "requestDigest": "digest",
     "replayed": false, "semanticReplay": false,
     "installationId": installationId, "installationRevision": revision,
     "provider": "twilio", "transport": "twilio_voice_ios",
     "accessToken": "test-not-a-credential", "identityDigest": String(repeating: digest, count: 64),
     "issuedAt": "2026-08-16T12:00:00.000Z", "expiresAt": "2026-08-16T12:05:00.000Z",
     "incomingAllowed": true, "outgoingAllowed": false, "providerAuthorizationEffects": true,
     "providerEffects": false, "pushDeliveryEffects": false, "voiceCallEffects": false,
     "carrierCommandEffects": false, "messageSendEffects": false]
}

private final class MemorySecureStore: SecureValueStore, @unchecked Sendable {
    private let values = Locked<[String: Data]>([:])

    func read(key: String) throws -> Data? { values.read { $0[key] } }
    func write(_ data: Data, key: String) throws { values.update { $0[key] = data } }
    func remove(key: String) throws { values.update { _ = $0.removeValue(forKey: key) } }
}

private struct ProofSuite {
    private(set) var passed: [String] = []

    mutating func run() async throws {
        try invalidOrigins()
        passed.append("https-origin-boundary")
        try await csrfAndCookieAuthority()
        passed.append("csrf-cookie-authority")
        try await tenantHeader()
        passed.append("tenant-header-boundary")
        try await stableCSRFRetry()
        passed.append("stable-csrf-retry")
        try await tokenPrivacy()
        passed.append("token-request-projection")
        try await heldVoIP()
        passed.append("held-voip-fail-closed")
        try await voiceSessionProjection()
        passed.append("typed-voice-session-projection")
        try routingCapabilities()
        passed.append("native-routing-fail-closed")
        try scopedIncomingAuthority()
        passed.append("incoming-installation-scope-and-revocation")
        try recipientAndCleanupAuthority()
        passed.append("recipient-revision-and-cleanup-authority")
        try await commandLedger()
        passed.append("durable-command-identity")
        try digests()
        passed.append("purpose-bound-evidence-digests")
    }

    private func invalidOrigins() throws {
        do {
            _ = try ResponderAPIClient(
                baseURL: URL(string: "http://hosted.sitesourcery.test/api/v1")!,
                session: stubSession()
            )
            throw ProofFailure.failed("HTTP origin was accepted")
        } catch let error as APIError {
            try require(error.code == "INVALID_API_ORIGIN", "wrong HTTP-origin error")
        }
        do {
            _ = try ResponderAPIClient(
                baseURL: URL(string: "https://hosted.sitesourcery.test/api/v2")!,
                session: stubSession()
            )
            throw ProofFailure.failed("noncanonical API path was accepted")
        } catch let error as APIError {
            try require(error.code == "INVALID_API_ORIGIN", "wrong path-origin error")
        }
    }

    private func csrfAndCookieAuthority() async throws {
        let requests = Locked<[URLRequest]>([])
        let signInBody = Locked(Data())
        StubURLProtocol.setHandler { request in
            requests.update { $0.append(request) }
            if request.url!.path == "/api/v1/csrf" {
                return stubResponse(
                    request,
                    body: #"{"csrfToken":"cccccccccccccccccccccccccccccccc"}"#,
                    headers: ["Set-Cookie": "ss_csrf=cccccccccccccccccccccccccccccccc; Path=/api/v1; Secure; SameSite=Strict"]
                )
            }
            signInBody.update { $0 = try! requestBody(request) }
            return stubResponse(request, status: 201, body: "{\"user\":\(userJSON)}")
        }
        let client = try ResponderAPIClient(baseURL: origin, session: stubSession())
        let signedIn = try await client.signIn(
            email: "owner@example.test",
            password: "correct horse battery staple",
            idempotencyKey: "ios.signin.00000001"
        )
        try require(signedIn.user.email == "owner@example.test", "sign-in projection")
        let captured = requests.read { $0 }
        try require(
            captured.map { $0.url!.path } == ["/api/v1/csrf", "/api/v1/auth/sessions"],
            "sign-in request order"
        )
        try require(
            captured[1].value(forHTTPHeaderField: "X-CSRF-Token") ==
                "cccccccccccccccccccccccccccccccc",
            "CSRF header"
        )
        try require(
            captured[1].value(forHTTPHeaderField: "Idempotency-Key") ==
                "ios.signin.00000001",
            "idempotency header"
        )
        try require(captured[1].value(forHTTPHeaderField: "Authorization") == nil, "no bearer auth")
        try require(
            !String(data: signInBody.read { $0 }, encoding: .utf8)!.contains("session"),
            "no session material in body"
        )
    }

    private func tenantHeader() async throws {
        let client = try ResponderAPIClient(baseURL: origin, session: stubSession())
        try await requireThrows("tenantless dashboard succeeded") {
            _ = try await client.responderDashboard()
        }
        try await client.selectOrganization(organizationId)
        StubURLProtocol.setHandler { request in
            guard request.value(forHTTPHeaderField: "X-SiteSourcery-Organization-Id") ==
                    organizationId else {
                throw ProofFailure.failed("tenant header missing")
            }
            return stubResponse(request, body: """
            {
              "schema":"sitesourcery.responder-surface-dashboard/v1",
              "audience":"customer","organizationId":"\(organizationId)",
              "observedAt":"2026-08-15T12:00:00.000Z","mode":"held",
              "globalKillEngaged":false,"sellable":false,
              "billingEffects":false,"providerEffects":false,
              "contacts":[],"interactions":[]
            }
            """)
        }
        let dashboard = try await client.responderDashboard()
        try require(dashboard.organizationId == organizationId, "dashboard tenant projection")
    }

    private func stableCSRFRetry() async throws {
        struct State { var csrfCount = 0; var writeKeys: [String] = [] }
        let state = Locked(State())
        StubURLProtocol.setHandler { request in
            state.update { selected in
                if request.url!.path == "/api/v1/csrf" {
                    selected.csrfCount += 1
                    let token = selected.csrfCount == 1
                        ? "11111111111111111111111111111111"
                        : "22222222222222222222222222222222"
                    return stubResponse(request, body: "{\"csrfToken\":\"\(token)\"}")
                }
                selected.writeKeys.append(request.value(forHTTPHeaderField: "Idempotency-Key")!)
                if selected.writeKeys.count == 1 {
                    return stubResponse(
                        request,
                        status: 403,
                        body: #"{"error":{"code":"CSRF_TOKEN_REQUIRED","message":"Refresh first.","requestId":"req_ios_1","details":{}}}"#
                    )
                }
                return stubResponse(request, status: 201, body: "{\"user\":\(userJSON)}")
            }
        }
        let client = try ResponderAPIClient(baseURL: origin, session: stubSession())
        _ = try await client.signIn(
            email: "owner@example.test",
            password: "correct horse battery staple",
            idempotencyKey: "ios.signin.stable.0001"
        )
        try require(
            state.read { $0.writeKeys } == [
                "ios.signin.stable.0001", "ios.signin.stable.0001"
            ],
            "CSRF retry changed command identity"
        )
    }

    private func tokenPrivacy() async throws {
        let client = try ResponderAPIClient(baseURL: origin, session: stubSession())
        try await client.selectOrganization(organizationId)
        let capturedBody = Locked("")
        StubURLProtocol.setHandler { request in
            if request.url!.path == "/api/v1/csrf" {
                return stubResponse(
                    request,
                    body: #"{"csrfToken":"cccccccccccccccccccccccccccccccc"}"#
                )
            }
            capturedBody.update { $0 = String(data: try! requestBody(request), encoding: .utf8)! }
            return stubResponse(request, body: nativeReceiptJSON(revision: 3))
        }
        let token = String(repeating: "ab", count: 32)
        let receipt = try await client.registerPushToken(
            projectId: projectId,
            installationId: installationId,
            expectedRevision: 2,
            purpose: .voip,
            token: token,
            idempotencyKey: "ios.token.voip.0001"
        )
        try require(receipt.installation.revision == 3, "token receipt revision")
        let object = try JSONSerialization.jsonObject(
            with: Data(capturedBody.read { $0 }.utf8)
        )
        guard let body = object as? [String: Any] else {
            throw ProofFailure.failed("token request was not an object")
        }
        try require(
            Set(body.keys) == ["expectedRevision", "purpose", "token"],
            "token request included extra authority"
        )
        try require(body["token"] as? String == token, "token request changed token")
        try require(!nativeReceiptJSON(revision: 3).contains(token), "token leaked into receipt")
    }

    private func heldVoIP() async throws {
        let client = try ResponderAPIClient(baseURL: origin, session: stubSession())
        try await client.selectOrganization(organizationId)
        StubURLProtocol.setHandler { request in
            if request.url!.path == "/api/v1/csrf" {
                return stubResponse(
                    request,
                    body: #"{"csrfToken":"cccccccccccccccccccccccccccccccc"}"#
                )
            }
            return stubResponse(
                request,
                status: 409,
                body: #"{"error":{"code":"RESPONDER_NATIVE_VOIP_HELD","message":"Native VoIP access remains held.","requestId":"req_voip_1","details":{}}}"#
            )
        }
        do {
            _ = try await client.requestVoIPSession(
                projectId: projectId,
                installationId: installationId,
                expectedRevision: 3,
                idempotencyKey: "ios.voip.held.0001"
            )
            throw ProofFailure.failed("held VoIP unexpectedly succeeded")
        } catch let error as APIError {
            try require(error.code == "RESPONDER_NATIVE_VOIP_HELD", "wrong held VoIP code")
            try require(error.status == 409, "wrong held VoIP status")
        }
    }

    private func voiceSessionProjection() async throws {
        let client = try ResponderAPIClient(baseURL: origin, session: stubSession())
        try await client.selectOrganization(organizationId)
        let capturedBody = Locked("")
        StubURLProtocol.setHandler { request in
            if request.url!.path == "/api/v1/csrf" {
                return stubResponse(
                    request,
                    body: #"{"csrfToken":"cccccccccccccccccccccccccccccccc"}"#
                )
            }
            capturedBody.update {
                $0 = String(data: try! requestBody(request), encoding: .utf8)!
            }
            return stubResponse(request, status: 201, body: """
            {
              "schema":"sitesourcery.responder-native-voice-session/v1",
              "sessionId":"30000000-0000-4000-8000-000000000001",
              "commandId":"ios.voice.session.0001",
              "requestDigest":"\(String(repeating: "3", count: 64))",
              "replayed":false,"semanticReplay":false,
              "installationId":"\(installationId)","installationRevision":3,
              "provider":"twilio","transport":"twilio_voice_ios",
              "accessToken":"header.payload.signature",
              "issuedAt":"2026-08-16T12:00:00.000Z",
              "expiresAt":"2026-08-16T12:05:00.000Z",
              "incomingAllowed":true,"outgoingAllowed":false,
              "providerAuthorizationEffects":true,
              "providerEffects":false,"pushDeliveryEffects":false,
              "voiceCallEffects":false,"carrierCommandEffects":false,
              "messageSendEffects":false
            }
            """)
        }
        let session = try await client.requestVoIPSession(
            projectId: projectId,
            installationId: installationId,
            expectedRevision: 3,
            idempotencyKey: "ios.voice.session.0001"
        )
        try require(session.provider == "twilio", "Voice provider projection")
        try require(session.incomingAllowed, "incoming Voice was not allowed")
        try require(!session.outgoingAllowed, "outgoing Voice was allowed")
        try require(
            session.accessToken == "header.payload.signature",
            "Voice access token projection"
        )
        try require(
            capturedBody.read { $0 } == #"{"expectedRevision":3}"#,
            "Voice request carried extra authority"
        )
    }

    private func routingCapabilities() throws {
        var partial = voiceCapabilityFixture()
        partial["routingReady"] = false
        partial["operationalCalls"] = false
        partial["routingSlots"] = ["android": ["sandbox": true, "production": false], "ios": ["sandbox": false, "production": false]]
        let androidOnly = try decoded(partial, as: ResponderNativeCapability.self)
        try require(!androidOnly.incomingCallsReady, "partial support opened legacy clients")
        try require(!androidOnly.incomingCallsReady(in: .sandbox), "Android credential opened iOS sandbox")
        try require(!androidOnly.incomingCallsReady(in: .production), "Android credential opened iOS production")
        try require(androidOnly.voiceAuthorizationReady, "slot support blocked existing cleanup authority")
        partial["routingSlots"] = ["ios": ["production": true]]
        let iosProduction = try decoded(partial, as: ResponderNativeCapability.self)
        try require(iosProduction.incomingCallsReady(in: .production), "exact iOS production slot remained held")
        try require(!iosProduction.incomingCallsReady(in: .sandbox), "production slot opened sandbox")
        partial["routingReady"] = true
        partial["operationalCalls"] = true
        let unavailableSlots: [[String: Any]] = [[:], ["ios": [:]], ["ios": ["future": true]], ["android": ["sandbox": true]]]
        for slots in unavailableSlots {
            partial["routingSlots"] = slots
            let unavailable = try decoded(partial, as: ResponderNativeCapability.self)
            try require(!unavailable.incomingCallsReady(in: .sandbox), "absent explicit slot fell back to legacy readiness")
        }
        let live = try decoded(voiceCapabilityFixture(), as: ResponderNativeCapability.self)
        try require(live.incomingCallsReady, "verified route blocked by held distribution flags")
        for key in ["mounted", "backendReady", "providerAuthorizationEffects", "routingReady", "operationalCalls"] {
            var fixture = voiceCapabilityFixture()
            fixture[key] = false
            let capability = try decoded(fixture, as: ResponderNativeCapability.self)
            try require(!capability.incomingCallsReady, "false \(key) opened calls")
        }
        for (key, value) in [("voipSessionState", "held"), ("voiceRoutingMode", "held"), ("voiceRoutingMode", "unknown")] {
            var fixture = voiceCapabilityFixture()
            fixture[key] = value
            let capability = try decoded(fixture, as: ResponderNativeCapability.self)
            try require(!capability.incomingCallsReady, "invalid \(key) opened calls")
        }
        for key in ["routingReady", "operationalCalls", "voiceRoutingMode"] {
            var fixture = voiceCapabilityFixture()
            fixture.removeValue(forKey: key)
            let legacy = try decoded(fixture, as: ResponderNativeCapability.self)
            try require(!legacy.incomingCallsReady, "missing \(key) opened legacy calls")
            try require(legacy.voiceAuthorizationReady, "routing loss blocked cleanup token authority")
        }
    }

    private func scopedIncomingAuthority() throws {
        let capability = try decoded(voiceCapabilityFixture(), as: ResponderNativeCapability.self)
        let receipt = try JSONSerialization.jsonObject(with: Data(nativeReceiptJSON(revision: 3).utf8)) as! [String: Any]
        var fixture = receipt["installation"] as! [String: Any]
        fixture["pushRegistrations"] = [[
            "purpose": "voip", "tokenReferenceDigest": "digest", "keyVersion": "v1",
            "registeredAt": "2026-08-15T12:00:00.000Z", "revision": 3, "active": true
        ]]
        func allowed(_ candidate: [String: Any]) throws -> Bool {
            let installation = try decoded(candidate, as: NativeInstallation.self)
            return installation.permitsIncomingVoice(
                capability: capability, organizationId: organizationId,
                projectId: projectId, userId: "20000000-0000-4000-8000-000000000001"
            )
        }
        let activeAllowed = try allowed(fixture)
        try require(activeAllowed, "active scoped VoIP installation rejected")
        for (key, value) in [
            ("state", "revoked"), ("state", "suspended"), ("platform", "android"),
            ("organizationId", "foreign"), ("projectId", "foreign"),
            ("customerUserId", "foreign"), ("bundleId", "foreign")
        ] {
            var changed = fixture
            changed[key] = value
            let result = try allowed(changed)
            try require(!result, "unauthorized \(key) accepted")
        }
        for registration: [String: Any] in [
            ["purpose": "notification", "active": true], ["purpose": "voip", "active": false]
        ] {
            var changed = fixture
            var token = (fixture["pushRegistrations"] as! [[String: Any]])[0]
            token.merge(registration) { _, new in new }
            changed["pushRegistrations"] = [token]
            let result = try allowed(changed)
            try require(!result, "inactive or ordinary push opened calls")
        }
        let session = try decoded(voiceSessionFixture(), as: NativeVoiceSession.self)
        let binding = NativeVoiceBinding(session: session, deviceToken: Data([1]))!
        let current = try decoded(fixture, as: NativeInstallation.self)
        try require(binding.matchesInstallation(current), "current revision rejected")
        fixture["revision"] = 4
        let rotated = try decoded(fixture, as: NativeInstallation.self)
        try require(!binding.matchesInstallation(rotated), "old in-flight invite survived rotation")
    }

    private func recipientAndCleanupAuthority() throws {
        let session = try decoded(voiceSessionFixture(), as: NativeVoiceSession.self)
        let current = NativeVoiceBinding(session: session, deviceToken: Data([1]))!
        let recipient = "ssr_" + String(repeating: "a", count: 48)
        try require(current.matchesRecipient(recipient), "exact recipient rejected")
        try require(current.matchesRecipient("client:" + recipient), "documented prefix rejected")
        for invalid in ["client:client:" + recipient, recipient + " ", recipient.uppercased(), "client:%73" + recipient.dropFirst(), "ssr_" + String(repeating: "b", count: 48)] {
            try require(!current.matchesRecipient(invalid), "foreign/encoded recipient accepted")
        }
        // Expired issuance remains durable metadata; registration separately
        // requires an unexpired token. There is no five-minute incoming lease.
        let restored = try JSONDecoder().decode(NativeVoiceBinding.self, from: JSONEncoder().encode(current))
        try require(restored == current && restored.matchesRecipient(recipient), "cold-start metadata lost")
        let encoded = String(data: try JSONEncoder().encode(current), encoding: .utf8)!
        try require(!encoded.contains(session.accessToken) && !encoded.contains("expiresAt"), "JWT persisted as call authority")
        let nextSession = try decoded(voiceSessionFixture(revision: 4, digest: "b"), as: NativeVoiceSession.self)
        let next = NativeVoiceBinding(session: nextSession, deviceToken: Data([1]))!
        try require(next.canSupersede(current), "fresh higher revision blocked by expired cleanup")
        try require(!next.authorizesCleanup(of: current), "new identity falsely cleaned old binding")
        try require(!current.canSupersede(next) && !current.canSupersede(current), "stale revision bypassed cleanup")
        try require(!next.matchesRecipient(recipient), "old invite accepted by new revision")
        try require(current.authorizesCleanup(of: restored), "same identity cleanup rejected")
        let rotatedToken = NativeVoiceBinding(session: session, deviceToken: Data([2]))!
        try require(!rotatedToken.authorizesCleanup(of: current), "different push token cleaned old binding")
        var foreign = voiceSessionFixture(revision: 5, digest: "c")
        foreign["installationId"] = "foreign"
        let foreignSession = try decoded(foreign, as: NativeVoiceSession.self)
        let foreignBinding = NativeVoiceBinding(session: foreignSession, deviceToken: Data([1]))!
        try require(!foreignBinding.canSupersede(current), "foreign installation bypassed cleanup")
        for invalid in ["", String(repeating: "A", count: 64), String(repeating: "x", count: 64), String(repeating: "a", count: 63)] {
            var fixture = voiceSessionFixture()
            fixture["identityDigest"] = invalid
            let invalidSession = try decoded(fixture, as: NativeVoiceSession.self)
            try require(NativeVoiceBinding(session: invalidSession, deviceToken: Data([1])) == nil, "invalid identity accepted")
        }
        var legacy = voiceSessionFixture()
        legacy.removeValue(forKey: "identityDigest")
        let legacySession = try decoded(legacy, as: NativeVoiceSession.self)
        try require(NativeVoiceBinding(session: legacySession, deviceToken: Data([1])) == nil, "missing identity opened calls")
    }

    private func commandLedger() async throws {
        let ledger = CommandLedger(store: MemorySecureStore())
        let semantic = "native.token.10000000-0000-4000-8000-000000000003.voip.r2"
        let first = try await ledger.idempotencyKey(for: semantic)
        let retry = try await ledger.idempotencyKey(for: semantic)
        try require(first == retry, "command key changed before receipt")
        try await requireThrows("foreign receipt cleared command key") {
            try await ledger.complete(
                semanticIdentity: semantic,
                idempotencyKey: "ios.foreign.command.0001"
            )
        }
        let afterForeignReceipt = try await ledger.idempotencyKey(for: semantic)
        try require(afterForeignReceipt == first, "foreign receipt changed command key")
        try await ledger.complete(semanticIdentity: semantic, idempotencyKey: first)
        let afterConfirmedReceipt = try await ledger.idempotencyKey(for: semantic)
        try require(afterConfirmedReceipt != first, "confirmed command key was not cleared")
    }

    private func digests() throws {
        let secret = Data(repeating: 7, count: 32)
        let installation = try ResponderDigest.installationKey(secret: secret)
        try require(installation.count == 64, "installation digest length")
        let repeatedInstallation = try ResponderDigest.installationKey(secret: secret)
        try require(installation == repeatedInstallation, "installation digest is nondeterministic")
        let logout = try ResponderDigest.nativeTransition(
            installationId: installationId,
            expectedRevision: 3,
            reason: "logout"
        )
        let login = try ResponderDigest.nativeTransition(
            installationId: installationId,
            expectedRevision: 3,
            reason: "login"
        )
        try require(logout != login, "transition digest was not purpose-bound")
        let consent = try ResponderDigest.forwardingConsent(
            projectId: projectId,
            numberBindingId: "10000000-0000-4000-8000-000000000004",
            retainedBusinessLine: "+18562441220",
            acceptedAt: "2026-08-15T12:00:00.000Z"
        )
        try require(!consent.contains("18562441220"), "raw business line leaked from digest")
    }
}

@main
private struct ResponderCoreProof {
    static func main() async {
        let expected = [
            "https-origin-boundary",
            "csrf-cookie-authority",
            "tenant-header-boundary",
            "stable-csrf-retry",
            "token-request-projection",
            "held-voip-fail-closed",
            "typed-voice-session-projection",
            "native-routing-fail-closed",
            "incoming-installation-scope-and-revocation",
            "recipient-revision-and-cleanup-authority",
            "durable-command-identity",
            "purpose-bound-evidence-digests"
        ]
        do {
            var suite = ProofSuite()
            try await suite.run()
            try require(suite.passed == expected, "proof denominator changed")
            print("responder-ios-core-proof \(suite.passed.count)/\(expected.count) effects=held")
        } catch {
            fputs("responder-ios-core-proof failed: \(error)\n", stderr)
            exit(1)
        }
    }
}
