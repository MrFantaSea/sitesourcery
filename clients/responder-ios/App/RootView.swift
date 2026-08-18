import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Group {
            switch model.launchState {
            case .starting:
                ProgressView("Opening Responder…")
                    .controlSize(.large)
            case .signedOut:
                AuthView()
            case .selectingWorkspace:
                WorkspacePickerView()
            case .ready:
                WorkspaceView()
            case .configurationFailure(let message):
                ContentUnavailableView(
                    "Build configuration required",
                    systemImage: "wrench.and.screwdriver",
                    description: Text(message)
                )
            }
        }
        .overlay {
            if model.isBusy {
                ZStack {
                    Color.black.opacity(0.18).ignoresSafeArea()
                    ProgressView()
                        .controlSize(.large)
                        .padding(24)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
                        .accessibilityLabel("Working")
                }
            }
        }
        .alert(
            "Responder couldn’t finish that",
            isPresented: Binding(
                get: { model.presentedError != nil },
                set: { if !$0 { model.presentedError = nil } }
            )
        ) {
            Button("OK", role: .cancel) { model.presentedError = nil }
        } message: {
            Text(model.presentedError ?? "Try again.")
        }
    }
}

struct HeldBanner: View {
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "lock.shield")
                .font(.title3)
                .foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding()
        .background(.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .combine)
    }
}

struct StatusPill: View {
    let label: String
    let ready: Bool

    var body: some View {
        Label(label, systemImage: ready ? "checkmark.circle.fill" : "clock.badge.exclamationmark")
            .font(.caption.weight(.semibold))
            .foregroundStyle(ready ? .green : .orange)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                (ready ? Color.green : Color.orange).opacity(0.12),
                in: Capsule()
            )
    }
}
