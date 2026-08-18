import UIKit
import UserNotifications

@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate,
    @preconcurrency UNUserNotificationCenterDelegate {
    private weak var model: AppModel?
    private let callKit = CallKitCoordinator()
    private lazy var voice = TwilioVoiceCoordinator(callKit: callKit)
    private lazy var pushKit = PushKitCoordinator(voice: voice)

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        pushKit.start()
        return true
    }

    func bind(_ model: AppModel) {
        guard self.model == nil else { return }
        self.model = model
        pushKit.onToken = { [weak model] token in
            Task { @MainActor in
                await model?.receiveAPNsToken(token, purpose: .voip)
            }
        }
        pushKit.onInvalidatedToken = { [weak model] _ in
            Task { @MainActor in
                await model?.invalidateVoIPToken()
            }
        }
        model.onVoiceSession = { [weak voice] session, token in
            voice?.register(session: session, deviceToken: token)
        }
        model.onVoiceDisable = { [weak voice] session, token in
            await voice?.disable(session: session, deviceToken: token) ?? true
        }
        voice.onState = { [weak model] state in
            model?.setVoiceTransportState(state)
        }
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in
            await model?.receiveAPNsToken(deviceToken, purpose: .notification)
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // The UI derives truth from authorization and server registration; no
        // token or private error is logged from this callback.
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }
}
