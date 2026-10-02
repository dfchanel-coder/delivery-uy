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

/// Owns the session state of the customer application.
///
/// The controller holds credentials in memory and nothing else. No storage
/// backend is wired yet, so nothing is written to disk: a token that survives a
/// restart without an encrypted store is a token an attacker can lift from a
/// backup, and pretending otherwise would be worse than losing the session on
/// app restart (SECURITY.md, AGENTS.md section 30).
///
/// Every permission decision stays on the API. This class never decides what an
/// account may do; it only reflects what the API reported (AGENTS.md section 42).
class AuthController extends ChangeNotifier {
  /// Creates a controller over [authApi].
  ///
  /// [config] is carried along so the interface can show which deployment it is
  /// talking to, instead of hiding a misconfigured build behind an empty screen.
  AuthController({required this.authApi, required this.config});

  /// Validated deployment this session belongs to.
  final AppConfig config;

  /// Authentication endpoints the controller drives.
  final AuthApi authApi;

  AuthStatus _status = AuthStatus.signedOut;
  AuthSession? _session;
  String? _pendingVerificationEmail;
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
  String? get accessToken => _session?.tokens.accessToken;

  /// Address of the account waiting for verification, when that is the state.
  String? get pendingVerificationEmail => _pendingVerificationEmail;

  /// Why the last attempt failed, or null when it succeeded.
  AuthFailureKind? get failureKind => _failureKind;

  /// Machine readable code of the last failure, for support conversations.
  ///
  /// Messages change; codes are part of the contract (AGENTS.md section 36).
  String? get failureCode => _failureCode;

  /// Message supplied by the API for the last failure.
  String? get failureMessage => _failureMessage;

  /// Structured details supplied by the API, such as the password policy
  /// reasons behind a `VALIDATION_FAILED`.
  Map<String, Object?>? get failureDetails => _failureDetails;

  /// Server-side log identifier for the last failure, when the API sent one.
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

      _session = session;
      _status = AuthStatus.signedIn;
    } on ApiClientException catch (error) {
      _recordFrom(error);
    }

    notifyListeners();
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
        _status = AuthStatus.awaitingVerification;
      } else {
        _session = session;
        _status = AuthStatus.signedIn;
      }
    } on ApiClientException catch (error) {
      _recordFrom(error);
    }

    notifyListeners();
  }

  /// Ends the session.
  ///
  /// The local session is dropped before the revocation call is attempted, so a
  /// network failure cannot leave the interface showing a session that the user
  /// asked to end. A failed revocation only leaves the old token alive until it
  /// expires, which the API already bounds.
  Future<void> signOut() async {
    final AuthSession? current = _session;

    _session = null;
    _pendingVerificationEmail = null;
    _status = AuthStatus.signedOut;
    _clearFailure();
    notifyListeners();

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
  Future<AuthUser?> loadAccount() async {
    final AuthSession? current = _session;

    if (current == null) {
      return null;
    }

    try {
      return await authApi.me(current.tokens.accessToken);
    } on ApiClientException catch (error) {
      _recordFrom(error);
      notifyListeners();

      return null;
    }
  }

  /// Returns to the sign-in form from the "account created" screen.
  void dismissVerificationNotice() {
    if (_status != AuthStatus.awaitingVerification) {
      return;
    }

    _pendingVerificationEmail = null;
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

  /// Moves to the in-flight state and drops whatever the previous attempt left.
  void _begin() {
    _status = AuthStatus.submitting;
    _clearFailure();
    notifyListeners();
  }

  /// Records a rejection or a transport failure.
  ///
  /// A request failure never keeps a session: the user asked for something they
  /// do not have, and leaving a half-authenticated screen would be worse.
  void _recordFrom(ApiClientException error) {
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

    _session = null;
    _status = AuthStatus.signedOut;
  }

  void _clearFailure() {
    _failureKind = null;
    _failureCode = null;
    _failureMessage = null;
    _failureCorrelationId = null;
    _failureDetails = null;
  }
}