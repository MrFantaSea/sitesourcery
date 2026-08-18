package com.sitesourcery.responder.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.sitesourcery.responder.core.ResponderDigest
import com.sitesourcery.responder.core.SecureValueStore
import java.io.File
import java.io.FileOutputStream
import java.security.KeyStore
import java.time.Instant
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class KeystoreValueStore(context: Context) : SecureValueStore {
    private val directory = File(context.noBackupFilesDir, "responder-authority-v1")
    private val alias = "sitesourcery.responder.authority.v1"
    private val lock = Any()

    init {
        check(directory.exists() || directory.mkdirs()) { "Secure authority directory unavailable." }
    }

    override fun read(key: String): ByteArray? = synchronized(lock) {
        val file = file(key)
        if (!file.exists()) return@synchronized null
        decrypt(key, file.readBytes())
    }

    override fun write(key: String, value: ByteArray) = synchronized(lock) {
        require(value.size <= MAX_VALUE_BYTES) { "Secure value is too large." }
        val target = file(key)
        val temporary = File(directory, target.name + ".pending")
        val sealed = encrypt(key, value)
        FileOutputStream(temporary).use { output ->
            output.write(sealed)
            output.fd.sync()
        }
        check(temporary.renameTo(target)) { "Secure value commit failed." }
    }

    override fun remove(key: String) = synchronized(lock) {
        val target = file(key)
        check(!target.exists() || target.delete()) { "Secure value removal failed." }
        val temporary = File(directory, target.name + ".pending")
        check(!temporary.exists() || temporary.delete()) { "Pending secure value removal failed." }
    }

    private fun file(key: String): File {
        require(KEY.matches(key)) { "Secure storage key is invalid." }
        return File(directory, ResponderDigest.sha256(key) + ".sealed")
    }

    private fun encrypt(key: String, value: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(CIPHER)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        cipher.updateAAD(aad(key))
        val ciphertext = cipher.doFinal(value)
        require(cipher.iv.size == IV_BYTES)
        return byteArrayOf(FORMAT_VERSION) + cipher.iv + ciphertext
    }

    private fun decrypt(key: String, sealed: ByteArray): ByteArray {
        require(sealed.size in MIN_SEALED_BYTES..MAX_SEALED_BYTES)
        require(sealed[0] == FORMAT_VERSION)
        val iv = sealed.copyOfRange(1, 1 + IV_BYTES)
        val ciphertext = sealed.copyOfRange(1 + IV_BYTES, sealed.size)
        val cipher = Cipher.getInstance(CIPHER)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, iv))
        cipher.updateAAD(aad(key))
        return cipher.doFinal(ciphertext)
    }

    private fun aad(key: String): ByteArray =
        "sitesourcery.responder.android-keystore/v1\u0000$key".encodeToByteArray()

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .setUserAuthenticationRequired(false)
                .build()
        )
        return generator.generateKey()
    }

    companion object {
        private const val CIPHER = "AES/GCM/NoPadding"
        private const val FORMAT_VERSION: Byte = 1
        private const val IV_BYTES = 12
        private const val TAG_BITS = 128
        private const val MAX_VALUE_BYTES = 16 * 1024
        private const val MIN_SEALED_BYTES = 1 + IV_BYTES + (TAG_BITS / 8)
        private const val MAX_SEALED_BYTES = MIN_SEALED_BYTES + MAX_VALUE_BYTES
        private val KEY = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$")
    }
}

data class VoiceProviderAuthority(
    val organizationId: String,
    val projectId: String,
    val customerUserId: String,
    val installationId: String,
    val installationRevision: Int,
    val appEnvironment: String,
    val clientPlatform: String,
    val transport: String,
    val fcmToken: String,
    val sessionId: String,
    val identityDigest: String,
    val credentialDigest: String,
    val authorizationExpiresAt: String,
)

data class NativeInstallationScope(
    val organizationId: String,
    val projectId: String,
    val customerUserId: String,
    val installationId: String?,
    val installationKeyDigest: String,
    val phase: NativeInstallationScopePhase,
    val releaseReason: String? = null,
)

enum class NativeInstallationScopePhase { active, release_pending }

enum class VoiceProviderAttemptKind { register, unregister }

data class VoiceProviderAttempt(
    val id: String,
    val kind: VoiceProviderAttemptKind,
    val target: VoiceProviderAuthority,
    val startedAt: String,
)

class DeviceAuthorityStore(private val store: SecureValueStore) {
    private val voiceLock = Any()

    fun installationSecret(projectId: String): ByteArray {
        val key = "sitesourcery.responder.installation-secret.v1.$projectId"
        store.read(key)?.let { existing ->
            require(existing.size == 32) { "Installation authority is corrupt." }
            return existing
        }
        val created = ResponderDigest.installationSecret()
        store.write(key, created)
        return created
    }

    fun saveFcmToken(token: String) {
        validateFcmToken(token)
        store.write(FCM_TOKEN_KEY, token.encodeToByteArray())
    }

    fun fcmToken(): String? = store.read(FCM_TOKEN_KEY)?.decodeToString()?.also(::validateFcmToken)

    fun clearFcmToken() = store.remove(FCM_TOKEN_KEY)

    fun nativeInstallationScope(): NativeInstallationScope? =
        store.read(NATIVE_INSTALLATION_SCOPE_KEY)?.decodeToString()?.let { encoded ->
            val fields = encoded.split('\n')
            require(fields.size == 8 && fields[0] == NATIVE_INSTALLATION_SCOPE_SCHEMA) {
                "Stored native installation scope is corrupt."
            }
            NativeInstallationScope(
                fields[1],
                fields[2],
                fields[3],
                fields[4].takeUnless { it == "-" },
                fields[5],
                NativeInstallationScopePhase.valueOf(fields[6]),
                fields[7].takeUnless { it == "-" },
            ).also(::validateNativeInstallationScope)
        }

    fun claimNativeInstallationScope(value: NativeInstallationScope): Boolean {
        validateNativeInstallationScope(value)
        val current = nativeInstallationScope()
        if (current != null) return current == value
        writeNativeInstallationScope(value)
        return true
    }

    fun replaceNativeInstallationScope(
        expected: NativeInstallationScope,
        replacement: NativeInstallationScope,
    ): Boolean {
        validateNativeInstallationScope(expected)
        validateNativeInstallationScope(replacement)
        val current = nativeInstallationScope() ?: return false
        if (current != expected ||
            current.organizationId != replacement.organizationId ||
            current.projectId != replacement.projectId ||
            current.customerUserId != replacement.customerUserId ||
            current.installationKeyDigest != replacement.installationKeyDigest ||
            (current.installationId != null &&
                current.installationId != replacement.installationId)) {
            return false
        }
        writeNativeInstallationScope(replacement)
        return true
    }

    private fun writeNativeInstallationScope(value: NativeInstallationScope) {
        store.write(
            NATIVE_INSTALLATION_SCOPE_KEY,
            listOf(
                NATIVE_INSTALLATION_SCOPE_SCHEMA,
                value.organizationId,
                value.projectId,
                value.customerUserId,
                value.installationId ?: "-",
                value.installationKeyDigest,
                value.phase.name,
                value.releaseReason ?: "-",
            ).joinToString("\n").encodeToByteArray(),
        )
    }

    fun clearNativeInstallationScope(value: NativeInstallationScope): Boolean {
        val current = nativeInstallationScope() ?: return true
        if (current != value) return false
        store.remove(NATIVE_INSTALLATION_SCOPE_KEY)
        return true
    }

    private fun validateNativeInstallationScope(value: NativeInstallationScope) {
        require(
            UUID_PATTERN.matches(value.organizationId) &&
                UUID_PATTERN.matches(value.projectId) &&
                UUID_PATTERN.matches(value.customerUserId) &&
                (value.installationId == null ||
                    UUID_PATTERN.matches(value.installationId)) &&
                SHA256.matches(value.installationKeyDigest) &&
                (
                    (value.phase == NativeInstallationScopePhase.active &&
                        value.releaseReason == null) ||
                        (value.phase == NativeInstallationScopePhase.release_pending &&
                            value.releaseReason in setOf(
                                "logout",
                                "customer_request",
                                "device_lost",
                                "token_compromise",
                            ))
                    )
        ) { "Native installation scope is invalid." }
    }

    fun setPushPurposeEnabled(purpose: String, enabled: Boolean) {
        val key = pushPurposeEnabledKey(purpose)
        if (enabled) store.write(key, byteArrayOf(1)) else store.remove(key)
    }

    fun pushPurposeEnabled(purpose: String): Boolean =
        store.read(pushPurposeEnabledKey(purpose))?.contentEquals(byteArrayOf(1)) == true

    fun saveRegisteredTokenFingerprint(projectId: String, purpose: String, token: String) {
        validateFcmToken(token)
        store.write(
            registeredTokenFingerprintKey(projectId, purpose),
            ResponderDigest.sha256(token).encodeToByteArray(),
        )
    }

    fun registeredTokenFingerprint(projectId: String, purpose: String): String? =
        store.read(registeredTokenFingerprintKey(projectId, purpose))?.decodeToString()?.also {
            require(SHA256.matches(it)) { "Stored push-token fingerprint is corrupt." }
        }

    fun clearRegisteredTokenFingerprint(projectId: String, purpose: String) =
        store.remove(registeredTokenFingerprintKey(projectId, purpose))

    fun markRetirement(projectId: String, purpose: String) {
        store.write(retirementKey(projectId, purpose), byteArrayOf(1))
    }

    fun markGlobalRetirement(purpose: String) {
        store.write(globalRetirementKey(purpose), byteArrayOf(1))
    }

    fun hasRetirement(projectId: String, purpose: String): Boolean =
        store.read(retirementKey(projectId, purpose))?.contentEquals(byteArrayOf(1)) == true

    fun hasGlobalRetirement(purpose: String): Boolean =
        store.read(globalRetirementKey(purpose))?.contentEquals(byteArrayOf(1)) == true

    fun clearRetirement(projectId: String, purpose: String) {
        store.remove(retirementKey(projectId, purpose))
        store.remove(globalRetirementKey(purpose))
    }

    fun saveSessionCookie(cookie: String) {
        require(COOKIE.matches(cookie)) { "Session cookie is invalid." }
        store.write(SESSION_COOKIE_KEY, cookie.encodeToByteArray())
    }

    fun sessionCookie(): String? =
        store.read(SESSION_COOKIE_KEY)?.decodeToString()?.also {
            require(COOKIE.matches(it)) { "Stored session cookie is invalid." }
        }

    fun clearSessionCookie() = store.remove(SESSION_COOKIE_KEY)

    fun setVoiceExplicitlyDisabled(disabled: Boolean) {
        store.write(VOICE_DISABLED_KEY, byteArrayOf(if (disabled) 1 else 0))
    }

    fun voiceExplicitlyDisabled(): Boolean {
        val stored = store.read(VOICE_DISABLED_KEY) ?: return true
        require(stored.contentEquals(byteArrayOf(0)) || stored.contentEquals(byteArrayOf(1))) {
            "Stored Voice enablement authority is corrupt."
        }
        return stored.contentEquals(byteArrayOf(1))
    }

    fun voiceRegistration(): VoiceProviderAuthority? = synchronized(voiceLock) {
        store.read(VOICE_REGISTRATION_KEY)?.decodeToString()?.let(::decodeVoiceAuthority)
    }

    fun saveVoiceRegistration(value: VoiceProviderAuthority) = synchronized(voiceLock) {
        validateVoiceAuthority(value)
        store.write(VOICE_REGISTRATION_KEY, encodeVoiceAuthority(value).encodeToByteArray())
    }

    fun clearVoiceRegistration(value: VoiceProviderAuthority): Boolean =
        synchronized(voiceLock) {
            val current = voiceRegistration() ?: return@synchronized true
            if (!sameVoiceBinding(current, value)) {
                return@synchronized false
            }
            store.remove(VOICE_REGISTRATION_KEY)
            store.remove(VOICE_INCOMING_GATE_KEY)
            true
        }

    fun voiceIncomingGate(): VoiceProviderAuthority? = synchronized(voiceLock) {
        store.read(VOICE_INCOMING_GATE_KEY)?.decodeToString()?.let(::decodeVoiceAuthority)
    }

    fun openVoiceIncomingGate(value: VoiceProviderAuthority): Boolean = synchronized(voiceLock) {
        validateVoiceAuthority(value)
        val registration = voiceRegistration() ?: return@synchronized false
        if (voiceAttempt() != null || !sameVoiceBinding(registration, value)) {
            return@synchronized false
        }
        store.write(VOICE_INCOMING_GATE_KEY, encodeVoiceAuthority(value).encodeToByteArray())
        true
    }

    fun closeVoiceIncomingGate() = synchronized(voiceLock) {
        store.remove(VOICE_INCOMING_GATE_KEY)
    }

    fun voiceAttempt(): VoiceProviderAttempt? = synchronized(voiceLock) {
        store.read(VOICE_ATTEMPT_KEY)?.decodeToString()?.let(::decodeVoiceAttempt)
    }

    fun recordVoiceAttempt(value: VoiceProviderAttempt): Boolean = synchronized(voiceLock) {
        validateVoiceAttempt(value)
        if (voiceAttempt() != null) return@synchronized false
        closeVoiceIncomingGate()
        store.write(VOICE_ATTEMPT_KEY, encodeVoiceAttempt(value).encodeToByteArray())
        true
    }

    fun replaceVoiceAttemptForCleanup(
        expectedAttemptId: String,
        replacement: VoiceProviderAttempt,
    ): Boolean = synchronized(voiceLock) {
        validateVoiceAttempt(replacement)
        require(replacement.kind == VoiceProviderAttemptKind.unregister)
        val current = voiceAttempt() ?: return@synchronized false
        if (current.id != expectedAttemptId ||
            !sameVoiceBinding(current.target, replacement.target)) {
            return@synchronized false
        }
        if (voiceRegistration() == null) {
            saveVoiceRegistration(current.target)
        }
        closeVoiceIncomingGate()
        store.write(VOICE_ATTEMPT_KEY, encodeVoiceAttempt(replacement).encodeToByteArray())
        true
    }

    fun resolveVoiceAttempt(attemptId: String, succeeded: Boolean): Boolean =
        synchronized(voiceLock) {
            val attempt = voiceAttempt() ?: return@synchronized false
            if (attempt.id != attemptId) return@synchronized false
            if (succeeded) {
                when (attempt.kind) {
                    VoiceProviderAttemptKind.register -> saveVoiceRegistration(attempt.target)
                    VoiceProviderAttemptKind.unregister -> {
                        val current = voiceRegistration()
                        if (current != null && sameVoiceBinding(current, attempt.target)) {
                            store.remove(VOICE_REGISTRATION_KEY)
                        }
                        store.remove(VOICE_INCOMING_GATE_KEY)
                    }
                }
            }
            store.remove(VOICE_ATTEMPT_KEY)
            true
        }

    private fun retirementKey(projectId: String, purpose: String): String {
        require(PURPOSE.matches(purpose))
        return "sitesourcery.responder.retirement.v1.$projectId.$purpose"
    }

    private fun globalRetirementKey(purpose: String): String {
        require(PURPOSE.matches(purpose))
        return "sitesourcery.responder.retirement.v1.pending.$purpose"
    }

    private fun pushPurposeEnabledKey(purpose: String): String {
        require(PURPOSE.matches(purpose))
        return "sitesourcery.responder.push-purpose-enabled.v1.$purpose"
    }

    private fun registeredTokenFingerprintKey(projectId: String, purpose: String): String {
        require(UUID_PATTERN.matches(projectId) && PURPOSE.matches(purpose))
        return "sitesourcery.responder.push-token-fingerprint.v1.$projectId.$purpose"
    }

    private fun encodeVoiceAuthority(value: VoiceProviderAuthority): String = listOf(
        VOICE_AUTHORITY_SCHEMA,
        value.organizationId,
        value.projectId,
        value.customerUserId,
        value.installationId,
        value.installationRevision.toString(),
        value.appEnvironment,
        value.clientPlatform,
        value.transport,
        value.fcmToken,
        value.sessionId,
        value.identityDigest,
        value.credentialDigest,
        value.authorizationExpiresAt,
    ).joinToString("\n")

    private fun decodeVoiceAuthority(value: String): VoiceProviderAuthority {
        val fields = value.split('\n')
        require(fields.size == 14 && fields[0] == VOICE_AUTHORITY_SCHEMA) {
            "Stored Voice registration authority is corrupt."
        }
        return VoiceProviderAuthority(
            fields[1],
            fields[2],
            fields[3],
            fields[4],
            fields[5].toIntOrNull() ?: 0,
            fields[6],
            fields[7],
            fields[8],
            fields[9],
            fields[10],
            fields[11],
            fields[12],
            fields[13],
        ).also(::validateVoiceAuthority)
    }

    private fun encodeVoiceAttempt(value: VoiceProviderAttempt): String = listOf(
        VOICE_ATTEMPT_SCHEMA,
        value.id,
        value.kind.name,
        value.startedAt,
        encodeVoiceAuthority(value.target),
    ).joinToString("\n")

    private fun decodeVoiceAttempt(value: String): VoiceProviderAttempt {
        val fields = value.split('\n')
        require(fields.size == 18 && fields[0] == VOICE_ATTEMPT_SCHEMA) {
            "Stored Voice provider attempt is corrupt."
        }
        return VoiceProviderAttempt(
            fields[1],
            VoiceProviderAttemptKind.valueOf(fields[2]),
            decodeVoiceAuthority(fields.subList(4, fields.size).joinToString("\n")),
            fields[3],
        ).also(::validateVoiceAttempt)
    }

    private fun validateVoiceAuthority(value: VoiceProviderAuthority) {
        require(
            UUID_PATTERN.matches(value.organizationId) &&
                UUID_PATTERN.matches(value.projectId) &&
                UUID_PATTERN.matches(value.customerUserId) &&
                UUID_PATTERN.matches(value.installationId) &&
                UUID_PATTERN.matches(value.sessionId) &&
                value.installationRevision > 0
        )
        require(value.appEnvironment in setOf("sandbox", "production"))
        require(value.clientPlatform == "android")
        require(value.transport == "twilio_voice_android")
        validateFcmToken(value.fcmToken)
        require(SHA256.matches(value.identityDigest) && SHA256.matches(value.credentialDigest))
        Instant.parse(value.authorizationExpiresAt)
    }

    private fun validateVoiceAttempt(value: VoiceProviderAttempt) {
        require(UUID.fromString(value.id).toString() == value.id)
        validateVoiceAuthority(value.target)
        Instant.parse(value.startedAt)
    }

    private fun sameVoiceBinding(
        left: VoiceProviderAuthority,
        right: VoiceProviderAuthority,
    ): Boolean =
        left.organizationId == right.organizationId &&
            left.projectId == right.projectId &&
            left.customerUserId == right.customerUserId &&
            left.installationId == right.installationId &&
            left.appEnvironment == right.appEnvironment &&
            left.clientPlatform == right.clientPlatform &&
            left.transport == right.transport &&
            left.fcmToken == right.fcmToken &&
            left.identityDigest == right.identityDigest &&
            left.credentialDigest == right.credentialDigest

    companion object {
        private const val FCM_TOKEN_KEY = "sitesourcery.responder.fcm-token.v1.current"
        private const val NATIVE_INSTALLATION_SCOPE_KEY =
            "sitesourcery.responder.native-installation-scope.v1.current"
        private const val NATIVE_INSTALLATION_SCOPE_SCHEMA =
            "sitesourcery.responder-native-installation-scope/v1"
        private const val SESSION_COOKIE_KEY = "sitesourcery.responder.session-cookie.v1.current"
        private const val VOICE_DISABLED_KEY =
            "sitesourcery.responder.voice-explicitly-disabled.v1.current"
        private const val VOICE_REGISTRATION_KEY =
            "sitesourcery.responder.voice-registration.v2.current"
        private const val VOICE_INCOMING_GATE_KEY =
            "sitesourcery.responder.voice-incoming-gate.v1.current"
        private const val VOICE_ATTEMPT_KEY =
            "sitesourcery.responder.voice-provider-attempt.v2.current"
        private const val VOICE_AUTHORITY_SCHEMA =
            "sitesourcery.responder-voice-provider-authority/v2"
        private const val VOICE_ATTEMPT_SCHEMA =
            "sitesourcery.responder-voice-provider-attempt/v2"
        private val PURPOSE = Regex("^(notification|voip)$")
        private val COOKIE = Regex("^[A-Za-z0-9._~-]{16,4096}$")
        private val FCM_TOKEN = Regex("^[A-Za-z0-9_:\\-]{16,4096}$")
        private val SHA256 = Regex("^[0-9a-f]{64}$")
        private val UUID_PATTERN = Regex(
            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
        )

        fun validateFcmToken(token: String) {
            require(FCM_TOKEN.matches(token)) { "FCM token is invalid." }
        }
    }
}
