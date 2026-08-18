package com.sitesourcery.responder

import com.sitesourcery.responder.core.SecureValueStore

class MemorySecureValueStore : SecureValueStore {
    private val values = linkedMapOf<String, ByteArray>()

    override fun read(key: String): ByteArray? = synchronized(values) {
        values[key]?.copyOf()
    }

    override fun write(key: String, value: ByteArray) = synchronized(values) {
        values[key] = value.copyOf()
    }

    override fun remove(key: String) = synchronized(values) {
        values.remove(key)
        Unit
    }

    fun inject(key: String, value: String) = write(key, value.encodeToByteArray())
}
