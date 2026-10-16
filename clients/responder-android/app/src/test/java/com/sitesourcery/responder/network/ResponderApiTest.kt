package com.sitesourcery.responder.network

import com.sitesourcery.responder.core.NativeAppEnvironment
import com.sitesourcery.responder.MemorySecureValueStore
import com.sitesourcery.responder.security.DeviceAuthorityStore
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ResponderApiTest {
    @Test
    fun exactBuildEnvironmentUsesSlotSupportWithoutOpeningOtherPlatformsOrLegacyClients() = runTest {
        suspend fun selected(slots: String) = ResponderApi(API_ORIGIN, DeviceAuthorityStore(MemorySecureValueStore()),
            ScriptedTransport(json(200, capabilities(
                "\"voiceRoutingMode\":\"verified-native-client\",\"routingReady\":false,\"operationalCalls\":false,\"routingSlots\":$slots,"
            )))).capabilities().responderNativeClient
        val android = selected("{\"android\":{\"sandbox\":true,\"production\":false},\"ios\":{\"sandbox\":false,\"production\":false}}")
        assertTrue(android.incomingCallsAvailable(NativeAppEnvironment.sandbox))
        assertFalse(android.incomingCallsAvailable(NativeAppEnvironment.production))
        assertFalse(android.incomingCallsAvailable)
        assertFalse(android.copy(backendReady = false).incomingCallsAvailable(NativeAppEnvironment.sandbox))
        assertFalse(android.copy(providerAuthorizationEffects = false).incomingCallsAvailable(NativeAppEnvironment.sandbox))
        assertFalse(android.copy(voiceRoutingMode = "held").incomingCallsAvailable(NativeAppEnvironment.sandbox))
        for (slots in listOf("{}", "{\"ios\":{\"sandbox\":true}}", "{\"android\":{\"production\":true}}", "{\"android\":{\"future\":true}}")) {
            // Even a contradictory true legacy field cannot override an explicit unavailable slot.
            val capability = selected(slots).copy(routingReady = true, operationalCalls = true)
            assertFalse(capability.incomingCallsAvailable(NativeAppEnvironment.sandbox))
        }
    }

    @Test
    fun nativeRoutingAvailabilityDecodesSeparatelyFromDistributionAndTokenEffects() = runTest {
        val transport = ScriptedTransport(json(200, capabilities(
            "\"voiceRoutingMode\":\"verified-native-client\",\"routingReady\":true,\"operationalCalls\":true,"
        )))
        val api = ResponderApi(API_ORIGIN, DeviceAuthorityStore(MemorySecureValueStore()), transport)
        val native = api.capabilities().responderNativeClient
        assertTrue(native.incomingCallsAvailable)
        assertFalse(native.ready)
        assertFalse(native.clientsReady)
        assertFalse(native.providerEffects)
        assertFalse(native.pushDeliveryEffects)
        assertFalse(native.voiceCallEffects)
        assertEquals("GET", transport.requests.single().method)
        assertEquals("/api/v1/capabilities", transport.requests.single().url.path)
    }

    @Test
    fun legacyHeldAndPartialRoutingCapabilitiesFailClosed() = runTest {
        for (fields in listOf(
            "",
            "\"voiceRoutingMode\":\"held\",\"routingReady\":true,\"operationalCalls\":true,",
            "\"voiceRoutingMode\":\"future-mode\",\"routingReady\":true,\"operationalCalls\":true,",
            "\"voiceRoutingMode\":\"verified-native-client\",\"routingReady\":false,\"operationalCalls\":true,",
            "\"voiceRoutingMode\":\"verified-native-client\",\"routingReady\":true,",
        )) {
            val api = ResponderApi(API_ORIGIN, DeviceAuthorityStore(MemorySecureValueStore()),
                ScriptedTransport(json(200, capabilities(fields))))
            assertFalse(api.capabilities().responderNativeClient.incomingCallsAvailable)
        }
        val enabled = ResponderApi(API_ORIGIN, DeviceAuthorityStore(MemorySecureValueStore()),
            ScriptedTransport(json(200, capabilities(
                "\"voiceRoutingMode\":\"verified-native-client\",\"routingReady\":true,\"operationalCalls\":true,"
            )))).capabilities().responderNativeClient
        assertFalse(enabled.copy(backendReady = false).incomingCallsAvailable)
        assertFalse(enabled.copy(mounted = false).incomingCallsAvailable)
        assertFalse(enabled.copy(providerAuthorizationEffects = false).incomingCallsAvailable)
        assertFalse(enabled.copy(voipSessionState = "held").incomingCallsAvailable)
        assertFalse(enabled.copy(voipTransports = listOf("twilio_voice_ios")).incomingCallsAvailable)
    }

    @Test
    fun csrfRetryPreservesBodyAndIdempotency() = runTest {
        val transport = ScriptedTransport(
            json(200, "{\"csrfToken\":\"${"a".repeat(32)}\"}"),
            json(
                403,
                "{\"error\":{\"code\":\"CSRF_TOKEN_REQUIRED\",\"message\":\"refresh\"}}",
            ),
            json(200, "{\"csrfToken\":\"${"b".repeat(32)}\"}"),
            json(200, "{\"accepted\":true,\"delivery\":\"held\",\"emailSent\":false}"),
        )
        val api = ResponderApi(API_ORIGIN, DeviceAuthorityStore(MemorySecureValueStore()), transport)
        api.requestRecovery("owner@example.test", COMMAND)
        val first = transport.requests[1]
        val retry = transport.requests[3]
        assertEquals(first.method, retry.method)
        assertEquals(first.url, retry.url)
        assertArrayEquals(first.body, retry.body)
        assertEquals(COMMAND, first.headers["Idempotency-Key"])
        assertEquals(COMMAND, retry.headers["Idempotency-Key"])
        assertNotEquals(first.headers["X-CSRF-Token"], retry.headers["X-CSRF-Token"])
        assertEquals(4, transport.requests.size)
    }

    @Test
    fun cookieAuthorityRequiresEverySecurityAttribute() = runTest {
        val memory = MemorySecureValueStore()
        val store = DeviceAuthorityStore(memory)
        val valid = "session-cookie-aaaaaaaaaaaaaaaa"
        val transport = ScriptedTransport(
            json(
                200,
                "{\"csrfToken\":\"${"a".repeat(32)}\"}",
                mapOf("Set-Cookie" to listOf(
                    "ss_session=$valid; Secure; HttpOnly; SameSite=Strict; Path=/api/v1"
                )),
            ),
            json(
                200,
                "{\"csrfToken\":\"${"b".repeat(32)}\"}",
                mapOf("Set-Cookie" to listOf(
                    "ss_session=attacker-session-aaaaaaaa; Secure; SameSite=Strict; Path=/api/v1"
                )),
            ),
        )
        val api = ResponderApi(API_ORIGIN, store, transport)
        api.bootstrapCsrf()
        assertEquals(valid, store.sessionCookie())
        assertTrue(runCatching { api.bootstrapCsrf() }.exceptionOrNull() is IllegalArgumentException)
        assertEquals(valid, store.sessionCookie())
        assertThrows(IllegalArgumentException::class.java) {
            ResponderApi("http://sitesourcery.com/api/v1", store, transport)
        }
        assertThrows(IllegalArgumentException::class.java) {
            ResponderApi("https://user@sitesourcery.com/api/v1", store, transport)
        }
    }

    @Test
    fun signOutFailureRetainsCookieAndWorkspaceUntilConfirmed() = runTest {
        val memory = MemorySecureValueStore()
        val store = DeviceAuthorityStore(memory)
        val cookie = "session-cookie-bbbbbbbbbbbbbbbb"
        store.saveSessionCookie(cookie)
        val transport = ScriptedTransport(
            json(200, "{\"csrfToken\":\"${"a".repeat(32)}\"}"),
            json(
                503,
                "{\"error\":{\"code\":\"UPSTREAM_UNAVAILABLE\",\"message\":\"retry\"}}",
                clearingCookie(),
            ),
            json(200, "{\"signedOut\":false}", clearingCookie()),
            json(200, "{\"signedOut\":true}", clearingCookie()),
        )
        val api = ResponderApi(API_ORIGIN, store, transport)
        api.selectOrganization(ORGANIZATION)
        assertTrue(runCatching { api.signOut(COMMAND) }.exceptionOrNull() is ApiException)
        assertEquals(cookie, store.sessionCookie())
        assertEquals(ORGANIZATION, api.currentOrganization())
        assertTrue(
            runCatching { api.signOut(COMMAND_TWO) }.exceptionOrNull() is IllegalArgumentException
        )
        assertEquals(cookie, store.sessionCookie())
        assertEquals(ORGANIZATION, api.currentOrganization())
        assertEquals(true, api.signOut(COMMAND_THREE).signedOut)
        assertNull(store.sessionCookie())
        assertNull(api.currentOrganization())
    }

    private class ScriptedTransport(vararg responses: HttpResponse) : HttpTransport {
        private val pending = ArrayDeque(responses.toList())
        val requests = mutableListOf<HttpRequest>()

        override suspend fun execute(request: HttpRequest): HttpResponse {
            requests += request.copy(body = request.body?.copyOf())
            return pending.removeFirst()
        }
    }

    companion object {
        private fun capabilities(routing: String) = """
            {"responder":true,"responderForwarding":{
              "ready":true,"mounted":true,"mode":"held","retainedCarrier":true,
              "launchMode":"conditional_no_answer_forwarding","initialAdapter":"manual",
              "automaticCarrierCommands":false,"remoteWriteEffects":false,
              "providerEffects":false,"messageSendEffects":false},
             "responderNativeClient":{$routing
              "ready":false,"backendReady":true,"clientsReady":false,"mounted":true,
              "mode":"verified","acceptedRegistrationPlatforms":["ios","android"],
              "initialClient":"native","clientArtifacts":{"ios":false,"android":false},
              "tokenStorage":"encrypted","voipSessionState":"verified",
              "voipTransports":["twilio_voice_ios","twilio_voice_android"],
              "providerAuthorizationEffects":true,"providerEffects":false,
              "pushDeliveryEffects":false,"voiceCallEffects":false,
              "carrierCommandEffects":false,"messageSendEffects":false}}
        """.trimIndent()

        private const val API_ORIGIN = "https://sitesourcery.com/api/v1"
        private const val ORGANIZATION = "10000000-0000-4000-8000-000000000001"
        private const val COMMAND = "android.api.11111111111111111111111111111111"
        private const val COMMAND_TWO = "android.api.22222222222222222222222222222222"
        private const val COMMAND_THREE = "android.api.33333333333333333333333333333333"

        private fun json(
            status: Int,
            body: String,
            headers: Map<String, List<String>> = emptyMap(),
        ) = HttpResponse(status, headers, body.encodeToByteArray())

        private fun clearingCookie() = mapOf(
            "Set-Cookie" to listOf(
                "ss_session=; Secure; HttpOnly; SameSite=Strict; Path=/api/v1"
            )
        )
    }
}
