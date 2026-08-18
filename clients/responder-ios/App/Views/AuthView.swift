import SwiftUI

struct AuthView: View {
    @EnvironmentObject private var model: AppModel
    @State private var mode = Mode.signIn
    @State private var name = ""
    @State private var organizationName = ""
    @State private var email = ""
    @State private var password = ""
    @State private var token = ""
    @State private var verificationSent = false
    @State private var recoverySent = false

    private enum Mode: String, CaseIterable, Identifiable {
        case signIn = "Sign in"
        case register = "Create account"
        case recover = "Recover"
        var id: String { rawValue }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 8) {
                        Image(systemName: "wand.and.stars")
                            .font(.system(size: 44, weight: .semibold))
                            .foregroundStyle(.purple)
                        Text("The Responder")
                            .font(.largeTitle.bold())
                        Text("Missed-call follow-up without changing your carrier.")
                            .font(.title3)
                            .foregroundStyle(.secondary)
                    }

                    Picker("Account action", selection: $mode) {
                        ForEach(Mode.allCases) { mode in Text(mode.rawValue).tag(mode) }
                    }
                    .pickerStyle(.segmented)

                    switch mode {
                    case .signIn: signInForm
                    case .register: registerForm
                    case .recover: recoveryForm
                    }
                }
                .frame(maxWidth: 560)
                .padding(24)
                .frame(maxWidth: .infinity)
            }
            .background(Color(uiColor: .systemGroupedBackground))
        }
    }

    private var signInForm: some View {
        VStack(alignment: .leading, spacing: 16) {
            TextField("Email", text: $email)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("Email address")
            SecureField("Password", text: $password)
                .textContentType(.password)
                .textFieldStyle(.roundedBorder)
            Button("Sign in") {
                Task { await model.signIn(email: email, password: password) }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .frame(maxWidth: .infinity, minHeight: 44)
            .disabled(email.isEmpty || password.isEmpty || model.isBusy)
        }
    }

    private var registerForm: some View {
        VStack(alignment: .leading, spacing: 16) {
            if verificationSent {
                Label("Check your email, then enter the verification token.", systemImage: "envelope.badge")
                    .foregroundStyle(.secondary)
                TextField("Verification token", text: $token)
                    .textContentType(.oneTimeCode)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                Button("Verify account") {
                    Task { await model.completeRegistration(token: token) }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(token.isEmpty || model.isBusy)
            } else {
                TextField("Your name", text: $name)
                    .textContentType(.name)
                    .textFieldStyle(.roundedBorder)
                TextField("Business name", text: $organizationName)
                    .textContentType(.organizationName)
                    .textFieldStyle(.roundedBorder)
                TextField("Email", text: $email)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                SecureField("Password", text: $password)
                    .textContentType(.newPassword)
                    .textFieldStyle(.roundedBorder)
                Button("Create account") {
                    Task {
                        verificationSent = await model.register(
                            name: name,
                            organizationName: organizationName,
                            email: email,
                            password: password
                        )
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(
                    name.isEmpty || organizationName.isEmpty || email.isEmpty ||
                        password.count < 12 || model.isBusy
                )
                Text("Email verification is required before the account opens.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var recoveryForm: some View {
        VStack(alignment: .leading, spacing: 16) {
            if recoverySent {
                TextField("Recovery token", text: $token)
                    .textContentType(.oneTimeCode)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                SecureField("New password", text: $password)
                    .textContentType(.newPassword)
                    .textFieldStyle(.roundedBorder)
                Button("Set new password") {
                    Task {
                        if await model.completeRecovery(token: token, password: password) {
                            mode = .signIn
                            token = ""
                            password = ""
                            recoverySent = false
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(token.isEmpty || password.count < 12 || model.isBusy)
            } else {
                TextField("Email", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                Button("Send recovery email") {
                    Task { recoverySent = await model.requestRecovery(email: email) }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(email.isEmpty || model.isBusy)
            }
        }
    }
}
