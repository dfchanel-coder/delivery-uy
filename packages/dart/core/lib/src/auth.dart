/// Authentication contracts shared by every mobile application.
///
/// The payloads are decoded strictly: a field the API must send is required, and
/// an unexpected shape raises a [FormatException] instead of producing an object
/// with nulls. A half-decoded session would fail later, somewhere far from the
/// response that caused it.
library;

import 'api_client.dart';

/// An account as the API describes it.
///
/// This is a display and routing model, not an authorisation model: the roles
/// are what the API reports, and every permission decision stays server side
/// (AGENTS.md sections 32 and 42).
class AuthUser {
  /// Creates a user from decoded fields.
  const AuthUser({
    required this.id,
    required this.email,
    required this.status,
    required this.roles,
    required this.locale,
    required this.mustChangePassword,
    this.emailVerifiedAt,
  });

  /// Decodes the `user` member of an auth response.
  factory AuthUser.fromJson(Object? json) {
    if (json is! Map<String, Object?>) {
      throw const FormatException('user must be an object');
    }

    final Object? id = json['id'];
    final Object? email = json['email'];
    final Object? status = json['status'];
    final Object? locale = json['locale'];
    final Object? roles = json['roles'];
    final Object? verifiedAt = json['emailVerifiedAt'];
    final Object? mustChange = json['mustChangePassword'];

    if (id is! String || id.isEmpty) {
      throw const FormatException('user.id must be a non-empty string');
    }

    if (email is! String || email.isEmpty) {
      throw const FormatException('user.email must be a non-empty string');
    }

    if (status is! String || status.isEmpty) {
      throw const FormatException('user.status must be a non-empty string');
    }

    if (locale is! String || locale.isEmpty) {
      throw const FormatException('user.locale must be a non-empty string');
    }

    if (roles is! List || roles.any((Object? role) => role is! String)) {
      throw const FormatException('user.roles must be a list of strings');
    }

    if (verifiedAt != null && verifiedAt is! String) {
      throw const FormatException('user.emailVerifiedAt must be a string or null');
    }

    if (mustChange is! bool) {
      throw const FormatException('user.mustChangePassword must be a boolean');
    }

    return AuthUser(
      id: id,
      email: email,
      status: status,
      roles: roles.cast<String>(),
      locale: locale,
      emailVerifiedAt: verifiedAt as String?,
      mustChangePassword: mustChange,
    );
  }

  /// Stable public identifier.
  final String id;

  /// Address the account signs in with.
  final String email;

  /// Account state such as `ACTIVE` or `PENDING_VERIFICATION`.
  final String status;

  /// Roles the API reports, for example `['CUSTOMER']`.
  final List<String> roles;

  /// Preferred interface language.
  final String locale;

  /// When the address was confirmed, or null while it is still unverified.
  final String? emailVerifiedAt;

  /// Whether the API requires a password change before normal use.
  final bool mustChangePassword;

  /// Whether the account holds [role].
  bool hasRole(String role) => roles.contains(role);
}

/// The token pair returned by the API.
class AuthTokens {
  /// Creates a token pair from decoded fields.
  const AuthTokens({
    required this.accessToken,
    required this.refreshToken,
    required this.tokenType,
    required this.expiresIn,
    required this.accessTokenExpiresAt,
  });

  /// Decodes the `tokens` member of an auth response.
  factory AuthTokens.fromJson(Object? json) {
    if (json is! Map<String, Object?>) {
      throw const FormatException('tokens must be an object');
    }

    final Object? access = json['accessToken'];
    final Object? refresh = json['refreshToken'];
    final Object? type = json['tokenType'];
    final Object? expiresIn = json['expiresIn'];
    final Object? expiresAt = json['accessTokenExpiresAt'];

    if (access is! String || access.isEmpty) {
      throw const FormatException('tokens.accessToken must be a non-empty string');
    }

    if (refresh is! String || refresh.isEmpty) {
      throw const FormatException('tokens.refreshToken must be a non-empty string');
    }

    if (type is! String || type.isEmpty) {
      throw const FormatException('tokens.tokenType must be a non-empty string');
    }

    if (expiresIn is! int) {
      throw const FormatException('tokens.expiresIn must be an integer');
    }

    if (expiresAt is! String || expiresAt.isEmpty) {
      throw const FormatException('tokens.accessTokenExpiresAt must be a non-empty string');
    }

    return AuthTokens(
      accessToken: access,
      refreshToken: refresh,
      tokenType: type,
      expiresIn: expiresIn,
      accessTokenExpiresAt: expiresAt,
    );
  }

  /// Short lived credential sent as `Authorization: Bearer`.
  final String accessToken;

  /// Opaque credential used only to obtain a new access token.
  final String refreshToken;

  /// Scheme the access token travels with.
  final String tokenType;

  /// Access token lifetime in seconds.
  final int expiresIn;

  /// Absolute expiry of the access token, as reported by the API.
  final String accessTokenExpiresAt;

  /// Value for the `Authorization` header.
  String get authorizationHeader => '$tokenType $accessToken';
}

/// A signed-in account together with its credentials.
///
/// Matches `AuthSessionResponse` in `packages/types`: login and refresh always
/// carry tokens. Registration does not, which is why it has its own type below.
class AuthSession {
  /// Creates a session from already decoded parts.
  const AuthSession({required this.user, required this.tokens});

  /// Decodes the `data` member of a login or refresh response.
  factory AuthSession.fromJson(Object? json) {
    if (json is! Map<String, Object?>) {
      throw const FormatException('auth response must be an object');
    }

    return AuthSession(
      user: AuthUser.fromJson(json['user']),
      tokens: AuthTokens.fromJson(json['tokens']),
    );
  }

  /// The signed-in account.
  final AuthUser user;

  /// Credentials issued with the session.
  final AuthTokens tokens;
}

/// The answer to a registration.
///
/// Kept apart from [AuthSession] because the API deliberately sends no tokens
/// when the deployment requires email verification: handing a session to an
/// unverified address would let it act on the platform
/// (`packages/types` `RegisterResponse`). A client that assumed tokens were
/// always present would either crash or log in an account that may not be used.
class AuthRegistration {
  /// Creates a registration result from already decoded parts.
  const AuthRegistration({
    required this.user,
    required this.tokens,
    required this.verificationRequired,
  });

  /// Decodes the `data` member of a register response.
  factory AuthRegistration.fromJson(Object? json) {
    if (json is! Map<String, Object?>) {
      throw const FormatException('register response must be an object');
    }

    final Object? rawVerification = json['verificationRequired'];

    if (rawVerification is! bool) {
      throw const FormatException(
        'register.verificationRequired must be a boolean',
      );
    }

    // Cross-checked instead of coerced: the API omits tokens only when it also
    // demands verification. A payload that breaks that pairing means the contract
    // moved, and guessing which half to believe would open a session for an
    // account that is not allowed to use one.
    final Object? rawTokens = json['tokens'];
    final bool tokensPresent = rawTokens != null;

    if (tokensPresent == rawVerification) {
      throw const FormatException(
        'register.tokens must be present exactly when verification is not required',
      );
    }

    return AuthRegistration(
      user: AuthUser.fromJson(json['user']),
      tokens: tokensPresent ? AuthTokens.fromJson(rawTokens) : null,
      verificationRequired: rawVerification,
    );
  }

  /// The account that was just created.
  final AuthUser user;

  /// Credentials, or null when [verificationRequired] is true.
  final AuthTokens? tokens;

  /// Whether the account must confirm its address before it can sign in.
  final bool verificationRequired;

  /// The session opened by this registration, or null when none was issued.
  AuthSession? get session => tokens == null
      ? null
      : AuthSession(user: user, tokens: tokens!);
}

/// The answer to proving an email address.
///
/// Two facts, not one. A deployment may hold a proven address for approval, so
/// [verified] alone would leave a client presenting a sign-in form that cannot
/// work. They are decoded as separate booleans and neither is inferred from the
/// other, exactly as the API reports them.
class EmailConfirmation {
  /// Creates a confirmation result from decoded fields.
  const EmailConfirmation({required this.verified, required this.canSignIn});

  /// Decodes the `data` member of a verify-email response.
  factory EmailConfirmation.fromJson(Object? json) {
    if (json is! Map<String, Object?>) {
      throw const FormatException('verify-email response must be an object');
    }

    final Object? verified = json['verified'];
    final Object? canSignIn = json['canSignIn'];

    if (verified is! bool) {
      throw const FormatException('verify-email.verified must be a boolean');
    }

    if (canSignIn is! bool) {
      throw const FormatException('verify-email.canSignIn must be a boolean');
    }

    return EmailConfirmation(verified: verified, canSignIn: canSignIn);
  }

  /// Whether the code proved the address.
  final bool verified;

  /// Whether the account may now sign in.
  final bool canSignIn;
}

/// The authentication endpoints, as one call each.
///
/// Every method either returns a decoded value or throws
/// [ApiFailureException] / [ApiTransportException] from [ApiClient]. There is no
/// "partially successful" outcome to handle.
class AuthApi {
  /// Creates the API surface over [client].
  const AuthApi(this._client);

  final ApiClient _client;

  /// Registers an account and opens a session.
  ///
  /// The role is not sent: self registration cannot choose one, and the API
  /// rejects the field anyway (AGENTS.md section 8).
  ///
  /// The result is a [AuthRegistration] and not a [AuthSession] because a
  /// deployment with email verification enabled creates the account without
  /// handing out any credential.
  Future<AuthRegistration> register({
    required String email,
    required String password,
  }) async {
    final Object? data = await _client.post(
      '/auth/register',
      body: <String, String>{'email': email, 'password': password},
    );

    return AuthRegistration.fromJson(data);
  }

  /// Signs an existing account in.
  Future<AuthSession> login({
    required String email,
    required String password,
  }) async {
    final Object? data = await _client.post(
      '/auth/login',
      body: <String, String>{'email': email, 'password': password},
    );

    return AuthSession.fromJson(data);
  }

  /// Exchanges a refresh token for a new pair.
  ///
  /// Rotation means the token passed in is consumed by this call. If the caller
  /// retries with the same one, the API answers `REFRESH_TOKEN_REUSED` and
  /// revokes the family, so this must not be called twice with one token
  /// (SECURITY.md).
  Future<AuthSession> refresh(String refreshToken) async {
    final Object? data = await _client.post(
      '/auth/refresh',
      body: <String, String>{'refreshToken': refreshToken},
    );

    return AuthSession.fromJson(data);
  }

  /// Ends the session behind [refreshToken].
  Future<void> logout(String refreshToken) async {
    await _client.post(
      '/auth/logout',
      body: <String, String>{'refreshToken': refreshToken},
    );
  }

  /// Reads the account behind the current access token.
  Future<AuthUser> me(String accessToken) async {
    final Object? data = await _client.get(
      '/auth/me',
      accessToken: accessToken,
    );

    return AuthUser.fromJson(data);
  }

  /// Proves an address with the code carried by the delivery message.
  ///
  /// Public: the code is the credential, and no session exists yet to present
  /// (docs/API_RULES.md). The code is single use, so a retry after a timeout is
  /// refused rather than silently harmless - the caller should send the customer
  /// back to the beginning of the message rather than expect the same code to
  /// work twice.
  Future<EmailConfirmation> verifyEmail(String token) async {
    final Object? data = await _client.post(
      '/auth/verify-email',
      body: <String, String>{'token': token.trim()},
    );

    return EmailConfirmation.fromJson(data);
  }
}
