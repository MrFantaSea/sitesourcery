import SwiftUI

struct WorkspaceView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        TabView {
            NavigationStack { DashboardView() }
                .tabItem { Label("Activity", systemImage: "waveform.path.ecg") }
            NavigationStack { ForwardingView() }
                .tabItem { Label("Forwarding", systemImage: "phone.arrow.forward") }
            NavigationStack { DeviceView() }
                .tabItem { Label("Device", systemImage: "iphone.gen3") }
        }
    }
}
