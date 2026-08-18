@preconcurrency import CallKit
@preconcurrency import AVFAudio
import Foundation

@MainActor
final class CallKitCoordinator: NSObject, @preconcurrency CXProviderDelegate {
    var onAnswer: ((UUID) -> Bool)?
    var onEnd: ((UUID) -> Bool)?
    var onReset: (() -> Void)?
    var onAudioSessionActivated: ((AVAudioSession) -> Void)?
    var onAudioSessionDeactivated: ((AVAudioSession) -> Void)?

    private let provider: CXProvider
    private let controller = CXCallController()

    override init() {
        let configuration = CXProviderConfiguration()
        configuration.supportsVideo = false
        configuration.maximumCallGroups = 1
        configuration.maximumCallsPerCallGroup = 1
        configuration.supportedHandleTypes = [.generic]
        configuration.includesCallsInRecents = false
        provider = CXProvider(configuration: configuration)
        super.init()
        provider.setDelegate(self, queue: .main)
    }

    func reportIncoming(
        callId: UUID,
        completion: @escaping @Sendable (Error?) -> Void
    ) {
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: "Site Sourcery call")
        update.localizedCallerName = "Site Sourcery call"
        update.hasVideo = false
        update.supportsDTMF = false
        update.supportsGrouping = false
        update.supportsHolding = false
        update.supportsUngrouping = false
        provider.reportNewIncomingCall(with: callId, update: update, completion: completion)
    }

    func end(callId: UUID, reason: CXCallEndedReason = .failed) {
        provider.reportCall(with: callId, endedAt: Date(), reason: reason)
    }

    func providerDidReset(_ provider: CXProvider) {
        onReset?()
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        if onAnswer?(action.callUUID) == true { action.fulfill() }
        else { action.fail() }
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        if onEnd?(action.callUUID) == true { action.fulfill() }
        else { action.fail() }
    }

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        onAudioSessionActivated?(audioSession)
    }

    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        onAudioSessionDeactivated?(audioSession)
    }

    func requestEnd(callId: UUID) async throws {
        let transaction = CXTransaction(
            action: CXEndCallAction(call: callId)
        )
        try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<Void, Error>) in
            controller.request(transaction) { error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: ()) }
            }
        }
    }
}
