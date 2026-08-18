package com.sitesourcery.responder.voice

import com.sitesourcery.responder.security.VoiceProviderAuthority
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CallGenerationAuthorityTest {
    @Test
    fun closeReopenRejectsStalePermitGenerationAndDisplayStop() {
        val firstPermit = permit("permit-one", "session-one")
        val secondPermit = permit("permit-two", "session-two")
        var currentPermit: VoiceIncomingPermit? = firstPermit
        val identifiers = ArrayDeque(listOf(GENERATION_ONE, GENERATION_TWO))
        val authority = IncomingCallAuthority(
            isPermitCurrent = { it === currentPermit },
            identifier = { identifiers.removeFirst() },
        )

        assertEquals(GENERATION_ONE, checkNotNull(authority.admit(firstPermit)).generation)
        currentPermit = null
        assertNull(authority.current(GENERATION_ONE))
        authority.invalidate()
        currentPermit = secondPermit
        assertEquals(GENERATION_TWO, checkNotNull(authority.admit(secondPermit)).generation)

        assertNull(authority.current(firstPermit))
        assertFalse(authority.finish(GENERATION_ONE))
        assertEquals(GENERATION_TWO, authority.current(GENERATION_TWO)?.generation)

        val displayed = DisplayedCallAuthority()
        displayed.display(GENERATION_ONE)
        displayed.display(GENERATION_TWO)
        assertFalse(displayed.stop(GENERATION_ONE))
        assertFalse(displayed.isEmpty())
        assertTrue(displayed.stop(GENERATION_TWO))
        assertTrue(displayed.isEmpty())
    }

    @Test
    fun acceptCompletionAfterQuiesceCannotPublishIntoReplacementGeneration() {
        val firstPermit = permit("permit-one", "session-one")
        val secondPermit = permit("permit-two", "session-two")
        var currentPermit: VoiceIncomingPermit? = firstPermit
        val identifiers = ArrayDeque(
            listOf(GENERATION_ONE, ACCEPT_ONE, GENERATION_TWO, ACCEPT_TWO)
        )
        val authority = IncomingCallAuthority(
            isPermitCurrent = { it === currentPermit },
            identifier = { identifiers.removeFirst() },
        )

        assertNotNull(authority.admit(firstPermit))
        assertTrue(authority.claimAnswer(GENERATION_ONE))
        val staleAccept = checkNotNull(authority.beginAccept(GENERATION_ONE))
        authority.invalidate()
        currentPermit = secondPermit
        assertNotNull(authority.admit(secondPermit))

        assertFalse(authority.completeAccept(staleAccept))
        assertEquals(GENERATION_TWO, authority.current(GENERATION_TWO)?.generation)
        assertTrue(authority.claimAnswer(GENERATION_TWO))
        val currentAccept = checkNotNull(authority.beginAccept(GENERATION_TWO))
        assertTrue(authority.completeAccept(currentAccept))
        assertEquals(GENERATION_TWO, authority.current(GENERATION_TWO)?.generation)
    }

    @Test
    fun notificationActionsAreOnceAndPhaseBoundWithinOneGeneration() {
        val permit = permit("permit-one", "session-one")
        val authority = IncomingCallAuthority(
            isPermitCurrent = { it === permit },
            identifier = { GENERATION_ONE },
        )
        assertNotNull(authority.admit(permit))
        assertTrue(authority.claimAnswer(GENERATION_ONE))
        // A concurrent Telecom answer loses to the notification answer but
        // must not tear down the winning generation.
        assertFalse(authority.claimAnswer(GENERATION_ONE))
        assertEquals(GENERATION_ONE, authority.current(GENERATION_ONE)?.generation)
        assertFalse(authority.claimDecline(GENERATION_ONE))
        assertFalse(authority.claimEnd(GENERATION_ONE))
        val ticket = checkNotNull(authority.beginAccept(GENERATION_ONE))
        assertTrue(authority.completeAccept(ticket))
        assertFalse(authority.claimDecline(GENERATION_ONE))
        assertTrue(authority.claimEnd(GENERATION_ONE))
        assertFalse(authority.claimEnd(GENERATION_ONE))

        authority.finish(GENERATION_ONE)
        assertNotNull(authority.admit(permit))
        assertTrue(authority.claimDecline(GENERATION_ONE))
        assertFalse(authority.claimAnswer(GENERATION_ONE))
        assertFalse(authority.claimDecline(GENERATION_ONE))
        assertFalse(authority.claimEnd(GENERATION_ONE))
    }

    private fun permit(id: String, sessionId: String) = VoiceIncomingPermit(
        id = id,
        authority = VoiceProviderAuthority(
            organizationId = "10000000-0000-4000-8000-000000000001",
            projectId = "20000000-0000-4000-8000-000000000001",
            customerUserId = "30000000-0000-4000-8000-000000000001",
            installationId = "40000000-0000-4000-8000-000000000001",
            installationRevision = 2,
            appEnvironment = "sandbox",
            clientPlatform = "android",
            transport = "twilio_voice_android",
            fcmToken = "fcm-token-aaaaaaaaaaaaaaaaaaaa",
            sessionId = sessionId,
            identityDigest = "a".repeat(64),
            credentialDigest = "b".repeat(64),
            authorizationExpiresAt = "2030-01-01T00:05:00Z",
        ),
    )

    companion object {
        private const val GENERATION_ONE = "50000000-0000-4000-8000-000000000001"
        private const val GENERATION_TWO = "50000000-0000-4000-8000-000000000002"
        private const val ACCEPT_ONE = "60000000-0000-4000-8000-000000000001"
        private const val ACCEPT_TWO = "60000000-0000-4000-8000-000000000002"
    }
}
