import 'package:flutter/material.dart';

import 'auth_controller.dart';
import 'auth_forms.dart';

/// Which form the authentication screen is showing.
enum AuthMode {
  /// Existing account.
  signIn,

  /// New account.
  signUp,
}

/// Authentication screen: sign in or create an account.
///
/// The mode is interface state, not session state, so it lives in the widget
/// instead of the controller: a failed request must not decide which form the
/// user is looking at. Both forms validate for the user's benefit only, and the
/// API decides what is acceptable (AGENTS.md section 42).
class AuthPage extends StatefulWidget {
  /// Creates the authentication screen.
  const AuthPage({super.key, required this.controller});

  /// Session state this screen drives.
  final AuthController controller;

  @override
  State<AuthPage> createState() => _AuthPageState();
}

class _AuthPageState extends State<AuthPage> {
  AuthMode _mode = AuthMode.signIn;

  void _show(AuthMode mode) {
    widget.controller.clearFailure();
    setState(() => _mode = mode);
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('DeliveryUY')),
      body: ListenableBuilder(
        listenable: widget.controller,
        builder: (BuildContext context, Widget? _) {
          return SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 420),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      Text(
                        'Pide a comercios de tu barrio y sigue tu reparto en tiempo real.',
                        style: theme.textTheme.titleMedium,
                      ),
                      const SizedBox(height: 24),
                      SegmentedButton<AuthMode>(
                        segments: const <ButtonSegment<AuthMode>>[
                          ButtonSegment<AuthMode>(
                            value: AuthMode.signIn,
                            label: Text('Ingresar'),
                          ),
                          ButtonSegment<AuthMode>(
                            value: AuthMode.signUp,
                            label: Text('Crear cuenta'),
                          ),
                        ],
                        selected: <AuthMode>{_mode},
                        onSelectionChanged: (Set<AuthMode> selection) =>
                            _show(selection.first),
                      ),
                      const SizedBox(height: 24),
                      if (_mode == AuthMode.signIn)
                        SignInForm(controller: widget.controller)
                      else
                        SignUpForm(
                          controller: widget.controller,
                          onSignInRequested: () => _show(AuthMode.signIn),
                        ),
                      if (widget.controller.failureKind != null) ...<Widget>[
                        const SizedBox(height: 16),
                        AuthFailureBanner(controller: widget.controller),
                      ],
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
          );
        },
      ),
    );
  }
}