import SwiftUI

struct WorkspacePickerView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        NavigationStack {
            List {
                if model.selectedOrganization == nil {
                    Section("Choose a business") {
                        if model.organizations.isEmpty {
                            ContentUnavailableView(
                                "No active business",
                                systemImage: "building.2.crop.circle",
                                description: Text("Ask the Site Sourcery operator to restore your membership.")
                            )
                        }
                        ForEach(model.organizations) { organization in
                            Button {
                                Task { await model.selectOrganization(organization) }
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(organization.name).font(.headline)
                                    Text("\(organization.role) · \(organization.state)")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                .frame(minHeight: 44)
                            }
                        }
                    }
                } else {
                    Section("Choose a Responder project") {
                        if model.projects.isEmpty {
                            ContentUnavailableView(
                                "No active project",
                                systemImage: "folder.badge.questionmark",
                                description: Text("Responder must be attached to an active Site Sourcery project.")
                            )
                        }
                        ForEach(model.projects) { project in
                            Button {
                                Task { await model.selectProject(project) }
                            } label: {
                                Label(project.name, systemImage: "folder")
                                    .frame(minHeight: 44)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Choose workspace")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Sign out") { Task { await model.signOut() } }
                }
            }
        }
    }
}
