import Foundation

public enum JSONValue: Sendable, Equatable, Codable {
    case object([String: JSONValue])
    case array([JSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}

public struct UserSummary: Sendable, Equatable, Codable, Identifiable {
    public let id: String
    public let name: String
    public let email: String
    public let createdAt: String
}

public struct OrganizationSummary: Sendable, Equatable, Codable, Identifiable {
    public let id: String
    public let name: String
    public let role: String
    public let state: String
    public let createdAt: String
}

public struct ProjectSummary: Sendable, Equatable, Codable, Identifiable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

public struct MeResponse: Sendable, Equatable, Codable {
    public let user: UserSummary?
    public let organizations: [OrganizationSummary]?
    public let csrfToken: String
}

public struct OrganizationsResponse: Sendable, Equatable, Codable {
    public let organizations: [OrganizationSummary]
}

public struct ProjectsResponse: Sendable, Equatable, Codable {
    public let projects: [ProjectSummary]
}

public struct AuthenticationResponse: Sendable, Equatable, Codable {
    public let user: UserSummary
    public let organization: OrganizationSummary?
    public let replayed: Bool?
}

public struct RegistrationResponse: Sendable, Equatable, Codable {
    public let accepted: Bool
    public let verificationRequired: Bool
    public let delivery: String
    public let emailSent: Bool
    public let expiresAt: String
    public let replayed: Bool
}

public struct RecoveryResponse: Sendable, Equatable, Codable {
    public let accepted: Bool
    public let delivery: String
    public let emailSent: Bool?
}

public struct SignOutResponse: Sendable, Equatable, Codable {
    public let signedOut: Bool
}

public struct ResponderCapabilities: Sendable, Equatable, Codable {
    public let responder: Bool
    public let responderForwarding: ResponderForwardingCapability
    public let responderNativeClient: ResponderNativeCapability
}

public struct ResponderForwardingCapability: Sendable, Equatable, Codable {
    public let ready: Bool
    public let mounted: Bool
    public let mode: String
    public let retainedCarrier: Bool
    public let launchMode: String
    public let initialAdapter: String
    public let automaticCarrierCommands: Bool
    public let remoteWriteEffects: Bool
    public let providerEffects: Bool
    public let messageSendEffects: Bool
}

public struct ResponderNativeCapability: Sendable, Equatable, Codable {
    public let ready: Bool
    public let backendReady: Bool
    public let clientsReady: Bool
    public let mounted: Bool
    public let mode: String
    public let acceptedRegistrationPlatforms: [String]
    public let initialClient: String
    public let clientArtifacts: NativeClientArtifacts
    public let tokenStorage: String
    public let voipSessionState: String
    public let providerAuthorizationEffects: Bool
    public let providerEffects: Bool
    public let pushDeliveryEffects: Bool
    public let voiceCallEffects: Bool
    public let carrierCommandEffects: Bool
    public let messageSendEffects: Bool
}

public struct NativeVoiceSession: Sendable, Equatable, Codable {
    public let schema: String
    public let sessionId: String
    public let commandId: String
    public let requestDigest: String
    public let replayed: Bool
    public let semanticReplay: Bool
    public let installationId: String
    public let installationRevision: Int
    public let provider: String
    public let transport: String
    public let accessToken: String
    public let issuedAt: String
    public let expiresAt: String
    public let incomingAllowed: Bool
    public let outgoingAllowed: Bool
    public let providerAuthorizationEffects: Bool
    public let providerEffects: Bool
    public let pushDeliveryEffects: Bool
    public let voiceCallEffects: Bool
    public let carrierCommandEffects: Bool
    public let messageSendEffects: Bool
}

public struct NativeClientArtifacts: Sendable, Equatable, Codable {
    public let ios: Bool
    public let android: Bool
}

public enum NativePlatform: String, Sendable, Codable {
    case ios
    case android
}

public enum NativeAppEnvironment: String, Sendable, Codable {
    case sandbox
    case production
}

public enum NativePushPurpose: String, Sendable, Codable {
    case notification
    case voip
}

public enum NativeInstallationState: String, Sendable, Codable {
    case active
    case suspended
    case revoked
}

public struct NativePushRegistration: Sendable, Equatable, Codable {
    public let purpose: NativePushPurpose
    public let tokenReferenceDigest: String
    public let keyVersion: String
    public let registeredAt: String
    public let revision: Int
    public let active: Bool
}

public struct NativeInstallation: Sendable, Equatable, Codable, Identifiable {
    public let schema: String
    public let id: String
    public let organizationId: String
    public let projectId: String
    public let customerUserId: String
    public let platform: NativePlatform
    public let bundleId: String
    public let appEnvironment: NativeAppEnvironment
    public let appVersion: String
    public let buildNumber: String
    public let installationKeyDigest: String
    public let state: NativeInstallationState
    public let revision: Int
    public let createdAt: String
    public let suspendedAt: String?
    public let suspendedReason: String?
    public let revokedAt: String?
    public let revokedReason: String?
    public let pushRegistrations: [NativePushRegistration]
    public let voipSessionState: String
    public let providerEffects: Bool
    public let pushDeliveryEffects: Bool
    public let voiceCallEffects: Bool
    public let carrierCommandEffects: Bool
    public let messageSendEffects: Bool
}

public struct NativeInstallationList: Sendable, Equatable, Codable {
    public let schema: String
    public let organizationId: String
    public let projectId: String
    public let installations: [NativeInstallation]
    public let voipSessionState: String
    public let providerEffects: Bool
    public let pushDeliveryEffects: Bool
    public let voiceCallEffects: Bool
    public let carrierCommandEffects: Bool
    public let messageSendEffects: Bool
}

public struct NativeCommandReceipt: Sendable, Equatable, Codable {
    public let schema: String
    public let commandId: String
    public let requestDigest: String
    public let operation: String
    public let replayed: Bool
    public let semanticReplay: Bool
    public let installation: NativeInstallation
    public let providerEffects: Bool
    public let pushDeliveryEffects: Bool
    public let voiceCallEffects: Bool
    public let carrierCommandEffects: Bool
    public let messageSendEffects: Bool
}

public struct ForwardingInstructionPlan: Sendable, Equatable, Codable {
    public let schema: String
    public let launchMode: String
    public let transportAuthority: String
    public let initialAdapter: String
    public let retainedCarrier: Bool
    public let instructionContract: String
    public let setupAuthority: String
    public let setupEffect: String
    public let setupSteps: [String]
    public let cancelSteps: [String]
    public let verificationRequirements: [String]
    public let ambiguityBehavior: String
    public let automaticCarrierCommands: Bool
    public let remoteWriteEffects: Bool
    public let providerEffects: Bool
    public let messageSendEffects: Bool
    public let contractDigest: String
    public let managedDestination: String
    public let carrierCodes: String
}

public struct ForwardingOnboarding: Sendable, Equatable, Codable, Identifiable {
    public let schema: String
    public let id: String
    public let organizationId: String
    public let projectId: String
    public let customerUserId: String
    public let numberBindingId: String
    public let transportAdapter: String
    public let launchMode: String
    public let instructionContract: String
    public let businessLineConfigured: Bool
    public let businessLineKeyVersion: String
    public let state: String
    public let revision: Int
    public let createdAt: String
    public let updatedAt: String
    public let retiredReason: String?
    public let retiredAt: String?
    public let automaticCarrierCommands: Bool
    public let remoteWriteEffects: Bool
    public let providerEffects: Bool
    public let messageSendEffects: Bool
}

public struct ForwardingObservation: Sendable, Equatable, Codable, Identifiable {
    public let id: String
    public let onboardingId: String
    public let observationKind: String
    public let inboundEventId: String?
    public let evidenceDigest: String
    public let observationDigest: String
    public let observedAt: String
    public let recordedAt: String
}

public struct ForwardingList: Sendable, Equatable, Codable {
    public let schema: String
    public let organizationId: String
    public let projectId: String
    public let instructionPlan: ForwardingInstructionPlan
    public let onboardings: [ForwardingOnboarding]
    public let observations: [ForwardingObservation]
    public let automaticCarrierCommands: Bool
    public let remoteWriteEffects: Bool
    public let providerEffects: Bool
    public let messageSendEffects: Bool
}

public struct ForwardingCommandReceipt: Sendable, Equatable, Codable {
    public let schema: String
    public let commandId: String
    public let onboardingId: String
    public let commandKind: String
    public let requestDigest: String
    public let resultingState: String
    public let resultingRevision: Int
    public let onboarding: ForwardingOnboarding
    public let replayed: Bool
    public let semanticReplay: Bool
    public let automaticCarrierCommands: Bool
    public let remoteWriteEffects: Bool
    public let providerEffects: Bool
    public let messageSendEffects: Bool
}

public struct ResponderDashboard: Sendable, Equatable, Codable {
    public let schema: String
    public let audience: String
    public let organizationId: String
    public let observedAt: String
    public let mode: String
    public let globalKillEngaged: Bool
    public let sellable: Bool
    public let billingEffects: Bool
    public let providerEffects: Bool
    public let contacts: [ResponderContact]
    public let interactions: [ResponderInteraction]
}

public struct ResponderContact: Sendable, Equatable, Codable, Identifiable {
    public let id: String
    public let projectId: String
    public let customerUserId: String
    public let routeKind: String
    public let routeDigest: String
    public let purpose: String
    public let consentBasis: String
    public let state: String
    public let consentedAt: String
    public let optedOutAt: String?
    public let revision: Int
}

public struct ResponderInteraction: Sendable, Equatable, Codable, Identifiable {
    public let id: String
    public let projectId: String
    public let contactAuthorityId: String
    public let routeDigest: String
    public let sourceKind: String
    public let state: String
    public let handoffReason: String?
    public let openedAt: String
    public let lastEventAt: String
    public let revision: Int
    public let events: [ResponderEvent]
    public let heldCommands: [ResponderHeldCommand]
}

public struct ResponderEvent: Sendable, Equatable, Codable, Identifiable {
    public let id: String
    public let interactionId: String
    public let eventKind: String
    public let messageIntent: String?
    public let state: String
    public let occurredAt: String
    public let recordedAt: String
    public let providerEffects: Bool
}

public struct ResponderHeldCommand: Sendable, Equatable, Codable, Identifiable {
    public let id: String
    public let interactionId: String
    public let contactAuthorityId: String
    public let messageKind: String
    public let state: String
    public let heldReason: String?
    public let requestedAt: String
    public let providerEffects: Bool
    public let deliveryClaimed: Bool
}
