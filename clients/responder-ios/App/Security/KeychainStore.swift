import Foundation
import Security

enum KeychainStoreError: Error, LocalizedError {
    case unexpectedStatus(OSStatus)
    case corruptValue

    var errorDescription: String? {
        switch self {
        case .unexpectedStatus:
            return "The secure device store is unavailable."
        case .corruptValue:
            return "The secure device identity is damaged."
        }
    }
}

final class KeychainStore: SecureValueStore, @unchecked Sendable {
    private let service: String

    init(service: String = "com.sitesourcery.responder") {
        self.service = service
    }

    func read(key: String) throws -> Data? {
        var query = baseQuery(key: key)
        query[kSecReturnData] = true
        query[kSecMatchLimit] = kSecMatchLimitOne
        var value: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &value)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw KeychainStoreError.unexpectedStatus(status)
        }
        guard let data = value as? Data else { throw KeychainStoreError.corruptValue }
        return data
    }

    func write(_ data: Data, key: String) throws {
        let query = baseQuery(key: key)
        let attributes: [CFString: Any] = [kSecValueData: data]
        let update = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else {
            throw KeychainStoreError.unexpectedStatus(update)
        }
        var insertion = query
        insertion[kSecValueData] = data
        insertion[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let added = SecItemAdd(insertion as CFDictionary, nil)
        guard added == errSecSuccess else {
            throw KeychainStoreError.unexpectedStatus(added)
        }
    }

    func remove(key: String) throws {
        let status = SecItemDelete(baseQuery(key: key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainStoreError.unexpectedStatus(status)
        }
    }

    func installationSecret(projectId: String) throws -> Data {
        let key = "sitesourcery.responder.installation-secret.v1.\(projectId.lowercased())"
        if let existing = try read(key: key) {
            guard existing.count == 32 else { throw KeychainStoreError.corruptValue }
            return existing
        }
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else {
            throw KeychainStoreError.unexpectedStatus(status)
        }
        let secret = Data(bytes)
        try write(secret, key: key)
        return secret
    }

    private func baseQuery(key: String) -> [CFString: Any] {
        [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: key,
            kSecAttrSynchronizable: false
        ]
    }
}
