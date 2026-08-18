package com.sitesourcery.responder.network

import com.sitesourcery.responder.core.AuthenticationResponse
import com.sitesourcery.responder.core.ForwardingCommandReceipt
import com.sitesourcery.responder.core.ForwardingList
import com.sitesourcery.responder.core.MeResponse
import com.sitesourcery.responder.core.NativeAppEnvironment
import com.sitesourcery.responder.core.NativeCommandReceipt
import com.sitesourcery.responder.core.NativeInstallationList
import com.sitesourcery.responder.core.NativePlatform
import com.sitesourcery.responder.core.NativePushPurpose
import com.sitesourcery.responder.core.NativeVoiceSession
import com.sitesourcery.responder.core.OrganizationsResponse
import com.sitesourcery.responder.core.ProjectsResponse
import com.sitesourcery.responder.core.RecoveryCompletionResponse
import com.sitesourcery.responder.core.RecoveryResponse
import com.sitesourcery.responder.core.RegistrationResponse
import com.sitesourcery.responder.core.ResponderCapabilities
import com.sitesourcery.responder.core.ResponderDashboard
import com.sitesourcery.responder.core.SignOutResponse
import com.sitesourcery.responder.security.DeviceAuthorityStore
import java.io.ByteArrayOutputStream
import java.net.URI
import java.net.URL
import java.util.UUID
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

data class HttpRequest(
    val method: String,
    val url: URL,
    val headers: Map<String, String>,
    val body: ByteArray?,
)

data class HttpResponse(
    val status: Int,
    val headers: Map<String, List<String>>,
    val body: ByteArray,
)

fun interface HttpTransport {
    suspend fun execute(request: HttpRequest): HttpResponse
}

class HttpsUrlTransport : HttpTransport {
    override suspend fun execute(request: HttpRequest): HttpResponse = withContext(Dispatchers.IO) {
        require(request.url.protocol == "https")
        val connection = request.url.openConnection() as HttpsURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.useCaches = false
            connection.requestMethod = request.method
            request.headers.forEach(connection::setRequestProperty)
            request.body?.let { body ->
                connection.doOutput = true
                connection.setFixedLengthStreamingMode(body.size)
                connection.outputStream.use { it.write(body) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            HttpResponse(
                status = status,
                headers = connection.headerFields
                    .filterKeys { it != null }
                    .mapKeys { it.key.orEmpty() },
                body = stream?.use(::readBounded) ?: ByteArray(0),
            )
        } finally {
            connection.disconnect()
        }
    }

    private fun readBounded(stream: java.io.InputStream): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
            val count = stream.read(buffer)
            if (count < 0) break
            if (output.size() + count > MAX_RESPONSE_BYTES) {
                throw ApiException("RESPONSE_TOO_LARGE", "The server response was too large.", 502)
            }
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    companion object {
        const val MAX_RESPONSE_BYTES = 1024 * 1024
    }
}

class ApiException(
    val code: String,
    override val message: String,
    val status: Int,
    val requestId: String? = null,
) : Exception(message) {
    val retryable: Boolean = status == 409 || status == 429 || status >= 500
}

interface NativeClientApi {
    suspend fun nativeInstallations(projectId: String): NativeInstallationList
    suspend fun createNativeInstallation(
        projectId: String,
        environment: NativeAppEnvironment,
        appVersion: String,
        buildNumber: String,
        installationKeyDigest: String,
        idempotencyKey: String,
    ): NativeCommandReceipt
    suspend fun registerPushToken(
        projectId: String,
        installationId: String,
        expectedRevision: Int,
        purpose: NativePushPurpose,
        token: String,
        idempotencyKey: String,
    ): NativeCommandReceipt
    suspend fun suspendNativeInstallation(
        projectId: String,
        installationId: String,
        expectedRevision: Int,
        evidenceDigest: String,
        idempotencyKey: String,
    ): NativeCommandReceipt
    suspend fun revokeNativeInstallation(
        projectId: String,
        installationId: String,
        expectedRevision: Int,
        reason: String,
        evidenceDigest: String,
        idempotencyKey: String,
    ): NativeCommandReceipt
    suspend fun resumeNativeInstallation(
        projectId: String,
        installationId: String,
        expectedRevision: Int,
        evidenceDigest: String,
        idempotencyKey: String,
    ): NativeCommandReceipt
    suspend fun retirePushToken(
        projectId: String,
        installationId: String,
        expectedRevision: Int,
        purpose: NativePushPurpose,
        evidenceDigest: String,
        idempotencyKey: String,
    ): NativeCommandReceipt
    suspend fun requestVoipSession(
        projectId: String,
        installationId: String,
        expectedRevision: Int,
        idempotencyKey: String,
    ): NativeVoiceSession
}

class ResponderApi(
    baseUrl: String,
    private val authorityStore: DeviceAuthorityStore,
    private val transport: HttpTransport = HttpsUrlTransport(),
    private val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    },
) : NativeClientApi {
    private val baseUri = validateBaseUrl(baseUrl)
    @Volatile private var organizationId: String? = null
    @Volatile private var csrfToken: String? = null

    fun selectOrganization(value: String?) {
        organizationId = value?.let(::validUuid)
    }

    fun currentOrganization(): String? = organizationId

    suspend fun bootstrapCsrf() {
        val response: CsrfResponse = read("csrf", includeTenant = false)
        require(response.csrfToken.length >= 32) { "CSRF authority is invalid." }
        csrfToken = response.csrfToken
    }

    suspend fun me(): MeResponse = read<MeResponse>("me", includeTenant = false).also {
        require(it.csrfToken.length >= 32) { "CSRF authority is invalid." }
        csrfToken = it.csrfToken
    }

    suspend fun register(
        name: String,
        organizationName: String,
        email: String,
        password: String,
        idempotencyKey: String,
    ): RegistrationResponse = write(
        path = "auth/register",
        method = "POST",
        body = RegisterBody(name, organizationName, email, password),
        idempotencyKey = idempotencyKey,
        includeTenant = false,
    )

    suspend fun completeRegistration(token: String, idempotencyKey: String): AuthenticationResponse =
        write("auth/register/complete", "POST", TokenBody(token), idempotencyKey, false)

    suspend fun signIn(
        email: String,
        password: String,
        idempotencyKey: String,
    ): AuthenticationResponse =
        write("auth/sessions", "POST", SignInBody(email, password), idempotencyKey, false)

    suspend fun signOut(idempotencyKey: String): SignOutResponse {
        val priorCookie = authorityStore.sessionCookie()
        return try {
            val response: SignOutResponse = write(
                "auth/sessions/current",
                "DELETE",
                EmptyBody(),
                idempotencyKey,
                false,
            )
            require(response.signedOut) { "The server did not confirm session revocation." }
            csrfToken = null
            organizationId = null
            authorityStore.clearSessionCookie()
            response
        } catch (error: Throwable) {
            if (priorCookie == null) {
                authorityStore.clearSessionCookie()
            } else {
                authorityStore.saveSessionCookie(priorCookie)
            }
            throw error
        }
    }

    suspend fun requestRecovery(email: String, idempotencyKey: String): RecoveryResponse =
        write("auth/recovery", "POST", RecoveryBody(email), idempotencyKey, false)

    suspend fun completeRecovery(
        token: String,
        password: String,
        idempotencyKey: String,
    ): RecoveryCompletionResponse = write(
        "auth/recovery/complete",
        "POST",
        RecoveryCompleteBody(token, password),
        idempotencyKey,
        false,
    )

    suspend fun organizations(): OrganizationsResponse = read("organizations", false)

    suspend fun projects(selectedOrganizationId: String): ProjectsResponse = read(
        "organizations/${validUuid(selectedOrganizationId)}/projects",
        includeTenant = false,
    )

    suspend fun capabilities(): ResponderCapabilities = read("capabilities", false)

    suspend fun responderDashboard(): ResponderDashboard = read("responder", true)

    suspend fun forwarding(projectId: String): ForwardingList = read(
        "responder/projects/${validUuid(projectId)}/forwarding",
        includeTenant = true,
    )

    suspend fun createForwarding(
        projectId: String,
        businessLine: String,
        consentEvidenceDigest: String,
        numberBindingId: String,
        idempotencyKey: String,
    ): ForwardingCommandReceipt = write(
        "responder/projects/${validUuid(projectId)}/forwarding",
        "POST",
        ForwardingCreateBody(
            businessLine = businessLine,
            consentEvidenceDigest = validDigest(consentEvidenceDigest),
            numberBindingId = validUuid(numberBindingId),
        ),
        idempotencyKey,
        true,
    )

    suspend fun retireForwarding(
        projectId: String,
        onboardingId: String,
        expectedRevision: Int,
        evidenceDigest: String,
        idempotencyKey: String,
    ): ForwardingCommandReceipt = write(
        "responder/projects/${validUuid(projectId)}/forwarding/" +
            "${validUuid(onboardingId)}/retire",
        "POST",
        ForwardingRetireBody(
            expectedRevision = validRevision(expectedRevision),
            evidenceDigest = validDigest(evidenceDigest),
        ),
        idempotencyKey,
        true,
    )

    override suspend fun nativeInstallations(projectId: String): NativeInstallationList = read(
        "responder/projects/${validUuid(projectId)}/native-installations",
        includeTenant = true,
    )

    override suspend fun createNativeInstallation(
        projectId: String,
        environment: NativeAppEnvironment,
        appVersion: String,
        buildNumber: String,
        installationKeyDigest: String,
        idempotencyKey: String,
    ): NativeCommandReceipt = write(
        "responder/projects/${validUuid(projectId)}/native-installations",
        "POST",
        NativeCreateBody(
            platform = NativePlatform.android,
            bundleId = BUNDLE_ID,
            appEnvironment = environment,
            appVersion = appVersion,
            buildNumber = buildNumber,
            installationKeyDigest = validDigest(installationKeyDigest),
        ),
        idempotencyKey,
        true,
    )

    override suspend fun registerPushToken(
        projectId: String,
        installationId: String,
        expectedRevision: Int,
        purpose: NativePushPurpose,
        token: String,
        idempotencyKey: String,
    ): NativeCommandReceipt {
        DeviceAuthorityStore.validateFcmToken(token)
        return write(
            nativePath(projectId, installationId, "push-tokens"),
            "POST",
            NativeTokenBody(validRevision(expectedRevision), purpose, token),
            idempotencyKey,
            true,
        )
    }

    override suspend fun suspendNativeInstallation(
        projectId: String,
        installationId: String,
        expectedRevision: Int,
        evidenceDigest: String,
        idempotencyKey: String,
    ): NativeCommandReceipt = transition(
        projectId,
        installationId,
        expectedRevision,
        "logout",
        evidenceDigest,
        idempotencyKey,
    )

    override suspend fun revokeNativeInstallation(
        projectId: String,
        installationId: String,
        expectedRevision: Int,
        reason: String,
        evidenceDigest: String,
        idempotencyKey: String,
    ): NativeCommandReceipt {
        require(reason in setOf("customer_request", "device_lost", "token_compromise"))
        return transition(
            projectId,
            installationId,
            expectedRevision,
            reason,
            evidenceDigest,
            idempotencyKey,
        )
    }

    override suspend fun resumeNativeInstallation(
        projectId: String,
        installationId: String,
        expectedRevision: Int,
        evidenceDigest: String,
        idempotencyKey: String,
    ): NativeCommandReceipt = write(
        nativePath(projectId, installationId, "resume"),
        "POST",
        NativeResumeBody(validRevision(expectedRevision), validDigest(evidenceDigest)),
        idempotencyKey,
        true,
    )

    override suspend fun retirePushToken(
        projectId: String,
        installationId: String,
        expectedRevision: Int,
        purpose: NativePushPurpose,
        evidenceDigest: String,
        idempotencyKey: String,
    ): NativeCommandReceipt = write(
        nativePath(projectId, installationId, "push-tokens/retire"),
        "POST",
        NativeTokenRetireBody(
            validRevision(expectedRevision),
            purpose,
            validDigest(evidenceDigest),
        ),
        idempotencyKey,
        true,
    )

    override suspend fun requestVoipSession(
        projectId: String,
        installationId: String,
        expectedRevision: Int,
        idempotencyKey: String,
    ): NativeVoiceSession = write(
        nativePath(projectId, installationId, "voip-session"),
        "POST",
        NativeVoipBody(validRevision(expectedRevision)),
        idempotencyKey,
        true,
    )

    suspend fun requestHandoff(
        interactionId: String,
        expectedRevision: Int,
        evidenceDigest: String,
        idempotencyKey: String,
    ): JsonElement = write(
        "responder/interactions/${validUuid(interactionId)}/handoff",
        "POST",
        HandoffBody(validRevision(expectedRevision), validDigest(evidenceDigest)),
        idempotencyKey,
        true,
    )

    private suspend fun transition(
        projectId: String,
        installationId: String,
        expectedRevision: Int,
        reason: String,
        evidenceDigest: String,
        idempotencyKey: String,
    ): NativeCommandReceipt = write(
        nativePath(projectId, installationId, "revoke"),
        "POST",
        NativeTransitionBody(validRevision(expectedRevision), reason, validDigest(evidenceDigest)),
        idempotencyKey,
        true,
    )

    private fun nativePath(projectId: String, installationId: String, suffix: String): String =
        "responder/projects/${validUuid(projectId)}/native-installations/" +
            "${validUuid(installationId)}/$suffix"

    private suspend inline fun <reified Response> read(
        path: String,
        includeTenant: Boolean,
    ): Response = request(path, "GET", null, null, includeTenant, allowCsrfRetry = false)

    private suspend inline fun <reified Body, reified Response> write(
        path: String,
        method: String,
        body: Body,
        idempotencyKey: String,
        includeTenant: Boolean,
    ): Response {
        require(COMMAND.matches(idempotencyKey)) { "Idempotency key is invalid." }
        if (csrfToken == null) bootstrapCsrf()
        return request(
            path,
            method,
            json.encodeToString(body).encodeToByteArray(),
            idempotencyKey,
            includeTenant,
            allowCsrfRetry = true,
        )
    }

    private suspend inline fun <reified Response> request(
        path: String,
        method: String,
        body: ByteArray?,
        idempotencyKey: String?,
        includeTenant: Boolean,
        allowCsrfRetry: Boolean,
    ): Response {
        var csrfRetryAvailable = allowCsrfRetry
        while (true) {
            val headers = linkedMapOf(
                "Accept" to "application/json",
                "Cache-Control" to "no-store",
                "User-Agent" to "SiteSourceryResponderAndroid/1",
            )
            body?.let { headers["Content-Type"] = "application/json" }
            authorityStore.sessionCookie()?.let { headers["Cookie"] = "ss_session=$it" }
            if (includeTenant) {
                headers["X-SiteSourcery-Organization-Id"] =
                    organizationId ?: throw ApiException(
                        "ORGANIZATION_SELECTION_REQUIRED",
                        "Choose a business before continuing.",
                        400,
                    )
            }
            idempotencyKey?.let {
                headers["Idempotency-Key"] = it
                headers["X-CSRF-Token"] = csrfToken ?: throw ApiException(
                    "CSRF_TOKEN_REQUIRED",
                    "The secure write token is unavailable.",
                    403,
                )
            }
            val response = transport.execute(HttpRequest(method, endpoint(path), headers, body))
            if (response.status !in 200..299) {
                val error = decodeError(response)
                if (csrfRetryAvailable && error.code == "CSRF_TOKEN_REQUIRED") {
                    csrfRetryAvailable = false
                    csrfToken = null
                    bootstrapCsrf()
                    continue
                }
                throw error
            }
            receiveSessionCookie(response)
            if (response.body.isEmpty()) {
                throw ApiException("INVALID_RESPONSE", "The server returned an empty response.", 502)
            }
            return try {
                json.decodeFromString(response.body.decodeToString())
            } catch (_: Exception) {
                throw ApiException("INVALID_RESPONSE", "The server response was invalid.", 502)
            }
        }
    }

    private fun receiveSessionCookie(response: HttpResponse) {
        val values = response.headers.entries
            .filter { it.key.equals("set-cookie", ignoreCase = true) }
            .flatMap { it.value }
        values.firstOrNull { it.startsWith("ss_session=") }?.let { header ->
            val attributes = header.split(';').map(String::trim)
            val value = attributes.first().substringAfter('=', missingDelimiterValue = "")
            val secure = attributes.any { it.equals("Secure", ignoreCase = true) }
            val httpOnly = attributes.any { it.equals("HttpOnly", ignoreCase = true) }
            val strict = attributes.any { it.equals("SameSite=Strict", ignoreCase = true) }
            val path = attributes.firstOrNull { it.startsWith("Path=", ignoreCase = true) }
                ?.substringAfter('=')
            if (value.isEmpty()) {
                authorityStore.clearSessionCookie()
            } else {
                require(secure && httpOnly && strict && path == "/api/v1") {
                    "Session cookie authority is invalid."
                }
                authorityStore.saveSessionCookie(value)
            }
        }
    }

    private fun decodeError(response: HttpResponse): ApiException = try {
        val envelope = json.decodeFromString<ErrorEnvelope>(response.body.decodeToString())
        ApiException(
            code = envelope.error.code,
            message = envelope.error.message,
            status = response.status,
            requestId = envelope.error.requestId,
        )
    } catch (_: Exception) {
        ApiException("HTTP_${response.status}", "The request could not be completed.", response.status)
    }

    private fun endpoint(path: String): URL {
        require(ROUTE.matches(path) && !path.contains("..")) { "API route is invalid." }
        val resolved = baseUri.resolve(baseUri.path.trimEnd('/') + "/" + path)
        require(resolved.scheme == baseUri.scheme && resolved.authority == baseUri.authority)
        require(resolved.query == null && resolved.fragment == null)
        return resolved.toURL()
    }

    companion object {
        const val BUNDLE_ID = "com.sitesourcery.responder"
        private val UUID_PATTERN = Regex(
            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
        )
        private val DIGEST = Regex("^[0-9a-f]{64}$")
        private val COMMAND = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$")
        private val ROUTE = Regex("^[A-Za-z0-9][A-Za-z0-9_./-]{0,511}$")

        fun validateBaseUrl(value: String): URI {
            val uri = URI(value)
            require(uri.scheme == "https") { "Site Sourcery API must use HTTPS." }
            require(uri.rawUserInfo == null && uri.query == null && uri.fragment == null)
            require(uri.host != null && uri.port == -1)
            require(uri.path == "/api/v1" || uri.path == "/api/v1/")
            return URI(uri.scheme, null, uri.host, -1, "/api/v1/", null, null)
        }

        fun validUuid(value: String): String {
            val canonical = value.lowercase()
            require(UUID_PATTERN.matches(canonical) && UUID.fromString(canonical).toString() == canonical)
            return canonical
        }

        fun validDigest(value: String): String = value.also {
            require(DIGEST.matches(it)) { "Evidence digest is invalid." }
        }

        fun validRevision(value: Int): Int = value.also { require(it > 0) }
    }
}

@Serializable private data class CsrfResponse(val csrfToken: String)
@Serializable private data class RegisterBody(
    val name: String,
    val organizationName: String,
    val email: String,
    val password: String,
)
@Serializable private data class TokenBody(val token: String)
@Serializable private data class SignInBody(val email: String, val password: String)
@Serializable private data class RecoveryBody(val email: String)
@Serializable private data class RecoveryCompleteBody(val token: String, val password: String)
@Serializable private class EmptyBody
@Serializable private data class ForwardingCreateBody(
    val businessLine: String,
    val consentEvidenceDigest: String,
    val numberBindingId: String,
)
@Serializable private data class ForwardingRetireBody(
    val expectedRevision: Int,
    val reason: String = "customer_cancelled",
    val evidenceDigest: String,
)
@Serializable private data class NativeCreateBody(
    val platform: NativePlatform,
    val bundleId: String,
    val appEnvironment: NativeAppEnvironment,
    val appVersion: String,
    val buildNumber: String,
    val installationKeyDigest: String,
)
@Serializable private data class NativeTokenBody(
    val expectedRevision: Int,
    val purpose: NativePushPurpose,
    val token: String,
)
@Serializable private data class NativeTransitionBody(
    val expectedRevision: Int,
    val reason: String,
    val evidenceDigest: String,
)
@Serializable private data class NativeResumeBody(
    val expectedRevision: Int,
    val evidenceDigest: String,
)
@Serializable private data class NativeTokenRetireBody(
    val expectedRevision: Int,
    val purpose: NativePushPurpose,
    val evidenceDigest: String,
)
@Serializable private data class NativeVoipBody(val expectedRevision: Int)
@Serializable private data class HandoffBody(val expectedRevision: Int, val evidenceDigest: String)
@Serializable private data class ErrorEnvelope(val error: ErrorValue)
@Serializable private data class ErrorValue(
    val code: String,
    val message: String,
    val requestId: String? = null,
)
