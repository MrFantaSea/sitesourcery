@preconcurrency import PushKit
import Foundation

@MainActor
final class PushKitCoordinator: NSObject,
    @preconcurrency PKPushRegistryDelegate {
    var onToken: ((Data) -> Void)? {
        didSet {
            if let currentToken { onToken?(currentToken) }
        }
    }
    var onInvalidatedToken: ((Data?) -> Void)?

    private let voice: TwilioVoiceCoordinator
    private var registry: PKPushRegistry?
    private var currentToken: Data?

    init(voice: TwilioVoiceCoordinator) {
        self.voice = voice
        super.init()
    }

    func start() {
        guard registry == nil else { return }
        let registry = PKPushRegistry(queue: .main)
        registry.delegate = self
        registry.desiredPushTypes = [.voIP]
        self.registry = registry
    }

    func pushRegistry(
        _ registry: PKPushRegistry,
        didUpdate pushCredentials: PKPushCredentials,
        for type: PKPushType
    ) {
        guard type == .voIP else { return }
        currentToken = pushCredentials.token
        onToken?(pushCredentials.token)
    }

    func pushRegistry(
        _ registry: PKPushRegistry,
        didInvalidatePushTokenFor type: PKPushType
    ) {
        guard type == .voIP else { return }
        let invalidated = currentToken
        currentToken = nil
        voice.invalidate(deviceToken: invalidated)
        onInvalidatedToken?(invalidated)
    }

    func pushRegistry(
        _ registry: PKPushRegistry,
        didReceiveIncomingPushWith payload: PKPushPayload,
        for type: PKPushType,
        completion: @escaping () -> Void
    ) {
        guard type == .voIP else {
            completion()
            return
        }
        voice.handleNotification(
            payload.dictionaryPayload,
            completion: completion
        )
    }
}
