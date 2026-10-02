/// Where a refresh token is kept between application launches.
///
/// The port lives here and the platform implementation lives in each
/// application, so `packages/dart/core` stays free of platform plugins: it is
/// consumed by the customer, merchant and driver builds, and a plugin dependency
/// in it would be forced on all three (ADR-018).
///
/// Only the refresh token is persisted, never the access token. The access token
/// is short lived and is obtained again from the refresh token on startup, so
/// storing it would widen the window in which a lifted file yields a usable
/// credential without gaining anything.
library;

/// A refresh token together with the deployment it belongs to.
///
/// The [apiBaseUrl] is part of the record on purpose. Secure storage is scoped to
/// the application install, not to the deployment, so a debug build pointing at a
/// laptop and a release build pointing at a real API share one keyspace on one
/// device. Replaying a token issued by one API against another is at best a
/// confusing failure and at worst a credential sent to a host the user did not
/// intend.
class StoredSession {
  /// Creates a stored session.
  const StoredSession({required this.refreshToken, required this.apiBaseUrl});

  /// Opaque credential the API issued.
  final String refreshToken;

  /// API origin the token was issued by.
  final String apiBaseUrl;

  /// Whether this record belongs to [apiBaseUrl].
  bool matches(String apiBaseUrl) => this.apiBaseUrl == apiBaseUrl;
}

/// Persistence for the refresh token of the open session.
///
/// Implementations must not throw on a read: a missing value is an expected
/// outcome, and a store that cannot be reached is a signed-out application, not a
/// crash at launch.
abstract class TokenStore {
  /// Reads the stored session for [apiBaseUrl], or null when there is none.
  Future<StoredSession?> read(String apiBaseUrl);

  /// Replaces the stored session for [apiBaseUrl].
  Future<void> write(StoredSession session);

  /// Removes the stored session for [apiBaseUrl].
  Future<void> clear(String apiBaseUrl);
}

/// Keeps the session in memory for the lifetime of the process.
///
/// This is the right implementation for tests and for a build that has no secure
/// storage available. It is deliberately **not** a development-only stub: losing
/// the session on restart is a correct, if inconvenient, behaviour, whereas
/// writing a credential somewhere unprotected would not be.
class InMemoryTokenStore implements TokenStore {
  StoredSession? _stored;

  @override
  Future<StoredSession?> read(String apiBaseUrl) async {
    final StoredSession? stored = _stored;

    if (stored == null || !stored.matches(apiBaseUrl)) {
      return null;
    }

    return stored;
  }

  @override
  Future<void> write(StoredSession session) async {
    _stored = session;
  }

  @override
  Future<void> clear(String apiBaseUrl) async {
    if (_stored != null && _stored!.matches(apiBaseUrl)) {
      _stored = null;
    }
  }
}