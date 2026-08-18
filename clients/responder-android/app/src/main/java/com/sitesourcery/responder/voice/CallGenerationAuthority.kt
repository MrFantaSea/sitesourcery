package com.sitesourcery.responder.voice

import java.util.UUID

internal data class IncomingCallLease(
    val generation: String,
    val permit: VoiceIncomingPermit,
)

internal data class IncomingAcceptTicket(
    val lease: IncomingCallLease,
    val attemptId: String,
)

/**
 * The provider, Telecom, and notification callbacks all outlive their caller.
 * This fence gives every admitted invite one exact permit and generation and
 * makes teardown invalidate every outstanding callback atomically.
 */
internal class IncomingCallAuthority(
    private val isPermitCurrent: (VoiceIncomingPermit) -> Boolean,
    private val identifier: () -> String = { UUID.randomUUID().toString() },
) {
    private enum class Phase { pending, answering, active, ending }

    private var current: IncomingCallLease? = null
    private var accepting: IncomingAcceptTicket? = null
    private var phase: Phase? = null

    @Synchronized
    fun admit(permit: VoiceIncomingPermit): IncomingCallLease? {
        if (current != null || !isPermitCurrent(permit)) return null
        return IncomingCallLease(identifier(), permit).also {
            current = it
            phase = Phase.pending
        }
    }

    @Synchronized
    fun current(generation: String): IncomingCallLease? = current?.takeIf {
        it.generation == generation && isPermitCurrent(it.permit)
    }

    @Synchronized
    fun current(permit: VoiceIncomingPermit): IncomingCallLease? = current?.takeIf {
        it.permit === permit && isPermitCurrent(permit)
    }

    @Synchronized
    fun beginAccept(generation: String): IncomingAcceptTicket? {
        val lease = current(generation) ?: return null
        if (accepting != null || phase != Phase.answering) return null
        return IncomingAcceptTicket(lease, identifier()).also { accepting = it }
    }

    @Synchronized
    fun claimAnswer(generation: String): Boolean = claim(
        generation,
        required = Phase.pending,
        resulting = Phase.answering,
    )

    @Synchronized
    fun claimDecline(generation: String): Boolean = claim(
        generation,
        required = Phase.pending,
        resulting = Phase.ending,
    )

    @Synchronized
    fun claimEnd(generation: String): Boolean = claim(
        generation,
        required = Phase.active,
        resulting = Phase.ending,
    )

    @Synchronized
    fun completeAccept(ticket: IncomingAcceptTicket): Boolean {
        if (accepting != ticket) return false
        accepting = null
        val accepted = current?.let {
            it == ticket.lease && isPermitCurrent(it.permit)
        } == true
        if (accepted) phase = Phase.active
        return accepted
    }

    @Synchronized
    fun cancelAccept(ticket: IncomingAcceptTicket) {
        if (accepting == ticket) accepting = null
    }

    @Synchronized
    fun invalidate(): IncomingCallLease? = current.also {
        current = null
        accepting = null
        phase = null
    }

    @Synchronized
    fun finish(generation: String): Boolean {
        if (current?.generation != generation) return false
        current = null
        accepting = null
        phase = null
        return true
    }

    private fun claim(
        generation: String,
        required: Phase,
        resulting: Phase,
    ): Boolean {
        if (current(generation) == null || phase != required) return false
        phase = resulting
        return true
    }
}

internal class DisplayedCallAuthority {
    private var generation: String? = null

    @Synchronized
    fun display(value: String) {
        generation = value
    }

    @Synchronized
    fun isEmpty(): Boolean = generation == null

    @Synchronized
    fun stop(expectedGeneration: String): Boolean {
        if (generation != expectedGeneration) return false
        generation = null
        return true
    }
}
