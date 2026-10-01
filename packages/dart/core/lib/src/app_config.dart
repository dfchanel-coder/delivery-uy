/// Configuration shared by the customer, merchant and driver applications.
///
/// Values arrive from compile-time defines so a build artefact is tied to one
/// environment and never reads an unvalidated source at runtime:
///
/// ```sh
/// flutter build apk --dart-define=API_BASE_URL=https://api.deliveryuy.uy/api/v1
/// ```
///
/// Nothing here contains a secret: tokens are issued by the backend and kept in
/// secure storage (AGENTS.md section 61).
library;

/// Base URL used when no define is supplied.
///
/// `10.0.2.2` is the address the Android emulator uses to reach the host
/// machine. On the iOS simulator the loopback address works, so iOS builds pass
/// `--dart-define=API_BASE_URL=http://localhost:3000/api/v1`.
const String defaultApiBaseUrl = 'http://10.0.2.2:3000/api/v1';

/// Thrown when a configuration value is missing or unusable.
///
/// Failing at startup is deliberate: a mobile app that starts with a wrong API
/// origin shows confusing empty states instead of a clear error.
class AppConfigException implements Exception {
  /// Creates an exception describing which key is invalid.
  const AppConfigException(this.key, this.reason);

  /// Configuration key that failed validation.
  final String key;

  /// Human readable explanation, safe to show to developers.
  final String reason;

  @override
  String toString() => 'Invalid configuration for $key: $reason';
}

/// Validated application configuration.
class AppConfig {
  /// Creates a configuration from already validated values.
  const AppConfig({required this.apiBaseUrl, required this.apiTimeout});

  /// Reads the configuration from compile-time defines.
  ///
  /// Throws [AppConfigException] when a value is invalid.
  factory AppConfig.fromEnvironment() {
    return AppConfig.fromMap(const <String, String>{
      'API_BASE_URL': String.fromEnvironment(
        'API_BASE_URL',
        defaultValue: defaultApiBaseUrl,
      ),
      'API_TIMEOUT': String.fromEnvironment(
        'API_TIMEOUT',
        defaultValue: '10',
      ),
    });
  }

  /// Creates a configuration from a map, validating every entry.
  ///
  /// Exposed so tests and tools can validate an arbitrary source without
  /// touching compile-time defines.
  factory AppConfig.fromMap(Map<String, String> values) {
    final String baseUrl = values['API_BASE_URL'] ?? defaultApiBaseUrl;
    final String timeout = values['API_TIMEOUT'] ?? '10';

    final Uri? parsed = Uri.tryParse(baseUrl);

    if (parsed == null ||
        !parsed.isAbsolute ||
        (parsed.scheme != 'http' && parsed.scheme != 'https') ||
        parsed.host.isEmpty) {
      throw const AppConfigException(
        'API_BASE_URL',
        'must be an absolute http(s) URL such as https://api.example.com/api/v1',
      );
    }

    final int? seconds = int.tryParse(timeout);

    if (seconds == null || seconds < 1 || seconds > 120) {
      throw const AppConfigException(
        'API_TIMEOUT',
        'must be an integer number of seconds between 1 and 120',
      );
    }

    return AppConfig(
      apiBaseUrl: _stripTrailingSlash(baseUrl),
      apiTimeout: Duration(seconds: seconds),
    );
  }

  /// Absolute base URL of the DeliveryUY API, including the `/api/v1` prefix.
  final String apiBaseUrl;

  /// Maximum time the applications wait for an API response.
  ///
  /// Mobile connectivity is unreliable (AGENTS.md section 43), so the timeout is
  /// bounded and short: a request that cannot finish in this window is better
  /// surfaced as an error than as an endless spinner.
  final Duration apiTimeout;

  static String _stripTrailingSlash(String value) {
    return value.endsWith('/') ? value.substring(0, value.length - 1) : value;
  }

  @override
  String toString() => 'AppConfig(apiBaseUrl: $apiBaseUrl, apiTimeout: $apiTimeout)';
}