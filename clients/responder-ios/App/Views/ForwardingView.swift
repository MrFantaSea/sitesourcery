import SwiftUI

struct ForwardingView: View {
    @EnvironmentObject private var model: AppModel
    @State private var businessLine = ""
    @State private var numberBindingId = ""
    @State private var confirmingCancellation: ForwardingOnboarding?

    private var activeOnboarding: ForwardingOnboarding? {
        model.forwarding?.onboardings.first { $0.state != "retired" }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                HeldBanner(
                    title: "Your carrier stays yours",
                    detail: "Responder uses conditional no-answer forwarding. It never changes carrier settings or dials carrier codes from this app."
                )
                if let onboarding = activeOnboarding {
                    onboardingCard(onboarding)
                } else {
                    setupCard
                }
                instructionCard
                observationsCard
            }
            .padding()
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationTitle("Forwarding")
        .confirmationDialog(
            "Cancel this forwarding setup?",
            isPresented: Binding(
                get: { confirmingCancellation != nil },
                set: { if !$0 { confirmingCancellation = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Cancel setup", role: .destructive) {
                guard let selected = confirmingCancellation else { return }
                Task {
                    await model.cancelForwarding(selected)
                    confirmingCancellation = nil
                }
            }
            Button("Keep setup", role: .cancel) { confirmingCancellation = nil }
        } message: {
            Text("The evidence remains preserved. Remove carrier forwarding separately using the listed cancellation instructions.")
        }
    }

    private func onboardingCard(_ onboarding: ForwardingOnboarding) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Current setup").font(.headline)
                Spacer()
                StatusPill(
                    label: onboarding.state.replacingOccurrences(of: "_", with: " ").capitalized,
                    ready: onboarding.state == "ready_held"
                )
            }
            LabeledContent("Carrier", value: "Retained")
            LabeledContent("Mode", value: "No-answer forwarding")
            LabeledContent("Revision", value: "\(onboarding.revision)")
            Text("The retained number is stored as protected lookup evidence and is never returned by this screen.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Button("Cancel setup", role: .destructive) {
                confirmingCancellation = onboarding
            }
            .buttonStyle(.bordered)
            .frame(minHeight: 44)
        }
        .padding()
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
    }

    private var setupCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Start carrier-preserving setup").font(.headline)
            TextField("Business line, including country code", text: $businessLine)
                .keyboardType(.phonePad)
                .textContentType(.telephoneNumber)
                .textFieldStyle(.roundedBorder)
                .accessibilityHint("Example: plus one, area code, and number")
            TextField("Managed destination binding ID", text: $numberBindingId)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
            Text("A Site Sourcery operator provisions the managed destination and gives you this binding ID. Customers cannot self-verify carrier routing.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Button("Record setup request") {
                Task {
                    if await model.createForwarding(
                        businessLine: businessLine,
                        numberBindingId: numberBindingId
                    ) {
                        businessLine = ""
                        numberBindingId = ""
                    }
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(
                businessLine.isEmpty || UUID(uuidString: numberBindingId) == nil ||
                    !model.forwardingReady || model.isBusy
            )
        }
        .padding()
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
    }

    private var instructionCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Human-executed instructions").font(.headline)
            if let plan = model.forwarding?.instructionPlan {
                Text("Setup").font(.subheadline.weight(.semibold))
                ForEach(Array(plan.setupSteps.enumerated()), id: \.offset) { index, step in
                    Label(step, systemImage: "\(index + 1).circle")
                        .font(.subheadline)
                }
                Divider()
                Text("Cancellation").font(.subheadline.weight(.semibold))
                ForEach(Array(plan.cancelSteps.enumerated()), id: \.offset) { index, step in
                    Label(step, systemImage: "\(index + 1).circle")
                        .font(.subheadline)
                }
                Text("Carrier codes are not stored or executed by Responder.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                Text("Instructions become available after the workspace loads.")
                    .foregroundStyle(.secondary)
            }
        }
        .padding()
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
    }

    private var observationsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Operator verification").font(.headline)
            let observations = model.forwarding?.observations ?? []
            if observations.isEmpty {
                Text("Waiting for routing, unanswered-call, reply, and STOP-path verification.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(observations) { observation in
                    Label(
                        observation.observationKind
                            .replacingOccurrences(of: "_", with: " ")
                            .capitalized,
                        systemImage: "checkmark.seal"
                    )
                    .font(.subheadline)
                }
            }
        }
        .padding()
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
    }
}
