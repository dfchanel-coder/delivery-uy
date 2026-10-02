import 'dart:async';

import 'package:flutter/material.dart';

import 'auth_controller.dart';

/// Sign-in screen.
///
/// It validates for the user's benefit only: the API decides whether credentials
/// are acceptable, and this screen never treats a local check as permission
/// (AGENTS.md section 42).
class LoginPage extends StatefulWidget {
  /// Creates the sign-in screen.
  const LoginPage({super.key, required this.controller});

  /// Session state this screen drives.
  final AuthController controller;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
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

    await widget.controller.signIn(email: _email.text, password: _password.text);
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('DeliveryUY')),
      body: ListenableBuilder(
        listenable: widget.controller,
        builder: (BuildContext context, Widget? _) {
          final bool busy = widget.controller.isSubmitting;

          return SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 420),
                  child: Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: <Widget>[
                        Text(
                          'Pide a comercios de tu barrio y sigue tu reparto en tiempo real.',
                          style: theme.textTheme.titleMedium,
                        ),
                        const SizedBox(height: 24),
                        TextFormField(
                          controller: _email,
                          enabled: !busy,
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
                        ),
                        const SizedBox(height: 16),
                        TextFormField(
                          controller: _password,
                          enabled: !busy,
                          obscureText: true,
                          textInputAction: TextInputAction.done,
                          autofillHints: const <String>[
                            AutofillHints.password,
                          ],
                          decoration: const InputDecoration(
                            labelText: 'Contraseña',
                            border: OutlineInputBorder(),
                          ),
                          onFieldSubmitted: busy ? null : (_) => unawaited(_submit()),
                          validator: (String? value) {
                            if ((value ?? '').isEmpty) {
                              return 'Ingresa tu contraseña.';
                            }

                            return null;
                          },
                        ),
                        if (widget.controller.failureKind != null) ...<Widget>[
                          const SizedBox(height: 16),
                          _FailureBanner(controller: widget.controller),
                        ],
                        const SizedBox(height: 24),
                        FilledButton(
                          onPressed: busy ? null : () => unawaited(_submit()),
                          child: busy
                              ? const SizedBox(
                                  height: 20,
                                  width: 20,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Text('Ingresar'),
                        ),
                        const SizedBox(height: 32),
                        Text(
                          'Servidor: ${widget.controller.config.apiBaseUrl}',
                          style: theme.textTheme.bodySmall,
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

/// Explains why the last attempt failed.
///
/// The copy lives here, in the interface, and not in the controller: the API
/// message is shown when the API produced one, and this screen writes the
/// wording for a server it could not reach (AGENTS.md section 44).
class _FailureBanner extends StatelessWidget {
  const _FailureBanner({required this.controller});

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
}