import Foundation

enum AppConfigurationError: Error, LocalizedError {
    case missingAPIOrigin
    case invalidAPIOrigin
    case invalidBuildIdentity

    var errorDescription: String? {
        switch self {
        case .missingAPIOrigin:
            return "This Responder build does not name a Site Sourcery API."
        case .invalidAPIOrigin:
            return "This Responder build has an invalid Site Sourcery API address."
        case .invalidBuildIdentity:
            return "This Responder build is missing its version identity."
        }
    }
}

struct AppConfiguration: Sendable {
    let apiBaseURL: URL
    let environment: NativeAppEnvironment
    let appVersion: String
    let buildNumber: String

    static func current(bundle: Bundle = .main) throws -> AppConfiguration {
        guard let value = bundle.object(forInfoDictionaryKey: "SiteSourceryAPIBaseURL")
            as? String, !value.isEmpty else {
            throw AppConfigurationError.missingAPIOrigin
        }
        guard
            let url = URL(string: value),
            url.scheme == "https",
            url.user == nil,
            url.password == nil,
            url.query == nil,
            url.fragment == nil,
            url.path == "/api/v1" || url.path == "/api/v1/"
        else { throw AppConfigurationError.invalidAPIOrigin }
        guard
            let appVersion = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString")
                as? String,
            let buildNumber = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String,
            !appVersion.isEmpty,
            !buildNumber.isEmpty
        else { throw AppConfigurationError.invalidBuildIdentity }
        #if DEBUG
        let environment = NativeAppEnvironment.sandbox
        #else
        let environment = NativeAppEnvironment.production
        #endif
        return AppConfiguration(
            apiBaseURL: url,
            environment: environment,
            appVersion: appVersion,
            buildNumber: buildNumber
        )
    }

    func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = .shared
        configuration.httpShouldSetCookies = true
        configuration.httpCookieAcceptPolicy = .always
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 30
        configuration.waitsForConnectivity = true
        return URLSession(configuration: configuration)
    }
}
