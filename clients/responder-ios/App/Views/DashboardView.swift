import SwiftUI

struct DashboardView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                projectHeader
                if model.allExternalEffectsHeld {
                    HeldBanner(
                        title: "Safe setup mode",
                        detail: "Calls, texts, carrier changes, and push delivery stay held until their release checks pass."
                    )
                }
                capabilityCard
                activityCard
                if model.dashboard?.globalKillEngaged == true {
                    Label(
                        "Responder’s global safety stop is engaged.",
                        systemImage: "exclamationmark.octagon.fill"
                    )
                    .font(.headline)
                    .foregroundStyle(.red)
                    .padding()
                    .background(.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 16))
                }
            }
            .padding()
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationTitle("Responder")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await model.refresh() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .disabled(model.isBusy)
            }
        }
        .refreshable { await model.refresh() }
    }

    private var projectHeader: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(model.selectedOrganization?.name ?? "Site Sourcery")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(model.selectedProject?.name ?? "Responder project")
                .font(.title.bold())
        }
        .accessibilityElement(children: .combine)
    }

    private var capabilityCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("System readiness").font(.headline)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    StatusPill(label: "Forwarding", ready: model.forwardingReady)
                    StatusPill(label: "Secure device", ready: model.nativeBackendReady)
                }
                VStack(alignment: .leading, spacing: 8) {
                    StatusPill(label: "Forwarding", ready: model.forwardingReady)
                    StatusPill(label: "Secure device", ready: model.nativeBackendReady)
                }
            }
            Text("The app checks the mounted backend pieces directly. It does not treat a held provider as live.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding()
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
    }

    private var activityCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Protected activity").font(.headline)
            HStack(spacing: 12) {
                metric(
                    value: model.dashboard?.interactions.count ?? 0,
                    label: "Interactions"
                )
                metric(
                    value: model.dashboard?.contacts.count ?? 0,
                    label: "Consent records"
                )
            }
            Text("This view deliberately shows status and opaque activity—not caller numbers or message text.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            if let interactions = model.dashboard?.interactions, !interactions.isEmpty {
                Divider()
                ForEach(interactions.prefix(10)) { interaction in
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(interaction.sourceKind.replacingOccurrences(of: "_", with: " ").capitalized)
                                .font(.subheadline.weight(.semibold))
                            Text("\(interaction.events.count) events · \(interaction.heldCommands.count) held actions")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(interaction.state.replacingOccurrences(of: "_", with: " ").capitalized)
                            .font(.caption.weight(.medium))
                    }
                    .frame(minHeight: 44)
                }
            }
        }
        .padding()
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
    }

    private func metric(value: Int, label: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("\(value)").font(.title2.bold()).monospacedDigit()
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }
}
