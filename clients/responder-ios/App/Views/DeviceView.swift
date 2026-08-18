import SwiftUI

struct DeviceView: View {
    @EnvironmentObject private var model: AppModel
    @State private var confirmingSignOut = false

    var body: some View {
        List {
            Section("Secure installation") {
                LabeledContent(
                    "Backend",
                    value: model.nativeBackendReady ? "Ready" : "Unavailable"
                )
                LabeledContent(
                    "Device state",
                    value: model.nativeInstallation?.state.rawValue.capitalized ?? "Establishing"
                )
                LabeledContent(
                    "Revision",
                    value: model.nativeInstallation.map { String($0.revision) } ?? "—"
                )
                LabeledContent(
                    "Token storage",
                    value: model.capabilities?.responderNativeClient.tokenStorage.capitalized ?? "Sealed"
                )
            }

            Section("Notifications") {
                LabeledContent(
                    "Permission",
                    value: model.notificationAuthorization.replacingOccurrences(of: "_", with: " ").capitalized
                )
                Button("Enable notifications") {
                    Task { await model.requestNotificationAccess() }
                }
                .frame(minHeight: 44)
                .disabled(model.notificationAuthorization == "authorized")
                Text("Ordinary notifications use APNs. PushKit is reserved for actual incoming VoIP invitations and never acts as a generic background channel.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section("Voice status") {
                LabeledContent(
                    "Microphone",
                    value: model.microphoneAuthorization
                        .replacingOccurrences(of: "_", with: " ")
                        .capitalized
                )
                Button("Enable incoming-call audio") {
                    Task { await model.requestVoiceAccess() }
                }
                .frame(minHeight: 44)
                .disabled(model.microphoneAuthorization == "authorized")
                LabeledContent(
                    "Server authority",
                    value: model.nativeInstallation?.voipSessionState.capitalized ?? "Held"
                )
                LabeledContent(
                    "Twilio Voice",
                    value: model.voiceTransportState
                        .replacingOccurrences(of: "_", with: " ")
                        .capitalized
                )
                Text("Microphone access is requested here in the foreground, never from a background call push. The official Twilio Voice client stays held until the server issues incoming-only authorization; working call routing is not claimed here.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section("Account") {
                if let user = model.user {
                    LabeledContent("Signed in as", value: user.name)
                    Text(user.email).font(.footnote).foregroundStyle(.secondary)
                }
                Button("Sign out", role: .destructive) { confirmingSignOut = true }
                    .frame(minHeight: 44)
            }
        }
        .navigationTitle("This iPhone")
        .confirmationDialog(
            "Sign out of Responder?",
            isPresented: $confirmingSignOut,
            titleVisibility: .visible
        ) {
            Button("Sign out", role: .destructive) {
                Task { await model.signOut() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Responder first suspends this installation, then removes the hosted session. The same device can resume safely after sign-in.")
        }
    }
}
