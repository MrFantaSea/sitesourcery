import CryptoKit
import Foundation

public protocol SecureValueStore: Sendable {
    func read(key: String) throws -> Data?
    func write(_ data: Data, key: String) throws
    func remove(key: String) throws
}

public enum ClientAuthorityError: Error, Sendable, Equatable {
    case invalidIdentity
    case invalidSecret
    case corruptStoredValue
}

public enum ResponderDigest {
    public static func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    public static func sha256(_ value: String) -> String {
        sha256(Data(value.utf8))
    }

    public static func installationKey(secret: Data) throws -> String {
        guard secret.count == 32 else { throw ClientAuthorityError.invalidSecret }
        return sha256(Data("sitesourcery.responder-installation-key/v1\0".utf8) + secret)
    }

    public static func evidence(
        schema: String,
        fields: [String: String]
    ) throws -> String {
        guard
            schema.range(of: "^[a-z0-9][a-z0-9._/-]{7,119}$", options: .regularExpression) != nil,
            fields.keys.allSatisfy({
                $0.range(of: "^[A-Za-z][A-Za-z0-9]{0,63}$", options: .regularExpression) != nil
            }),
            fields.values.allSatisfy({ !$0.isEmpty && $0.count <= 512 })
        else { throw ClientAuthorityError.invalidIdentity }
        var value = fields
        value["schema"] = schema
        let data = try JSONSerialization.data(
            withJSONObject: value,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
        return sha256(data)
    }

    public static func nativeTransition(
        installationId: String,
        expectedRevision: Int,
        reason: String
    ) throws -> String {
        try evidence(
            schema: "sitesourcery.responder-native-transition-evidence/v1",
            fields: [
                "installationId": installationId,
                "expectedRevision": String(expectedRevision),
                "reason": reason
            ]
        )
    }

    public static func nativeTokenRetirement(
        installationId: String,
        expectedRevision: Int,
        purpose: NativePushPurpose
    ) throws -> String {
        try evidence(
            schema: "sitesourcery.responder-native-token-retirement-evidence/v1",
            fields: [
                "installationId": installationId,
                "expectedRevision": String(expectedRevision),
                "purpose": purpose.rawValue,
                "reason": "customer_request"
            ]
        )
    }

    public static func forwardingConsent(
        projectId: String,
        numberBindingId: String,
        retainedBusinessLine: String,
        acceptedAt: String
    ) throws -> String {
        try evidence(
            schema: "sitesourcery.responder-forwarding-consent-evidence/v1",
            fields: [
                "projectId": projectId,
                "numberBindingId": numberBindingId,
                "retainedBusinessLine": retainedBusinessLine,
                "acceptedAt": acceptedAt,
                "launchMode": "conditional_no_answer_forwarding"
            ]
        )
    }

    public static func forwardingCancellation(
        onboardingId: String,
        expectedRevision: Int
    ) throws -> String {
        try evidence(
            schema: "sitesourcery.responder-forwarding-cancellation-evidence/v1",
            fields: [
                "onboardingId": onboardingId,
                "expectedRevision": String(expectedRevision),
                "reason": "customer_cancelled"
            ]
        )
    }

    public static func handoff(
        interactionId: String,
        expectedRevision: Int,
        reason: String
    ) throws -> String {
        try evidence(
            schema: "sitesourcery.responder-handoff-evidence/v1",
            fields: [
                "interactionId": interactionId,
                "expectedRevision": String(expectedRevision),
                "reason": reason
            ]
        )
    }
}

public actor CommandLedger {
    private let store: any SecureValueStore
    private let namespace = "sitesourcery.responder.command.v1."

    public init(store: any SecureValueStore) {
        self.store = store
    }

    public func idempotencyKey(for semanticIdentity: String) throws -> String {
        let storageKey = try key(for: semanticIdentity)
        if let stored = try store.read(key: storageKey) {
            guard
                let value = String(data: stored, encoding: .utf8),
                isCommandId(value)
            else { throw ClientAuthorityError.corruptStoredValue }
            return value
        }
        let value = "ios." + UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: "")
        try store.write(Data(value.utf8), key: storageKey)
        return value
    }

    public func complete(semanticIdentity: String, idempotencyKey: String) throws {
        let storageKey = try key(for: semanticIdentity)
        guard let stored = try store.read(key: storageKey) else { return }
        guard String(data: stored, encoding: .utf8) == idempotencyKey else {
            throw ClientAuthorityError.corruptStoredValue
        }
        try store.remove(key: storageKey)
    }

    private func key(for semanticIdentity: String) throws -> String {
        guard
            semanticIdentity.range(
                of: "^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$",
                options: .regularExpression
            ) != nil
        else { throw ClientAuthorityError.invalidIdentity }
        return namespace + ResponderDigest.sha256(semanticIdentity)
    }

    private func isCommandId(_ value: String) -> Bool {
        value.range(
            of: "^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$",
            options: .regularExpression
        ) != nil
    }
}
