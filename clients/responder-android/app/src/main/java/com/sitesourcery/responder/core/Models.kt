package com.sitesourcery.responder.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class UserSummary(val id: String, val name: String, val email: String, val createdAt: String)

@Serializable
data class OrganizationSummary(
    val id: String,
    val name: String,
    val role: String,
    val state: String,
    val createdAt: String,
)

@Serializable
data class ProjectSummary(val id: String, val name: String)

@Serializable
data class MeResponse(
    val user: UserSummary? = null,
    val organizations: List<OrganizationSummary>? = null,
    val csrfToken: String,
)

@Serializable
data class OrganizationsResponse(val organizations: List<OrganizationSummary>)

@Serializable
data class ProjectsResponse(val projects: List<ProjectSummary>)

@Serializable
data class AuthenticationResponse(
    val user: UserSummary,
    val organization: OrganizationSummary? = null,
    val replayed: Boolean? = null,
)

@Serializable
data class RegistrationResponse(
    val accepted: Boolean,
    val verificationRequired: Boolean,
    val delivery: String,
    val emailSent: Boolean,
    val expiresAt: String,
    val replayed: Boolean,
)

@Serializable
data class RecoveryResponse(
    val accepted: Boolean,
    val delivery: String,
    val emailSent: Boolean? = null,
)

@Serializable
data class RecoveryCompletionResponse(val completed: Boolean)

@Serializable
data class SignOutResponse(val signedOut: Boolean)

@Serializable
data class ResponderCapabilities(
    val responder: Boolean,
    val responderForwarding: ResponderForwardingCapability,
    val responderNativeClient: ResponderNativeCapability,
)

@Serializable
data class ResponderForwardingCapability(
    val ready: Boolean,
    val mounted: Boolean,
    val mode: String,
    val retainedCarrier: Boolean,
    val launchMode: String,
    val initialAdapter: String,
    val automaticCarrierCommands: Boolean,
    val remoteWriteEffects: Boolean,
    val providerEffects: Boolean,
    val messageSendEffects: Boolean,
)

@Serializable
data class ResponderNativeCapability(
    val ready: Boolean,
    val backendReady: Boolean,
    val clientsReady: Boolean,
    val mounted: Boolean,
    val mode: String,
    val acceptedRegistrationPlatforms: List<String>,
    val initialClient: String,
    val clientArtifacts: NativeClientArtifacts,
    val tokenStorage: String,
    val voipSessionState: String,
    val voipTransports: List<String> = emptyList(),
    val providerAuthorizationEffects: Boolean,
    val providerEffects: Boolean,
    val pushDeliveryEffects: Boolean,
    val voiceCallEffects: Boolean,
    val carrierCommandEffects: Boolean,
    val messageSendEffects: Boolean,
)

@Serializable
data class NativeClientArtifacts(val ios: Boolean, val android: Boolean)

@Serializable
enum class NativePlatform { ios, android }

@Serializable
enum class NativeAppEnvironment { sandbox, production }

@Serializable
enum class NativePushPurpose { notification, voip }

@Serializable
enum class NativeInstallationState { active, suspended, revoked }

@Serializable
data class NativePushRegistration(
    val purpose: NativePushPurpose,
    val tokenReferenceDigest: String,
    val keyVersion: String,
    val registeredAt: String,
    val revision: Int,
    val active: Boolean,
)

@Serializable
data class NativeInstallation(
    val schema: String,
    val id: String,
    val organizationId: String,
    val projectId: String,
    val customerUserId: String,
    val platform: NativePlatform,
    val bundleId: String,
    val appEnvironment: NativeAppEnvironment,
    val appVersion: String,
    val buildNumber: String,
    val installationKeyDigest: String,
    val state: NativeInstallationState,
    val revision: Int,
    val createdAt: String,
    val suspendedAt: String? = null,
    val suspendedReason: String? = null,
    val revokedAt: String? = null,
    val revokedReason: String? = null,
    val pushRegistrations: List<NativePushRegistration>,
    val voipSessionState: String,
    val providerEffects: Boolean,
    val pushDeliveryEffects: Boolean,
    val voiceCallEffects: Boolean,
    val carrierCommandEffects: Boolean,
    val messageSendEffects: Boolean,
)

@Serializable
data class NativeInstallationList(
    val schema: String,
    val organizationId: String,
    val projectId: String,
    val installations: List<NativeInstallation>,
    val voipSessionState: String,
    val providerEffects: Boolean,
    val pushDeliveryEffects: Boolean,
    val voiceCallEffects: Boolean,
    val carrierCommandEffects: Boolean,
    val messageSendEffects: Boolean,
)

@Serializable
data class NativeCommandReceipt(
    val schema: String,
    val commandId: String,
    val requestDigest: String,
    val operation: String,
    val replayed: Boolean,
    val semanticReplay: Boolean,
    val tokenReceiptDigest: String? = null,
    val installation: NativeInstallation,
    val providerEffects: Boolean,
    val pushDeliveryEffects: Boolean,
    val voiceCallEffects: Boolean,
    val carrierCommandEffects: Boolean,
    val messageSendEffects: Boolean,
)

@Serializable
data class NativeVoiceSession(
    val schema: String,
    val sessionId: String,
    val commandId: String,
    val requestDigest: String,
    val replayed: Boolean,
    val semanticReplay: Boolean,
    val installationId: String,
    val installationRevision: Int,
    val organizationId: String,
    val projectId: String,
    val customerUserId: String,
    val appEnvironment: NativeAppEnvironment,
    val provider: String,
    val clientPlatform: NativePlatform,
    val transport: String,
    val identityDigest: String,
    val credentialDigest: String,
    val accessToken: String,
    val issuedAt: String,
    val expiresAt: String,
    val incomingAllowed: Boolean,
    val outgoingAllowed: Boolean,
    val providerAuthorizationEffects: Boolean,
    val providerEffects: Boolean,
    val pushDeliveryEffects: Boolean,
    val voiceCallEffects: Boolean,
    val carrierCommandEffects: Boolean,
    val messageSendEffects: Boolean,
)

@Serializable
data class ForwardingInstructionPlan(
    val schema: String,
    val launchMode: String,
    val transportAuthority: String,
    val initialAdapter: String,
    val retainedCarrier: Boolean,
    val instructionContract: String,
    val setupAuthority: String,
    val setupEffect: String,
    val setupSteps: List<String>,
    val cancelSteps: List<String>,
    val verificationRequirements: List<String>,
    val ambiguityBehavior: String,
    val automaticCarrierCommands: Boolean,
    val remoteWriteEffects: Boolean,
    val providerEffects: Boolean,
    val messageSendEffects: Boolean,
    val contractDigest: String,
    val managedDestination: String,
    val carrierCodes: String,
)

@Serializable
data class ForwardingOnboarding(
    val schema: String,
    val id: String,
    val organizationId: String,
    val projectId: String,
    val customerUserId: String,
    val numberBindingId: String,
    val transportAdapter: String,
    val launchMode: String,
    val instructionContract: String,
    val businessLineConfigured: Boolean,
    val businessLineKeyVersion: String,
    val state: String,
    val revision: Int,
    val createdAt: String,
    val updatedAt: String,
    val retiredReason: String? = null,
    val retiredAt: String? = null,
    val automaticCarrierCommands: Boolean,
    val remoteWriteEffects: Boolean,
    val providerEffects: Boolean,
    val messageSendEffects: Boolean,
)

@Serializable
data class ForwardingObservation(
    val id: String,
    val onboardingId: String,
    val observationKind: String,
    val inboundEventId: String? = null,
    val evidenceDigest: String,
    val observationDigest: String,
    val observedAt: String,
    val recordedAt: String,
)

@Serializable
data class ForwardingList(
    val schema: String,
    val organizationId: String,
    val projectId: String,
    val instructionPlan: ForwardingInstructionPlan,
    val onboardings: List<ForwardingOnboarding>,
    val observations: List<ForwardingObservation>,
    val automaticCarrierCommands: Boolean,
    val remoteWriteEffects: Boolean,
    val providerEffects: Boolean,
    val messageSendEffects: Boolean,
)

@Serializable
data class ForwardingCommandReceipt(
    val schema: String,
    val commandId: String,
    val onboardingId: String,
    val commandKind: String,
    val requestDigest: String,
    val resultingState: String,
    val resultingRevision: Int,
    val onboarding: ForwardingOnboarding,
    val replayed: Boolean,
    val semanticReplay: Boolean,
    val automaticCarrierCommands: Boolean,
    val remoteWriteEffects: Boolean,
    val providerEffects: Boolean,
    val messageSendEffects: Boolean,
)

@Serializable
data class ResponderDashboard(
    val schema: String,
    val audience: String,
    val organizationId: String,
    val observedAt: String,
    val mode: String,
    val globalKillEngaged: Boolean,
    val sellable: Boolean,
    val billingEffects: Boolean,
    val providerEffects: Boolean,
    val contacts: List<ResponderContact>,
    val interactions: List<ResponderInteraction>,
)

@Serializable
data class ResponderContact(
    val id: String,
    val projectId: String,
    val customerUserId: String,
    val routeKind: String,
    val routeDigest: String,
    val purpose: String,
    val consentBasis: String,
    val state: String,
    val consentedAt: String,
    val optedOutAt: String? = null,
    val revision: Int,
)

@Serializable
data class ResponderInteraction(
    val id: String,
    val projectId: String,
    val contactAuthorityId: String,
    val routeDigest: String,
    val sourceKind: String,
    val state: String,
    val handoffReason: String? = null,
    val openedAt: String,
    val lastEventAt: String,
    val revision: Int,
    val events: List<ResponderEvent>,
    val heldCommands: List<ResponderHeldCommand>,
)

@Serializable
data class ResponderEvent(
    val id: String,
    val interactionId: String,
    val eventKind: String,
    val messageIntent: String? = null,
    val state: String,
    val occurredAt: String,
    val recordedAt: String,
    val providerEffects: Boolean,
)

@Serializable
data class ResponderHeldCommand(
    val id: String,
    val interactionId: String,
    val contactAuthorityId: String,
    val messageKind: String,
    val state: String,
    val heldReason: String? = null,
    val requestedAt: String,
    val providerEffects: Boolean,
    val deliveryClaimed: Boolean,
)

@Serializable
data class ActionResponse(val value: JsonElement? = null)
