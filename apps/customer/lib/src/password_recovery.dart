import 'dart:async';

import 'package:deliveryuy_core/deliveryuy_core.dart';
import 'package:flutter/material.dart';

import 'auth_controller.dart';
import 'auth_forms.dart';

/// Where the person is in the password recovery flow.
///
/// The flow has three steps, not two: asking for a message and redeeming it are
/// separate requests separated by however long the delivery takes, which may be
/// never. Collapsing them into a boolean would make "we asked" and "we sent you
/// something" the same state, and only the first one is true (AGENTS.md
/// section 5).
enum PasswordRecoveryStep {
  /// Nothing has been asked for yet.
  requesting,

  /// A message was requested and the acknowledgement arrived.
  ///
  /// Says nothing about whether an address is registered or whether a message
  /// exists, because the API deliberately does not say.
  awaitingCode,

  /// The password was changed and every session was revoked.
  completed,
}

/// Drives the password recovery screens.
///
/// Separate from [AuthController] because recovery is not a session state. It
/// never opens a session, and the person using it cannot: the API returns no
/// credentials after a reset, so a controller that treated recovery as a way in
/// would be describing something the API does not do (SECURITY.md).
///
/// Nothing here decides whether an address exists, whether a token is valid, or
/// what a password may be. Those are the API's decisions; this only reports what
/// it answered (AGENTS.md section 42).
class PasswordRecoveryController extends ChangeNotifier implements AuthFailureSource {
  /// Creates the flow over [authApi].
  PasswordRecoveryController({required this.authApi});

  /// Recovery endpoints this flow calls.
  final AuthApi authApi;

  PasswordRecoveryStep _step = PasswordRecoveryStep.requesting;
  bool _submitting = false;
  AuthFailureKind? _failureKind;
  String? _failureCode;
  String? _failureMessage;
  String? _failureCorrelationId;
  Map<String, Object?>? _failureDetails;

  /// Which part of the flow the person is on.
  PasswordRecoveryStep get step => _step;

  /// Whether a request is in flight.
  ///
  /// The screens disable their fields from this rather than from a local flag, so
  /// a double tap cannot start two requests that would both spend a token
  /// (AGENTS.md section 43).
  bool get isSubmitting => _submitting;

  /// Why the last attempt failed, or null when it succeeded.
  @override
  AuthFailureKind? get failureKind => _failureKind;

  /// Machine readable code of the last failure, for support conversations.
  String? get failureCode => _failureCode;

  /// Message supplied by the API for the last failure.
  @override
  String? get failureMessage => _failureMessage;

  /// Server-side log identifier for the last failure, when the API sent one.
  @override
  String? get failureCorrelationId => _failureCorrelationId;

  /// Structured details supplied by the API, such as the reasons a password was
  /// refused.
  @override
  Map<String, Object?>? get failureDetails => _failureDetails;

  @override
  String get failureFallbackMessage => 'No pudimos cambiar la contraseña.';

  /// Asks the API to send a recovery message.
  ///
  /// Success means the API accepted the request, not that an address exists and
  /// not that a message was delivered. Both depend on facts this layer cannot
  /// see, so the screens are written to survive either answer (AGENTS.md
  /// section 5).
  Future<void> requestRecovery(String email) async {
    if (_submitting) {
      return;
    }

    final String address = email.trim();

    // Presence only. Whether the address looks like an address is the API's
    // call, and a local rule stricter than the server's would refuse a request
    // the API would have accepted.
    if (address.isEmpty) {
      return;
    }

    _submitting = true;
    _clearFailure();
    notifyListeners();

    try {
      await authApi.requestPasswordRecovery(email: address);
      _step = PasswordRecoveryStep.awaitingCode;
    } on ApiClientException catch (error) {
      // The step is left where it was: the acknowledgement is what proves the
      // request reached the API, and a failure is not an acknowledgement.
      _recordFrom(error);
    } on FormatException catch (error) {
      // An acknowledgement that cannot be decoded proves nothing either. Showing
      // the code step here would tell the person to look for a message that may
      // never have been requested.
      _recordUnreadable(error);
    } finally {
      _submitting = false;
      notifyListeners();
    }
  }

  /// Redeems the token from the message and sets a new password.
  ///
  /// The token is not kept here, not even for a retry. It is consumed by the
  /// call, so a controller field holding it would be one more copy of a spent
  /// credential (SECURITY.md).
  Future<void> completeRecovery({required String token, required String password}) async {
    if (_submitting) {
      return;
    }

    if (token.trim().isEmpty || password.isEmpty) {
      return;
    }

    _submitting = true;
    _clearFailure();
    notifyListeners();

    try {
      await authApi.completePasswordRecovery(token: token, password: password);
      _step = PasswordRecoveryStep.completed;
    } on ApiClientException catch (error) {
      // Deliberately stays on the code screen, whatever the answer was. A token
      // the API refused and a server that could not be reached both leave the
      // person needing to try again from here, and moving them to the sign-in
      // form would hide the reason and discard the field they filled in.
      _recordFrom(error);
    } on FormatException catch (error) {
      // A reset that cannot be read did not happen as far as this client knows,
      // and moving to the completion screen would claim a password was changed.
      _recordUnreadable(error);
    } finally {
      _submitting = false;
      notifyListeners();
    }
  }

  /// Returns to the request step to ask for a different address.
  ///
  /// The acknowledgement is not discarded silently: the person may simply have
  /// mistyped, and going back must look like a decision rather than a reset.
  void startOver() {
    _step = PasswordRecoveryStep.requesting;
    _clearFailure();
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
      // Left null on purpose, exactly as in AuthController: this message would be
      // developer facing, and the interface writes its own wording for it.
      _failureMessage = null;
      _failureCorrelationId = null;
      _failureDetails = null;
    }
  }

  /// Records a response the client could not decode.
  ///
  /// Grouped with a transport failure because the person can act on them the same
  /// way, but reported under its own code: the server did answer, so nothing
  /// shown may suggest it was unreachable (AGENTS.md section 5).
  void _recordUnreadable(FormatException error) {
    _failureKind = AuthFailureKind.unreachable;
    _failureCode = 'API_RESPONSE_UNREADABLE';
    _failureMessage = null;
    _failureCorrelationId = null;
    _failureDetails = null;
    debugPrint('DeliveryUY: unreadable API response: $error');
  }

  void _clearFailure() {
    _failureKind = null;
    _failureCode = null;
    _failureMessage = null;
    _failureCorrelationId = null;
    _failureDetails = null;
  }
}

/// Screen for the whole password recovery flow.
///
/// Reached from the sign-in form, which is the only place someone who cannot
/// sign in can be. The copy never claims a message was sent or arrived: whether
/// one exists depends on the notification provider the deployment configures, and
/// on whether the address is registered at all, and the API refuses to say
/// (AGENTS.md sections 5 and 33).
class PasswordRecoveryPage extends StatefulWidget {
  /// Creates the screen over [controller].
  const PasswordRecoveryPage({super.key, required this.controller});

  /// Flow state this screen reacts to.
  final PasswordRecoveryController controller;

  @override
  State<PasswordRecoveryPage> createState() => _PasswordRecoveryPageState();
}

class _PasswordRecoveryPageState extends State<PasswordRecoveryPage> {
  final GlobalKey<FormState> _requestFormKey = GlobalKey<FormState>();
  final GlobalKey<FormState> _resetFormKey = GlobalKey<FormState>();
  final TextEditingController _email = TextEditingController();
  final TextEditingController _token = TextEditingController();
  final TextEditingController _password = TextEditingController();
  final TextEditingController _confirmation = TextEditingController();

  @override
  void dispose() {
    _email.dispose();
    _token.dispose();
    _password.dispose();
    _confirmation.dispose();
    super.dispose();
  }

  Future<void> _request() async {
    if (!(_requestFormKey.currentState?.validate() ?? false)) {
      return;
    }

    final String address = _email.text;

    await widget.controller.requestRecovery(address);

    // Only cleared on the way forward. A request that failed keeps the address,
    // because retyping it is the last thing someone needs after a dropped
    // connection.
    if (widget.controller.step == PasswordRecoveryStep.awaitingCode) {
      _email.clear();
    }
  }

  Future<void> _complete() async {
    if (!(_resetFormKey.currentState?.validate() ?? false)) {
      return;
    }

    final String token = _token.text;
    final String password = _password.text;

    // Cleared before the call and never restored: the controller does not keep
    // the token, and a successful reset has spent it, so leaving it in the field
    // would invite submitting a credential that can never work again.
    _token.clear();
    _password.clear();
    _confirmation.clear();
    _resetFormKey.currentState?.reset();

    await widget.controller.completeRecovery(token: token, password: password);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Recuperar contraseña')),
      body: SafeArea(
        child: ListenableBuilder(
          listenable: widget.controller,
          builder: (BuildContext context, Widget? _) {
            return Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 420),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      _body(),
                      if (widget.controller.failureKind != null) ...<Widget>[
                        const SizedBox(height: 16),
                        AuthFailureBanner(controller: widget.controller),
                      ],
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _body() {
    switch (widget.controller.step) {
      case PasswordRecoveryStep.requesting:
        return _RequestStep(
          formKey: _requestFormKey,
          email: _email,
          busy: widget.controller.isSubmitting,
          onSubmit: () => unawaited(_request()),
        );
      case PasswordRecoveryStep.awaitingCode:
        return _RedeemStep(
          formKey: _resetFormKey,
          token: _token,
          password: _password,
          confirmation: _confirmation,
          busy: widget.controller.isSubmitting,
          onSubmit: () => unawaited(_complete()),
          onStartOver: widget.controller.startOver,
        );
      case PasswordRecoveryStep.completed:
        return const _CompletedStep();
    }
  }
}

/// Step one: the address to send a message to.
class _RequestStep extends StatelessWidget {
  /// Creates the step.
  const _RequestStep({
    required this.formKey,
    required this.email,
    required this.busy,
    required this.onSubmit,
  });

  /// Form key owning the field's validation.
  final GlobalKey<FormState> formKey;

  /// Text being edited.
  final TextEditingController email;

  /// Whether a request is in flight.
  final bool busy;

  /// Invoked when the person asks to submit.
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    return Form(
      key: formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            'Escribí el correo con el que te registraste y te enviamos un mensaje '
            'para que elijas una contraseña nueva.',
            style: theme.textTheme.bodyMedium,
          ),
          const SizedBox(height: 8),
          Text(
            // The API answers the same way for every address, so this screen
            // cannot know whether one is registered. Saying so is the honest
            // wording, and it also means the screen leaks nothing to somebody
            // probing for accounts.
            'Por seguridad la respuesta es la misma exista o no la cuenta. Revisá '
            'tu correo (y la carpeta de spam) antes de pedir uno nuevo.',
            style: theme.textTheme.bodySmall,
          ),
          const SizedBox(height: 24),
          EmailField(controller: email, enabled: !busy),
          const SizedBox(height: 24),
          SubmitButton(
            busy: busy,
            label: 'Enviar mensaje',
            onPressed: onSubmit,
          ),
        ],
      ),
    );
  }
}

/// Step two: the token from the message and the new password.
class _RedeemStep extends StatelessWidget {
  /// Creates the step.
  const _RedeemStep({
    required this.formKey,
    required this.token,
    required this.password,
    required this.confirmation,
    required this.busy,
    required this.onSubmit,
    required this.onStartOver,
  });

  /// Form key owning the fields' validation.
  final GlobalKey<FormState> formKey;

  /// Token being pasted from the message.
  final TextEditingController token;

  /// New password being typed.
  final TextEditingController password;

  /// Repeat of [password], to catch a typo before spending the token.
  final TextEditingController confirmation;

  /// Whether a request is in flight.
  final bool busy;

  /// Invoked when the person asks to submit.
  final VoidCallback onSubmit;

  /// Invoked when the person wants to ask for a different message.
  final VoidCallback onStartOver;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    return Form(
      key: formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            'Si esa cuenta existe, el mensaje trae un código. Pegalo acá junto con '
            'la contraseña nueva que quieras usar.',
            style: theme.textTheme.bodyMedium,
          ),
          const SizedBox(height: 24),
          TextFormField(
            controller: token,
            enabled: !busy,
            // The token is a long opaque string, so autocorrect, suggestions and
            // capitalisation would all corrupt it.
            autocorrect: false,
            enableSuggestions: false,
            textCapitalization: TextCapitalization.none,
            keyboardType: TextInputType.text,
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(
              labelText: 'Código del mensaje',
              border: OutlineInputBorder(),
            ),
            validator: (String? value) {
              if ((value ?? '').trim().isEmpty) {
                return 'Ingresá el código del mensaje.';
              }

              return null;
            },
          ),
          const SizedBox(height: 16),
          PasswordField(
            controller: password,
            enabled: !busy,
            label: 'Contraseña nueva',
            textInputAction: TextInputAction.next,
          ),
          const SizedBox(height: 16),
          PasswordField(
            controller: confirmation,
            enabled: !busy,
            label: 'Repetir contraseña',
            textInputAction: TextInputAction.done,
            onSubmitted: busy ? null : (_) => onSubmit(),
            validator: (String? value) {
              if (value != password.text) {
                return 'Las contraseñas no coinciden.';
              }

              return null;
            },
          ),
          const SizedBox(height: 24),
          SubmitButton(
            busy: busy,
            label: 'Cambiar contraseña',
            onPressed: onSubmit,
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: busy ? null : onStartOver,
            child: const Text('Usar otro correo'),
          ),
        ],
      ),
    );
  }
}

/// Step three: the password changed.
class _CompletedStep extends StatelessWidget {
  /// Creates the step.
  const _CompletedStep();

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Icon(Icons.lock_reset_outlined, size: 48, color: theme.colorScheme.primary),
        const SizedBox(height: 16),
        Text(
          'Tu contraseña quedó cambiado',
          style: theme.textTheme.titleLarge,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 12),
        Text(
          // The reset revoked every session on purpose: it exists for the case
          // where someone else had the old password. Saying "you are signed out"
          // is therefore a fact about the account, not a warning about the app.
          'Por seguridad cerramos todas las sesiones abiertas con esa cuenta, '
          'incluidas las de otros dispositivos. Volvé a ingresar con la contraseña '
          'nueva.',
          style: theme.textTheme.bodyMedium,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 24),
        FilledButton(
          // Back to the sign-in form rather than straight into it: the person
          // still has to type the new password, and the form is where that
          // belongs.
          onPressed: () => Navigator.of(context).maybePop(),
          child: const Text('Ir a ingresar'),
        ),
      ],
    );
  }
}