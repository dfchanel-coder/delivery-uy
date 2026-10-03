import 'package:deliveryuy_core/deliveryuy_core.dart';
import 'package:flutter/foundation.dart';

/// Where the interface stands with respect to credentials.
enum AuthStatus {
  /// No credentials are held.
  signedOut,

  /// A request is in flight; the interface must not start another one.
  submitting,

  /// Credentials are held and the session page may be shown.
  signedIn,

  /// The account was created but the API has not enabled access yet.
  awaitingVerification,
}

/// Why an authentication attempt did not open a session.
///
/// The interface maps this to localized copy; only the API messages themselves
/// come from the server, because they are the only ones written for the person
/// who made the request (AGENTS.md sections 36 and 44).
enum AuthFailureKind {
  /// The API answered and rejected the request.
  rejected,

  /// The API could not be reached, timed out, or answered something unreadable.
  unreachable,
}

/// What a failure banner needs in order to describe a failed attempt.
///
/// Implemented by [AuthController] and by the password recovery flow, so both
/// describe a rejection with the same copy. It exists because recovery is not a
/// session state: those attempts belong to the screen the person started from
/// and must not move them onto the sign-in form, so they carry their own failure
/// rather than sharing the session controller's.
abstract class AuthFailureSource {
  /// Why the attempt failed, or null when it succeeded.
  AuthFailureKind? get failureKind;

  /// Message supplied by the API, when it supplied one.
  String? get failureMessage;

  /// Wording for when the API rejected the attempt but sent no message.
  ///
  /// Declared here rather than written into the banner because only the flow
  /// knows what it was trying to do: "we could not sign you in" would be false
  /// on a screen that was changing a password.
  String get failureFallbackMessage;

  /// Structured details supplied by the API, such as password policy reasons.
  Map<String, Object?>? get failureDetails;

  /// Server-side log identifier, for support conversations.
  String? get failureCorrelationId;
}

/// Owns the session state of the customer application.
///
/// The controller holds the open session in memory and persists only the refresh
/// token through [tokenStore]. The access token is never written anywhere: it is
/// short lived and is obtained again from the refresh token on startup, so
/// storing it would widen the window in which a lifted file yields a usable
/// credential without gaining anything.
///
/// Every permission decision stays on the API. This class never decides what an
/// account may do; it only reflects what the API reported (AGENTS.md section 42).
class AuthController extends ChangeNotifier implements AuthFailureSource {
  /// Creates a controller over [authApi], persisting through [tokenStore].
  ///
  /// [config] is carried along so the interface can show which deployment it is
  /// talking to, instead of hiding a misconfigured build behind an empty screen,
  /// and so a stored session is only used against the deployment that issued it.
  AuthController({
    required this.authApi,
    required this.config,
    required this.tokenStore,
  });

  /// Validated deployment this session belongs to.
  final AppConfig config;

  /// Authentication endpoints the controller drives.
  final AuthApi authApi;

  /// Where the refresh token survives a restart.
  final TokenStore tokenStore;

  AuthStatus _status = AuthStatus.signedOut;
  AuthSession? _session;
  String? _pendingVerificationEmail;
  bool _pendingVerificationConfirmed = false;
  bool _restoring = false;
  AuthFailureKind? _failureKind;
  String? _failureCode;
  String? _failureMessage;
  String? _failureCorrelationId;
  Map<String, Object?>? _failureDetails;

  /// Current state of the session.
  AuthStatus get status => _status;

  /// The open session, or null when signed out.
  AuthSession? get session => _session;

  /// Access token of the open session, or null when signed out.
  ///
  /// Use [ensureFreshSession] before a protected request instead of reading this,
  /// so an access token that expired while the application was open is renewed
  /// before it is spent.
  String? get accessToken => _session?.tokens.accessToken;

  /// Address of the account waiting for verification, when that is the state.
  String? get pendingVerificationEmail => _pendingVerificationEmail;

  /// Whether the waiting account has proven its address but is still not usable.
  ///
  /// A deployment may require approval after the address is confirmed. Reporting
  /// only "verified" would leave the person on a screen implying they can sign in,
  /// so the second fact is carried separately and the interface can say what is
  /// actually true (AGENTS.md section 5).
  bool get pendingVerificationConfirmed => _pendingVerificationConfirmed;

  /// Why the last attempt failed, or null when it succeeded.
  @override
  AuthFailureKind? get failureKind => _failureKind;

  /// Machine readable code of the last failure, for support conversations.
  ///
  /// Messages change; codes are part of the contract (AGENTS.md section 36).
  String? get failureCode => _failureCode;

  /// Message supplied by the API for the last failure.
  @override
  String? get failureMessage => _failureMessage;

  /// Wording for a rejection the API did not describe.
  @override
  String get failureFallbackMessage => 'No pudimos completar la operación.';

  /// Structured details supplied by the API, such as the password policy
  /// reasons behind a `VALIDATION_FAILED`.
  @override
  Map<String, Object?>? get failureDetails => _failureDetails;

  /// Server-side log identifier for the last failure, when the API sent one.
  @override
  String? get failureCorrelationId => _failureCorrelationId;

  /// Whether a request is in flight.
  bool get isSubmitting => _status == AuthStatus.submitting;

  /// Signs an account in.
  ///
  /// A second call while one is in flight is ignored instead of opening two
  /// sessions: mobile connections are unreliable and a double tap is common
  /// (AGENTS.md section 43).
  Future<void> signIn({required String email, required String password}) async {
    if (_status == AuthStatus.submitting) {
      return;
    }

    _begin();

    try {
      final AuthSession session = await authApi.login(
        // The API normalizes case and surrounding spaces; trimming here keeps the
        // credential the user typed closest to what was sent.
        email: email.trim(),
        password: password,
      );

      await _openSession(session);
    } on ApiClientException catch (error) {
      _recordFrom(error);
      notifyListeners();
    } on FormatException catch (error) {
      // A sign-in that cannot be decoded did not open a session, so this is the
      // same situation as a refusal and leaves the same screen.
      _recordFromUnreadable(error);
      notifyListeners();
    }
  }

  /// Creates an account.
  ///
  /// The role is never sent: the API derives it from configuration and rejects
  /// the field, so a client that offered a role choice would only invite an
  /// escalation attempt (AGENTS.md section 8).
  ///
  /// A deployment that requires address verification creates the account without
  /// issuing a session, which is a different state and not a failed sign-up: the
  /// user has to wait for the address to be confirmed.
  Future<void> register({required String email, required String password}) async {
    if (_status == AuthStatus.submitting) {
      return;
    }

    final String address = email.trim();
    _begin();

    try {
      final AuthRegistration registration = await authApi.register(
        email: address,
        password: password,
      );

      final AuthSession? session = registration.session;

      if (session == null) {
        _pendingVerificationEmail = registration.user.email;
        _pendingVerificationConfirmed = false;
        _status = AuthStatus.awaitingVerification;
        notifyListeners();
        return;
      }

      await _openSession(session);
    } on ApiClientException catch (error) {
      _recordFrom(error);
      notifyListeners();
    } on FormatException catch (error) {
      // The account may well exist; only the answer is unusable, so the person is
      // sent back to the form to try again rather than told anything definite.
      _recordFromUnreadable(error);
      notifyListeners();
    }
  }

  /// Rebuilds the session from a stored refresh token.
  ///
  /// Called once at launch. Failures are deliberately silent: nobody asked for
  /// anything, and an unreachable server at startup must not greet the user with
  /// an error banner over a sign-in form they have not touched yet. A refresh
  /// token the API rejects is removed, because a revoked or already-rotated token
  /// will never work again and keeping it would fail the same way on every
  /// launch.
  Future<void> restore() async {
    if (_restoring || _session != null) {
      return;
    }

    _restoring = true;

    try {
      final StoredSession? stored = await tokenStore.read(config.apiBaseUrl);

      if (stored == null) {
        return;
      }

      _status = AuthStatus.submitting;
      notifyListeners();

      final AuthSession renewed = await authApi.refresh(stored.refreshToken);

      await _openSession(renewed);
    } on ApiFailureException {
      // The API answered and refused the token, so it is gone for good: revoked,
      // already rotated, or reused. Keeping it would fail the same way on every
      // launch and hide the reason the user keeps landing on the sign-in form.
      await _forgetStoredSession();
    } on ApiClientException {
      // The API was never reached, so it rejected nothing. The token stays and the
      // next launch tries again.
    } on Object {
      // A storage backend that cannot be read must not stop the application from
      // starting: a signed-out application is strictly better than a crash.
    } finally {
      _restoring = false;

      if (_session == null && _status == AuthStatus.submitting) {
        // Left behind by the in-flight transition above. Anything else here would
        // be a bug rather than a state to repair.
        _status = AuthStatus.signedOut;
      }
    }
  }

  /// Renews the session when the access token is expired or about to expire.
  ///
  /// Returns whether a usable session is open afterwards. A protected request
  /// should be preceded by this call rather than reading [accessToken], because a
  /// 15-minute token will otherwise stop working in the middle of an order.
  Future<bool> ensureFreshSession({
    Duration leeway = const Duration(seconds: 60),
  }) async {
    final AuthSession? current = _session;

    if (current == null) {
      return false;
    }

    if (!_isExpiring(current.tokens, leeway)) {
      return true;
    }

    return _renew();
  }

  /// Ends the session.
  ///
  /// The stored token is removed before the revocation call is attempted, so a
  /// network failure cannot leave a usable credential on disk, and the local
  /// session is dropped before the call so the interface never shows a session
  /// the user asked to end. A failed revocation only leaves the old token alive
  /// until it expires, which the API already bounds.
  Future<void> signOut() async {
    final AuthSession? current = _session;

    _session = null;
    _pendingVerificationEmail = null;
    _pendingVerificationConfirmed = false;
    _status = AuthStatus.signedOut;
    _clearFailure();
    notifyListeners();

    await _forgetStoredSession();

    if (current == null) {
      return;
    }

    try {
      await authApi.logout(current.tokens.refreshToken);
    } on ApiClientException {
      // Intentionally swallowed, for the reason described above. Reporting a
      // failed logout to a user who is already signed out would be misleading.
    }
  }

  /// Reads the account behind the current access token.
  ///
  /// Used by the session page to prove the credential is still accepted, which
  /// is also how an expired or revoked token becomes visible.
  ///
  /// A `401 UNAUTHENTICATED` is retried once after renewing the session, because
  /// the overwhelmingly common cause is an access token that expired while the
  /// application was open. The retry is not a loop: a second rejection is
  /// recorded as the failure it is.
  Future<AuthUser?> loadAccount() async {
    if (_session == null) {
      return null;
    }

    final _AccountAttempt first = await _attemptAccount();

    if (first.account != null) {
      return first.account;
    }

    // Only an expired credential is worth a renewal. Any other rejection is the
    // answer itself, and retrying it would send a request that cannot succeed.
    if (!first.tokenRejected) {
      return null;
    }

    if (!await _renew()) {
      return null;
    }

    return (await _attemptAccount()).account;
  }

  /// Proves the waiting account's address with the code from the message.
  ///
  /// The code is sent to the API and never kept here, not even for a retry: a
  /// controller field holding a bearer credential is one more copy to leak
  /// (SECURITY.md).
  ///
  /// Two answers are possible and both are reported honestly. A deployment that
  /// activates the account on proof moves to the sign-in form. One that also
  /// requires approval stays in this state with
  /// [pendingVerificationConfirmed] set, because presenting a sign-in form that
  /// the API will refuse with `EMAIL_NOT_VERIFIED` would be a dead end.
  Future<void> confirmEmail(String token) async {
    if (_status == AuthStatus.submitting) {
      return;
    }

    final String code = token.trim();

    // Only a presence check. The shape of the code is the API's business, and a
    // client-side length rule would refuse a valid one the moment the format
    // changes (AGENTS.md section 52).
    if (code.isEmpty) {
      return;
    }

    // Remembered because a refused code returns to this screen rather than to the
    // sign-in form, and `_begin` has just moved the state elsewhere.
    final AuthStatus previous = _status;
    _begin();

    try {
      final EmailConfirmation confirmation = await authApi.verifyEmail(code);

      if (confirmation.canSignIn) {
        _pendingVerificationEmail = null;
        _pendingVerificationConfirmed = false;
        _status = AuthStatus.signedOut;
      } else {
        _pendingVerificationConfirmed = confirmation.verified;
        _status = AuthStatus.awaitingVerification;
      }

      notifyListeners();
    } on ApiClientException catch (error) {
      // A refused code is a wrong guess, not a lost session. `_recordFrom` would
      // move the interface to the sign-in form, which is the wrong screen for
      // that answer and would hide the message explaining why it was refused, so
      // the state goes back to where the person started and only the reason is
      // recorded.
      _recordFailureOnly(error);
      _status = previous;
      notifyListeners();
    } on FormatException catch (error) {
      // Same reasoning as a refused code: the person stays where the field is,
      // because an unreadable answer says nothing about the code they typed.
      _recordUnreadable(error);
      _status = previous;
      notifyListeners();
    }
  }

/// Returns to the sign-in form from the "account created" screen.
  void dismissVerificationNotice() {
    if (_status != AuthStatus.awaitingVerification) {
      return;
    }

    _pendingVerificationEmail = null;
    _pendingVerificationConfirmed = false;
    _status = AuthStatus.signedOut;
    notifyListeners();
  }

  /// Forgets the last failure so a retry starts from a clean screen.
  void clearFailure() {
    if (_failureKind == null) {
      return;
    }

    _clearFailure();
    notifyListeners();
  }

  /// Stores the session and moves to the signed-in state.
  Future<void> _openSession(AuthSession session) async {
    _session = session;
    _status = AuthStatus.signedIn;
    _clearFailure();

    try {
      await tokenStore.write(
        StoredSession(
          refreshToken: session.tokens.refreshToken,
          apiBaseUrl: config.apiBaseUrl,
        ),
      );
    } on Object {
      // The session is valid; only persistence failed. Losing it on restart is
      // an inconvenience, and refusing to sign the user in would be worse.
    }

    notifyListeners();
  }

  /// Exchanges the open refresh token for a new pair.
  ///
  /// Rotation means the token sent here is consumed by the call, so this must not
  /// run twice for one session (SECURITY.md). Callers therefore go through
  /// [ensureFreshSession] or [loadAccount], both of which check the state first.
  Future<bool> _renew() async {
    final AuthSession? current = _session;

    if (current == null || _status == AuthStatus.submitting) {
      return false;
    }

    _status = AuthStatus.submitting;
    notifyListeners();

    try {
      final AuthSession renewed = await authApi.refresh(current.tokens.refreshToken);

      await _openSession(renewed);
      return true;
    } on ApiClientException catch (error) {
      // A rejected refresh means the token is gone: revoked, already rotated by
      // another request, or reused. Nothing can be recovered from it.
      await _forgetStoredSession();
      _recordFrom(error);
      notifyListeners();

      return false;
    } on FormatException catch (error) {
      // An unreadable renewal is not proof the token is dead, so the stored
      // session is kept: dropping it would sign the person out over a parsing
      // problem, and keeping it costs at most one more failed attempt.
      _recordUnreadable(error);
      _status = _session == null ? AuthStatus.signedOut : AuthStatus.signedIn;
      notifyListeners();

      return false;
    }
  }

  /// One `GET /auth/me` attempt and what it produced.
  ///
  /// The three outcomes are kept apart instead of collapsing into a nullable
  /// account, because "the API rejected the credential" and "the API rejected this
  /// request" call for different next steps: only the first one can be fixed by
  /// renewing the session.
  Future<_AccountAttempt> _attemptAccount() async {
    final AuthSession? current = _session;

    if (current == null) {
      return const _AccountAttempt.tokenRejected();
    }

    try {
      return _AccountAttempt.read(await authApi.me(current.tokens.accessToken));
    } on ApiFailureException catch (error) {
      if (error.code == _unauthenticatedCode) {
        // Left unreported on purpose: the caller decides whether an expired token
        // deserves a renewal or is a signed-out session.
        return const _AccountAttempt.tokenRejected();
      }

      _recordFrom(error);
      notifyListeners();

      return _AccountAttempt.rejected(error);
    } on ApiClientException catch (error) {
      _recordFrom(error);
      notifyListeners();

      return _AccountAttempt.unreachable(error);
    } on FormatException catch (error) {
      // The access token was not refused: nothing says it expired or was
      // revoked, so this must not be mistaken for a session that needs signing
      // out. Reported as unreachable, and the session is left open.
      _recordUnreadable(error);
      notifyListeners();

      return _AccountAttempt.unreachable(null);
    }
  }

  /// Whether [tokens] are within [leeway] of expiring.
  ///
  /// An unparseable expiry counts as expiring: renewing unnecessarily costs one
  /// request, while trusting a value that cannot be read would send a credential
  /// that is already dead.
  static bool _isExpiring(AuthTokens tokens, Duration leeway) {
    final DateTime? expiresAt = DateTime.tryParse(tokens.accessTokenExpiresAt);

    if (expiresAt == null) {
      return true;
    }

    return DateTime.now().toUtc().add(leeway).isAfter(expiresAt.toUtc());
  }

  Future<void> _forgetStoredSession() async {
    try {
      await tokenStore.clear(config.apiBaseUrl);
    } on Object {
      // Nothing useful is left to do: the in-memory session is already gone and
      // the caller is being told the truth about the state of the application.
    }
  }

  /// Moves to the in-flight state and drops whatever the previous attempt left.
  void _begin() {
    _status = AuthStatus.submitting;
    _clearFailure();
    notifyListeners();
  }

  /// Records a rejection, a transport failure, or an unreadable answer.
  ///
  /// A request failure never keeps a session: the user asked for something they
  /// do not have, and leaving a half-authenticated screen would be worse.
  void _recordFrom(ApiClientException error) {
    _recordFailureOnly(error);

    _session = null;
    _status = AuthStatus.signedOut;
  }

  /// Records an unreadable answer the way a refused request is recorded.
  ///
  /// Same consequence, different cause: no session was opened and none can be,
  /// so the sign-in form is where the person belongs.
  void _recordFromUnreadable(FormatException error) {
    _recordUnreadable(error);

    _session = null;
    _status = AuthStatus.signedOut;
  }

  /// Records the failure without moving the interface away from where it is.
  ///
  /// Used where the failure belongs to one attempt rather than to the session,
  /// such as a refused verification code: the screen the person needs is the one
  /// they are already on.
  void _recordFailureOnly(ApiClientException error) {
    if (error is ApiFailureException) {
      _failureKind = AuthFailureKind.rejected;
      _failureCode = error.code;
      _failureMessage = error.failure.message;
      _failureCorrelationId = error.correlationId;
      _failureDetails = error.failure.details;
    } else {
      _failureKind = AuthFailureKind.unreachable;
      _failureCode = 'API_UNREACHABLE';
      // Not shown to the user: the interface writes its own copy for this kind,
      // because this message would be developer facing.
      _failureMessage = null;
      _failureCorrelationId = null;
      _failureDetails = null;
    }
  }

  /// Records a response the client could not decode.
  ///
  /// Grouped with a transport failure because they are the same situation from
  /// the user's side: nothing usable came back, and retrying the same input may
  /// work. The reason is kept as a developer-facing value only, never shown, and
  /// no copy claims the server was down: the server answered, with something
  /// this client does not understand (AGENTS.md section 5).
  void _recordUnreadable([Object? reason]) {
    _failureKind = AuthFailureKind.unreachable;
    _failureCode = 'API_RESPONSE_UNREADABLE';
    // Not shown to the user: the interface writes its own copy for this kind,
    // because these messages are developer facing.
    _failureMessage = null;
    _failureCorrelationId = null;
    _failureDetails = null;
    if (reason != null) {
      debugPrint('DeliveryUY: unreadable API response: $reason');
    }
  }

  void _clearFailure() {
    _failureKind = null;
    _failureCode = null;
    _failureMessage = null;
    _failureCorrelationId = null;
    _failureDetails = null;
  }

  /// Code the API answers when the access token is missing or no longer valid.
  static const String _unauthenticatedCode = 'UNAUTHENTICATED';
}

/// Outcome of one `GET /auth/me` attempt.
///
/// The three cases are kept apart instead of collapsing into a nullable account,
/// because "the credential was refused" and "the request was refused" call for
/// different next steps: only the first one can be fixed by renewing the session.
class _AccountAttempt {
  /// The API accepted the token.
  const _AccountAttempt.read(AuthUser this.account)
    : error = null,
      tokenRejected = false;

  /// The API refused the request for a reason a renewal cannot fix.
  const _AccountAttempt.rejected(ApiClientException this.error)
    : account = null,
      tokenRejected = false;

  /// The API could not be reached, or answered something unreadable.
  ///
  /// [error] is null for the second case: the caller only needs the distinction
  /// from a rejected token, and there is no client exception to hand over.
  const _AccountAttempt.unreachable(this.error)
    : account = null,
      tokenRejected = false;

  /// The API refused the credential itself.
  const _AccountAttempt.tokenRejected()
    : account = null,
      error = null,
      tokenRejected = true;

  /// The account, when the API accepted the token.
  final AuthUser? account;

  /// What went wrong, when something did. Already recorded on the controller.
  final ApiClientException? error;

  /// Whether a renewal could still make this request succeed.
  final bool tokenRejected;
}