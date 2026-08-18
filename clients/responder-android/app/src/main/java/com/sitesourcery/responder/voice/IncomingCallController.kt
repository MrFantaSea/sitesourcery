package com.sitesourcery.responder.voice

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.telecom.DisconnectCause
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.core.telecom.CallAttributesCompat
import androidx.core.telecom.CallControlResult
import androidx.core.telecom.CallControlScope
import androidx.core.telecom.CallsManager
import com.twilio.voice.Call
import com.twilio.voice.CallException
import com.twilio.voice.CallInvite
import com.twilio.voice.CancelledCallInvite
import com.twilio.voice.MessageListener
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

class IncomingCallController(
    context: Context,
    private val isPermitCurrent: (VoiceIncomingPermit) -> Boolean,
) {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val lock = Any()
    private val authority = IncomingCallAuthority(isPermitCurrent)
    private val callsManager = CallsManager(appContext).apply {
        registerAppWithTelecom(CallsManager.CAPABILITY_BASELINE)
    }
    private var session: CallSession? = null

    fun listenerFor(permit: VoiceIncomingPermit): MessageListener = object : MessageListener {
        override fun onCallInvite(callInvite: CallInvite) {
            receiveInvite(permit, callInvite)
        }

        override fun onCancelledCallInvite(
            cancelledCallInvite: CancelledCallInvite,
            callException: CallException?,
        ) {
            val current = synchronized(lock) {
                val lease = authority.current(permit)
                session?.takeIf {
                    lease?.generation == it.generation &&
                        it.invite?.callSid == cancelledCallInvite.callSid &&
                        it.permit === permit
                }
            }
            current?.actions?.trySend(Action.RemoteEnded)
        }
    }

    fun answer(expectedGeneration: String) = send(expectedGeneration, Action.Answer)

    fun decline(expectedGeneration: String) = send(expectedGeneration, Action.Decline)

    fun end(expectedGeneration: String) = send(expectedGeneration, Action.End)

    fun isBusy(): Boolean = synchronized(lock) { session != null }

    fun canPresent(expectedGeneration: String, ongoing: Boolean): Boolean =
        synchronized(lock) {
            session?.takeIf {
                it.generation == expectedGeneration &&
                    authority.current(expectedGeneration) != null &&
                    if (ongoing) it.call != null else it.call == null
            } != null
        }

    suspend fun quiesce() {
        val selected = synchronized(lock) {
            authority.invalidate()
            session.also {
                session = null
                it?.actions?.close()
            }
        }
        selected ?: return
        runCatching { selected.invite?.reject(appContext) }
        runCatching { selected.call?.disconnect() }
        ResponderCallService.stop(appContext, selected.generation)
        selected.acceptInFlight?.let { marker ->
            withTimeoutOrNull(QUIESCE_ACCEPT_WAIT_MS) { marker.await() }
        }
    }

    private fun receiveInvite(permit: VoiceIncomingPermit, callInvite: CallInvite) {
        val selected = try {
            synchronized(lock) {
                if (session != null) return@synchronized null
                val lease = authority.admit(permit) ?: return@synchronized null
                CallSession(
                    generation = lease.generation,
                    permit = permit,
                    actions = Channel(Channel.UNLIMITED),
                    invite = callInvite,
                ).also {
                    session = it
                    ResponderCallService.showIncoming(appContext, it.generation)
                }
            }
        } catch (_: Exception) {
            synchronized(lock) {
                session?.takeIf { it.invite === callInvite && it.permit == permit }?.let {
                    it.actions.close()
                    session = null
                    authority.finish(it.generation)
                }
            }
            null
        }
        if (selected == null) {
            runCatching { callInvite.reject(appContext) }
            return
        }
        scope.launch { addIncomingCall(selected.generation) }
    }

    private fun send(expectedGeneration: String, action: Action) {
        val selected = synchronized(lock) {
            val current = session?.takeIf {
                it.generation == expectedGeneration &&
                    authority.current(expectedGeneration) != null
            } ?: return@synchronized null
            val claimed = when (action) {
                Action.Answer -> authority.claimAnswer(expectedGeneration)
                Action.Decline -> authority.claimDecline(expectedGeneration)
                Action.End -> authority.claimEnd(expectedGeneration)
                else -> true
            }
            current.takeIf { claimed }
        }
        selected?.actions?.trySend(action)
    }

    private suspend fun addIncomingCall(expectedGeneration: String) {
        var rejected: CallInvite? = null
        val selected = synchronized(lock) {
            val current = session?.takeIf { it.generation == expectedGeneration }
                ?: return@synchronized null
            if (authority.current(expectedGeneration) == null) {
                rejected = current.invite
                current.actions.close()
                session = null
                authority.finish(expectedGeneration)
                null
            } else if (current.telecomStarted) {
                null
            } else {
                current.telecomStarted = true
                current
            }
        }
        if (selected == null) {
            runCatching { rejected?.reject(appContext) }
            if (rejected != null) ResponderCallService.stop(appContext, expectedGeneration)
            return
        }
        val attributes = CallAttributesCompat(
            displayName = "Site Sourcery call",
            address = "sitesourcery:incoming".toUri(),
            direction = CallAttributesCompat.DIRECTION_INCOMING,
            callType = CallAttributesCompat.CALL_TYPE_AUDIO_CALL,
            callCapabilities = 0,
        )
        try {
            callsManager.addCall(
                attributes,
                { acceptFromRemoteSurface(expectedGeneration) },
                { cause -> disconnectFromRemoteSurface(expectedGeneration, cause) },
                { Unit },
                { throw UnsupportedOperationException("Responder does not support call hold.") },
            ) {
                launch { processActions(expectedGeneration, selected.actions) }
            }
        } catch (_: Exception) {
            rejectPending(expectedGeneration)
            finish(expectedGeneration)
        }
    }

    private suspend fun CallControlScope.processActions(
        expectedGeneration: String,
        actionChannel: Channel<Action>,
    ) {
        try {
            for (action in actionChannel) {
                when (action) {
                    Action.Answer -> {
                        if (!isAuthorized(expectedGeneration) || !hasMicrophonePermission()) {
                            rejectPending(expectedGeneration)
                            disconnect(DisconnectCause(DisconnectCause.ERROR))
                            return
                        }
                        when (answer(CallAttributesCompat.CALL_TYPE_AUDIO_CALL)) {
                            is CallControlResult.Success -> if (!acceptTwilio(expectedGeneration)) {
                                disconnect(DisconnectCause(DisconnectCause.ERROR))
                                return
                            }
                            is CallControlResult.Error -> {
                                rejectPending(expectedGeneration)
                                disconnect(DisconnectCause(DisconnectCause.ERROR))
                                return
                            }
                        }
                    }
                    Action.Decline -> {
                        rejectPending(expectedGeneration)
                        disconnect(DisconnectCause(DisconnectCause.REJECTED))
                        return
                    }
                    Action.End -> {
                        currentCall(expectedGeneration)?.disconnect()
                        disconnect(DisconnectCause(DisconnectCause.LOCAL))
                        return
                    }
                    Action.Connected -> {
                        if (!isAuthorized(expectedGeneration)) return
                        setActive()
                        ResponderCallService.showOngoing(appContext, expectedGeneration)
                    }
                    Action.ConnectFailed -> {
                        disconnect(DisconnectCause(DisconnectCause.ERROR))
                        return
                    }
                    Action.RemoteEnded -> {
                        disconnect(DisconnectCause(DisconnectCause.REMOTE))
                        return
                    }
                }
            }
        } finally {
            finish(expectedGeneration)
        }
    }

    private fun acceptFromRemoteSurface(expectedGeneration: String) {
        val authorized = isAuthorized(expectedGeneration)
        if (!authorized || !hasMicrophonePermission()) {
            finish(expectedGeneration)
            throw SecurityException("Current Voice and microphone authority is required.")
        }
        val claimed = synchronized(lock) { authority.claimAnswer(expectedGeneration) }
        if (!claimed) return
        if (!acceptTwilio(expectedGeneration)) {
            finish(expectedGeneration)
            throw SecurityException("Current Voice and microphone authority is required.")
        }
    }

    private fun disconnectFromRemoteSurface(
        expectedGeneration: String,
        cause: DisconnectCause,
    ) {
        val selected = synchronized(lock) {
            session?.takeIf { it.generation == expectedGeneration }
        }
        if (cause.code == DisconnectCause.REJECTED || selected?.call == null) {
            runCatching { selected?.invite?.reject(appContext) }
        } else {
            runCatching { selected.call?.disconnect() }
        }
        finish(expectedGeneration)
    }

    private fun acceptTwilio(expectedGeneration: String): Boolean {
        val selected: CallInvite
        val marker = CompletableDeferred<Unit>()
        val ticket: IncomingAcceptTicket
        synchronized(lock) {
            val current = session?.takeIf {
                it.generation == expectedGeneration &&
                    authority.current(expectedGeneration) != null
            } ?: return false
            selected = current.invite ?: return false
            ticket = authority.beginAccept(expectedGeneration) ?: return false
            current.invite = null
            current.acceptInFlight = marker
        }
        var accepted: Call? = null
        return try {
            accepted = selected.accept(appContext, listenerForCall(expectedGeneration))
            synchronized(lock) {
                val authorized = authority.completeAccept(ticket)
                val current = if (authorized) {
                    session?.takeIf { it.generation == expectedGeneration }
                } else {
                    null
                }
                if (current == null || current.acceptInFlight !== marker) {
                    if (authorized) authority.finish(expectedGeneration)
                    false
                } else {
                    current.call = accepted
                    current.acceptInFlight = null
                    ResponderCallService.showOngoing(appContext, expectedGeneration)
                    true
                }
            }.also { published ->
                if (!published) accepted.disconnect()
            }
        } catch (_: Exception) {
            accepted?.disconnect()
            false
        } finally {
            synchronized(lock) {
                authority.cancelAccept(ticket)
                session?.takeIf {
                    it.generation == expectedGeneration && it.acceptInFlight === marker
                }?.acceptInFlight = null
            }
            marker.complete(Unit)
        }
    }

    private fun rejectPending(expectedGeneration: String) {
        val pending = synchronized(lock) {
            session?.takeIf { it.generation == expectedGeneration }?.let {
                it.invite.also { _ -> it.invite = null }
            }
        }
        runCatching { pending?.reject(appContext) }
    }

    private fun currentCall(expectedGeneration: String): Call? = synchronized(lock) {
        session?.takeIf { it.generation == expectedGeneration }?.call
    }

    private fun isAuthorized(expectedGeneration: String): Boolean = synchronized(lock) {
        session?.takeIf {
            it.generation == expectedGeneration &&
                authority.current(expectedGeneration) != null
        } != null
    }

    private fun hasMicrophonePermission(): Boolean =
        ContextCompat.checkSelfPermission(appContext, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    private fun finish(expectedGeneration: String) {
        val stopped = synchronized(lock) {
            val current = session?.takeIf { it.generation == expectedGeneration }
            current?.actions?.close()
            if (current != null) session = null
            authority.finish(expectedGeneration) || current != null
        }
        if (stopped) ResponderCallService.stop(appContext, expectedGeneration)
    }

    private fun listenerForCall(expectedGeneration: String) = object : Call.Listener {
        override fun onRinging(call: Call) = Unit

        override fun onConnectFailure(call: Call, callException: CallException) {
            sendForCall(expectedGeneration, call, Action.ConnectFailed)
        }

        override fun onConnected(call: Call) {
            sendForCall(expectedGeneration, call, Action.Connected)
        }

        override fun onReconnecting(call: Call, callException: CallException) = Unit

        override fun onReconnected(call: Call) = Unit

        override fun onDisconnected(call: Call, callException: CallException?) {
            sendForCall(expectedGeneration, call, Action.RemoteEnded)
        }

        override fun onCallQualityWarningsChanged(
            call: Call,
            currentWarnings: MutableSet<Call.CallQualityWarning>,
            previousWarnings: MutableSet<Call.CallQualityWarning>,
        ) = Unit
    }

    private fun sendForCall(expectedGeneration: String, source: Call, action: Action) {
        val selected = synchronized(lock) {
            session?.takeIf {
                it.generation == expectedGeneration &&
                    authority.current(expectedGeneration) != null &&
                    (it.call === source || (it.call == null && it.acceptInFlight != null))
            }
        }
        selected?.actions?.trySend(action)
    }

    private data class CallSession(
        val generation: String,
        val permit: VoiceIncomingPermit,
        val actions: Channel<Action>,
        var invite: CallInvite?,
        var call: Call? = null,
        var telecomStarted: Boolean = false,
        var acceptInFlight: CompletableDeferred<Unit>? = null,
    )

    private enum class Action { Answer, Decline, End, Connected, ConnectFailed, RemoteEnded }

    companion object {
        private const val QUIESCE_ACCEPT_WAIT_MS = 1_000L
    }
}
