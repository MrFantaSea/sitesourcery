import SwiftUI

@main
struct ResponderApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .task {
                    appDelegate.bind(model)
                    await model.launch()
                }
        }
    }
}
