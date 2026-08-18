package com.sitesourcery.responder.network

import com.sitesourcery.responder.MemorySecureValueStore
import com.sitesourcery.responder.security.DeviceAuthorityStore
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ResponderApiTest {
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
