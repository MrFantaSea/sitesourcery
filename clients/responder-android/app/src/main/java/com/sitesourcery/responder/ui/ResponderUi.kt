package com.sitesourcery.responder.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.sitesourcery.responder.BuildConfig
import com.sitesourcery.responder.app.LaunchPhase
import com.sitesourcery.responder.app.ResponderAppState
import com.sitesourcery.responder.app.ResponderUiState
import com.sitesourcery.responder.core.ForwardingOnboarding
import com.sitesourcery.responder.core.OrganizationSummary
import kotlinx.coroutines.flow.StateFlow

private val SorceryGreen = Color(0xFF315C4A)
private val SorceryCream = Color(0xFFF5F3EC)
private val SorceryGold = Color(0xFFB26A24)

@Composable
fun ResponderRoot(
    state: StateFlow<ResponderUiState>,
    actions: ResponderAppState,
    requestPermissions: () -> Unit,
    launch: (suspend () -> Unit) -> Unit,
) {
    val value by state.collectAsStateWithLifecycle()
    MaterialTheme(
        colorScheme = if (androidx.compose.foundation.isSystemInDarkTheme()) {
            darkColorScheme(primary = Color(0xFF9FD5BC), secondary = Color(0xFFFFB872))
        } else {
            lightColorScheme(
                primary = SorceryGreen,
                secondary = SorceryGold,
                background = SorceryCream,
                surface = Color.White,
            )
        }
    ) {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Box(Modifier.fillMaxSize()) {
                when (value.phase) {
                    LaunchPhase.starting -> StartingScreen()
                    LaunchPhase.signedOut -> AuthScreen(value, actions, launch)
                    LaunchPhase.selectingWorkspace -> WorkspacePicker(value, actions, launch)
                    LaunchPhase.ready -> WorkspaceScreen(
                        value,
                        actions,
                        requestPermissions,
                        launch,
                    )
                    LaunchPhase.configurationFailure -> MessageScreen(
                        "Build configuration required",
                        "This build does not name a valid Site Sourcery API.",
                    )
                }
                if (value.busy) {
                    Surface(color = Color.Black.copy(alpha = 0.18f), modifier = Modifier.fillMaxSize()) {
                        Box(contentAlignment = Alignment.Center) {
                            Surface(shape = MaterialTheme.shapes.large, tonalElevation = 6.dp) {
                                CircularProgressIndicator(Modifier.padding(28.dp))
                            }
                        }
                    }
                }
            }
        }
        value.error?.let { error ->
            AlertDialog(
                onDismissRequest = actions::clearError,
                title = { Text("Responder couldn’t finish that") },
                text = { Text(error) },
                confirmButton = { TextButton(onClick = actions::clearError) { Text("OK") } },
            )
        }
        value.notice?.let { notice ->
            AlertDialog(
                onDismissRequest = actions::clearNotice,
                title = { Text("Responder update") },
                text = { Text(notice) },
                confirmButton = { TextButton(onClick = actions::clearNotice) { Text("OK") } },
            )
        }
    }
}

@Composable
private fun StartingScreen() = MessageScreen(
    "Site Sourcery Responder",
    "Preparing your secure business workspace. Carrier, call, and message effects remain held until activation.",
    progress = true,
)

@Composable
private fun MessageScreen(title: String, detail: String, progress: Boolean = false) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.widthIn(max = 520.dp),
        ) {
            Brand()
            Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(detail, style = MaterialTheme.typography.bodyLarge)
            if (progress) CircularProgressIndicator()
        }
    }
}

@Composable
private fun Brand() {
    Text(
        "SITE SOURCERY",
        color = MaterialTheme.colorScheme.primary,
        style = MaterialTheme.typography.labelLarge,
        fontWeight = FontWeight.Black,
        modifier = Modifier.semantics { heading() },
    )
}

@Composable
private fun AuthScreen(
    state: ResponderUiState,
    actions: ResponderAppState,
    launch: (suspend () -> Unit) -> Unit,
) {
    var mode by remember { mutableIntStateOf(0) }
    var name by remember { mutableStateOf("") }
    var business by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var token by remember { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(
            Modifier.widthIn(max = 520.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Brand()
            Text("Missed calls, handled.", style = MaterialTheme.typography.headlineMedium)
            HeldCard(
                "Safe setup mode",
                "Your existing carrier stays in place. No call, text, or carrier command is automatic during setup.",
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("Sign in", "Create", "Recover").forEachIndexed { index, label ->
                    if (mode == index) Button(onClick = { mode = index }) { Text(label) }
                    else OutlinedButton(onClick = { mode = index }) { Text(label) }
                }
            }
            if (mode == 1) {
                Field("Your name", name) { name = it }
                Field("Business name", business) { business = it }
            }
            Field("Email", email, KeyboardType.Email) { email = it }
            if (mode != 2 || token.isNotEmpty()) {
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text(if (mode == 2) "New password" else "Password") },
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
            }
            if (mode == 1 || mode == 2) {
                Field(
                    if (mode == 1) "Verification token (after creating)" else "Recovery token",
                    token,
                ) { token = it }
            }
            Button(
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    when (mode) {
                        0 -> launch { actions.signIn(email, password) }
                        1 -> if (token.isBlank()) {
                            launch { actions.register(name, business, email, password) }
                        } else {
                            launch { actions.completeRegistration(token) }
                        }
                        else -> if (token.isBlank()) {
                            launch { actions.requestRecovery(email) }
                        } else {
                            launch { actions.completeRecovery(token, password) }
                        }
                    }
                },
            ) {
                Text(
                    when (mode) {
                        0 -> "Sign in"
                        1 -> if (token.isBlank()) "Create account" else "Verify account"
                        else -> if (token.isBlank()) "Send recovery" else "Update password"
                    }
                )
            }
            Text(
                "This app stores session and device authority encrypted on this device and excludes it from backup.",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun WorkspacePicker(
    state: ResponderUiState,
    actions: ResponderAppState,
    launch: (suspend () -> Unit) -> Unit,
) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Brand()
        Text("Choose a workspace", style = MaterialTheme.typography.headlineMedium)
        if (state.organizations.isEmpty()) Text("No active business workspace is available.")
        state.organizations.forEach { organization ->
            WorkspaceChoice(organization.name, "Role: ${organization.role}") {
                launch { actions.selectOrganization(organization) }
            }
        }
        if (state.selectedOrganization != null) {
            HorizontalDivider()
            Text("Projects for ${state.selectedOrganization.name}", fontWeight = FontWeight.Bold)
            if (state.projects.isEmpty()) Text("No project is available in this business.")
            state.projects.forEach { project ->
                WorkspaceChoice(project.name, "Responder workspace") {
                    launch { actions.selectProject(project) }
                }
            }
        }
    }
}

@Composable
private fun WorkspaceChoice(title: String, detail: String, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth()) {
            Text(title, fontWeight = FontWeight.Bold)
            Text(detail, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun WorkspaceScreen(
    state: ResponderUiState,
    actions: ResponderAppState,
    requestPermissions: () -> Unit,
    launch: (suspend () -> Unit) -> Unit,
) {
    var tab by remember { mutableIntStateOf(0) }
    Scaffold(
        topBar = {
            Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 12.dp)) {
                Brand()
                Text(state.selectedProject?.name ?: "Responder", fontWeight = FontWeight.Bold)
            }
        },
        bottomBar = {
            NavigationBar {
                listOf("Activity", "Forwarding", "Device").forEachIndexed { index, label ->
                    NavigationBarItem(
                        selected = tab == index,
                        onClick = { tab = index },
                        icon = { Text(listOf("●", "↪", "▣")[index]) },
                        label = { Text(label) },
                    )
                }
            }
        },
    ) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState())
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            when (tab) {
                0 -> ActivityTab(state)
                1 -> ForwardingTab(state, actions, launch)
                else -> DeviceTab(state, actions, requestPermissions, launch)
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
private fun ActivityTab(state: ResponderUiState) {
    HeldCard(
        if (state.allExternalEffectsHeld) "External effects held" else "Activation posture changed",
        "Responder reads durable local state. Provider sends and calls require a separately approved release.",
    )
    StatusRow("Forwarding backend", state.forwardingReady)
    StatusRow("Native backend", state.nativeBackendReady)
    val dashboard = state.dashboard
    if (dashboard == null) {
        Text("No Responder activity is available yet.")
        return
    }
    Text("Activity", style = MaterialTheme.typography.headlineSmall)
    Text("${dashboard.interactions.size} interactions • ${dashboard.contacts.size} consent records")
    if (dashboard.globalKillEngaged) {
        HeldCard("Global kill engaged", "Responder fulfillment is stopped for every workspace.")
    }
    dashboard.interactions.take(10).forEach { interaction ->
        Surface(tonalElevation = 2.dp, shape = MaterialTheme.shapes.medium) {
            Column(Modifier.fillMaxWidth().padding(14.dp)) {
                Text("Interaction ${interaction.id.take(8)}", fontWeight = FontWeight.Bold)
                Text("${interaction.sourceKind.replace('_', ' ')} • ${interaction.state}")
                Text("Last event ${interaction.lastEventAt}", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun ForwardingTab(
    state: ResponderUiState,
    actions: ResponderAppState,
    launch: (suspend () -> Unit) -> Unit,
) {
    var businessLine by remember { mutableStateOf("") }
    var bindingId by remember { mutableStateOf("") }
    HeldCard(
        "Keep your carrier",
        "Conditional no-answer forwarding is set up by a person. Responder never dials carrier codes or changes your plan.",
    )
    val forwarding = state.forwarding
    if (forwarding == null) {
        Text("Forwarding details are unavailable.")
        return
    }
    Text("Setup instructions", style = MaterialTheme.typography.headlineSmall)
    forwarding.instructionPlan.setupSteps.forEachIndexed { index, step ->
        Text("${index + 1}. $step")
    }
    forwarding.onboardings.forEach { onboarding ->
        ForwardingCard(onboarding) {
            launch { actions.retireForwarding(onboarding.id, onboarding.revision) }
        }
    }
    if (forwarding.onboardings.none { it.state != "retired" }) {
        Text("Request setup", style = MaterialTheme.typography.titleLarge)
        Field("Existing business line", businessLine, KeyboardType.Phone) { businessLine = it }
        Field("Assigned destination binding ID", bindingId) { bindingId = it }
        Button(
            onClick = {
                val submittedLine = businessLine
                val submittedBinding = bindingId
                businessLine = ""
                bindingId = ""
                launch { actions.createForwarding(submittedLine, submittedBinding) }
            },
            enabled = businessLine.isNotBlank() && bindingId.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Record forwarding request") }
    }
    Text(
        "Business-line entry is transient and is cleared immediately after submission.",
        style = MaterialTheme.typography.bodySmall,
    )
}

@Composable
private fun ForwardingCard(onboarding: ForwardingOnboarding, onCancel: () -> Unit) {
    Surface(tonalElevation = 2.dp, shape = MaterialTheme.shapes.medium) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Forwarding: ${onboarding.state.replace('_', ' ')}", fontWeight = FontWeight.Bold)
            Text("Revision ${onboarding.revision} • ${onboarding.launchMode.replace('_', ' ')}")
            if (onboarding.state != "retired") {
                OutlinedButton(onClick = onCancel) { Text("Cancel forwarding setup") }
            }
        }
    }
}

@Composable
private fun DeviceTab(
    state: ResponderUiState,
    actions: ResponderAppState,
    requestPermissions: () -> Unit,
    launch: (suspend () -> Unit) -> Unit,
) {
    HeldCard(
        if (BuildConfig.PROVIDER_CONFIGURED) "Managed Voice configured" else "Provider activation held",
        if (BuildConfig.PROVIDER_CONFIGURED) {
            "Incoming-only Voice can register after permissions and server authorization are verified."
        } else {
            "This proof build performs no Firebase, Twilio, call, or push registration."
        },
    )
    Text("This device", style = MaterialTheme.typography.headlineSmall)
    val installation = state.installation
    if (installation == null) Text("Device authority is not established.") else {
        Text("State: ${installation.state.name}")
        Text("Revision: ${installation.revision}")
        Text("Notification registrations: ${installation.pushRegistrations.count { it.active }}")
    }
    StatusRow("Notifications: ${state.notificationPermission}", state.notificationPermission == "authorized")
    StatusRow("Microphone: ${state.microphonePermission}", state.microphonePermission == "authorized")
    StatusRow("Voice: ${state.voiceState.name}", state.voiceState.name == "registered")
    Button(onClick = requestPermissions, modifier = Modifier.fillMaxWidth()) {
        Text("Review device permissions")
    }
    if (BuildConfig.PROVIDER_CONFIGURED) {
        OutlinedButton(
            onClick = { launch { actions.enableVoiceAndRefresh() } },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Refresh incoming Voice registration") }
    }
    OutlinedButton(
        onClick = { launch { actions.refreshWorkspace() } },
        modifier = Modifier.fillMaxWidth(),
    ) { Text("Refresh workspace") }
    Button(
        onClick = { launch { actions.signOut() } },
        modifier = Modifier.fillMaxWidth(),
    ) { Text("Sign out safely") }
    Text(
        "Incoming calls show generic Site Sourcery identity. Caller numbers and message content are never stored in this app.",
        style = MaterialTheme.typography.bodySmall,
    )
}

@Composable
private fun HeldCard(title: String, detail: String) {
    Surface(
        color = MaterialTheme.colorScheme.secondaryContainer,
        shape = MaterialTheme.shapes.large,
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, fontWeight = FontWeight.Bold)
            Text(detail, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun StatusRow(label: String, ready: Boolean) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label)
        Text(if (ready) "Ready" else "Held", color = if (ready) SorceryGreen else SorceryGold)
    }
}

@Composable
private fun Field(
    label: String,
    value: String,
    keyboardType: KeyboardType = KeyboardType.Text,
    onValue: (String) -> Unit,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValue,
        label = { Text(label) },
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
    )
}
