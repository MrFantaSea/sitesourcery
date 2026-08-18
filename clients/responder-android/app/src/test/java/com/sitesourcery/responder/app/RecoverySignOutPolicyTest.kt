package com.sitesourcery.responder.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RecoverySignOutPolicyTest {
    @Test
    fun wrongAuthenticatedActorCanSignOutWithoutDiscardingRecoveryAuthority() {
        assertTrue(
            authenticationOnlySignOutRequired("wrong-user", setOf("owner-user"), true),
        )
        assertTrue(
            authenticationOnlySignOutRequired(
                "wrong-user",
                setOf("native-owner", "voice-owner"),
                false,
            ),
        )
        assertFalse(
            authenticationOnlySignOutRequired("owner-user", setOf("owner-user"), true),
        )
        assertTrue(
            authenticationOnlySignOutRequired(
                "native-owner",
                setOf("native-owner", "voice-owner"),
                false,
            ),
        )
        assertTrue(
            authenticationOnlySignOutRequired("owner-user", setOf("owner-user"), false),
        )
        assertFalse(authenticationOnlySignOutRequired("any-user", emptySet(), true))
        assertFalse(authenticationOnlySignOutRequired(null, setOf("owner-user"), true))
    }
}
