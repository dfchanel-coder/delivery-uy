import 'dart:async';

import 'package:flutter/material.dart';

import 'auth_controller.dart';

/// Explains why the last attempt failed.
///
/// The copy lives here, in the interface, and not in the controller: the API
/// message is shown when the API produced one, and this screen writes the
/// wording for a server it could not reach (AGENTS.md section 44).
class AuthFailureBanner extends StatelessWidget {
  /// Creates the banner.
  const AuthFailureBanner({super.key, required this.controller});

  /// Session state holding the failure to describe.
  final AuthController controller;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final AuthFailureKind? kind = controller.failureKind;
    final String message = kind == AuthFailureKind.unreachable
        ? 'No pudimos conectar con el servidor. Revisá tu conexión e intentá de nuevo.'
        : controller.failureMessage ?? 'No pudimos iniciar sesión.';

    return Card(
      color: theme.colorScheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(Icons.error_outline, color: theme.colorScheme.onErrorContainer),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    message,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onErrorContainer,
                    ),
                  ),
                ),
              ],
            ),
            // The API sends actionable reasons for a rejected password, and
            // repeating them beats inventing a client-side policy that could
            // disagree with the server.
            ..._reasons().map(
              (String reason) => Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  '• $reason',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onErrorContainer,
                  ),
                ),
              ),
            ),
            if (controller.failureCorrelationId != null) ...<Widget>[
              const SizedBox(height: 8),
              Text(
                'Referencia: ${controller.failureCorrelationId}',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onErrorContainer,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  List<String> _reasons() {
    final Object? raw = controller.failureDetails?['reasons'];

    if (raw is! List) {
      return const <String>[];
    }

    return raw.whereType<String>().toList(growable: false);
  }
}

/// Form for an existing account.
class SignInForm extends StatefulWidget {
  /// Creates the sign-in form.
  const SignInForm({super.key, required this.controller});

  /// Session state this form drives.
  final AuthController controller;

  @override
  State<SignInForm> createState() => _SignInFormState();
}

class _SignInFormState extends State<SignInForm> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }

    await widget.controller.signIn(
      email: _email.text,
      password: _password.text,
    );
  }

  @override
  Widget build(BuildContext context) {
    final bool busy = widget.controller.isSubmitting;

    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          EmailField(controller: _email, enabled: !busy),
          const SizedBox(height: 16),
          PasswordField(
            controller: _password,
            enabled: !busy,
            textInputAction: TextInputAction.done,
            onSubmitted: busy ? null : (_) => unawaited(_submit()),
          ),
          const SizedBox(height: 24),
          SubmitButton(
            busy: busy,
            label: 'Ingresar',
            onPressed: () => unawaited(_submit()),
          ),
        ],
      ),
    );
  }
}

/// Form for a new account.
class SignUpForm extends StatefulWidget {
  /// Creates the sign-up form.
  const SignUpForm({super.key, required this.controller, required this.onSignInRequested});

  /// Session state this form drives.
  final AuthController controller;

  /// Called when the user asks for the sign-in form instead.
  final VoidCallback onSignInRequested;

  @override
  State<SignUpForm> createState() => _SignUpFormState();
}

class _SignUpFormState extends State<SignUpForm> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  final TextEditingController _confirmation = TextEditingController();

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _confirmation.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }

    await widget.controller.register(
      email: _email.text,
      password: _password.text,
    );
  }

  @override
  Widget build(BuildContext context) {
    final bool busy = widget.controller.isSubmitting;

    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          EmailField(controller: _email, enabled: !busy),
          const SizedBox(height: 16),
          PasswordField(
            controller: _password,
            enabled: !busy,
            textInputAction: TextInputAction.next,
          ),
          const SizedBox(height: 16),
          PasswordField(
            controller: _confirmation,
            enabled: !busy,
            label: 'Repetir contraseña',
            textInputAction: TextInputAction.done,
            onSubmitted: busy ? null : (_) => unawaited(_submit()),
            validator: (String? value) {
              if (value != _password.text) {
                return 'Las contraseñas no coinciden.';
              }

              return null;
            },
          ),
          const SizedBox(height: 24),
          SubmitButton(
            busy: busy,
            label: 'Crear cuenta',
            onPressed: () => unawaited(_submit()),
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: busy ? null : widget.onSignInRequested,
            child: const Text('Ya tengo cuenta'),
          ),
        ],
      ),
    );
  }
}

/// Address input shared by both forms.
class EmailField extends StatelessWidget {
  /// Creates the address input.
  const EmailField({super.key, required this.controller, required this.enabled});

  /// Text being edited.
  final TextEditingController controller;

  /// Whether the field accepts input.
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      enabled: enabled,
      keyboardType: TextInputType.emailAddress,
      textInputAction: TextInputAction.next,
      autofillHints: const <String>[AutofillHints.email],
      decoration: const InputDecoration(
        labelText: 'Correo electrónico',
        border: OutlineInputBorder(),
      ),
      validator: (String? value) {
        final String email = value?.trim() ?? '';

        if (email.isEmpty) {
          return 'Ingresa tu correo electrónico.';
        }

        if (!email.contains('@')) {
          return 'El correo electrónico no es válido.';
        }

        return null;
      },
    );
  }
}

/// Secret input shared by both forms.
class PasswordField extends StatelessWidget {
  /// Creates the secret input.
  const PasswordField({
    super.key,
    required this.controller,
    required this.enabled,
    this.label = 'Contraseña',
    this.textInputAction = TextInputAction.done,
    this.validator,
    this.onSubmitted,
  });

  /// Text being edited.
  final TextEditingController controller;

  /// Whether the field accepts input.
  final bool enabled;

  /// Label shown above the field.
  final String label;

  /// Action key for the keyboard.
  final TextInputAction textInputAction;

  /// Extra rule applied after the field is not empty.
  final FormFieldValidator<String>? validator;

  /// Called when the keyboard action key is pressed.
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      enabled: enabled,
      obscureText: true,
      textInputAction: textInputAction,
      autofillHints: const <String>[AutofillHints.newPassword],
      decoration: InputDecoration(
        labelText: label,
        border: const OutlineInputBorder(),
      ),
      onFieldSubmitted: onSubmitted,
      validator: (String? value) {
        if ((value ?? '').isEmpty) {
          return 'Ingresa tu contraseña.';
        }

        return validator?.call(value);
      },
    );
  }
}

/// Primary action of a form, with the busy state wired to it.
class SubmitButton extends StatelessWidget {
  /// Creates the submit button.
  const SubmitButton({
    super.key,
    required this.busy,
    required this.label,
    required this.onPressed,
  });

  /// Whether a request is in flight.
  final bool busy;

  /// Label shown when idle.
  final String label;

  /// Invoked when pressed while idle.
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      onPressed: busy ? null : onPressed,
      child: busy
          ? const SizedBox(
              height: 20,
              width: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : Text(label),
    );
  }
}