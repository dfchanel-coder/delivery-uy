import 'package:flutter/material.dart';

import 'auth_controller.dart';

/// Screen shown when an account exists but the API has not enabled access yet.
///
/// The wording is deliberately limited to what the API actually did: the account
/// was created and it will not sign in until the address is confirmed. It does
/// not claim that a message was sent, because delivery of that message depends
/// on a notification provider the deployment configures (or does not), and the
/// interface must not promise what the platform has not verified (AGENTS.md
/// section 5).
class VerificationPendingPage extends StatelessWidget {
  /// Creates the screen.
  const VerificationPendingPage({super.key, required this.controller});

  /// Session state holding the address that is waiting.
  final AuthController controller;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final String? address = controller.pendingVerificationEmail;

    return Scaffold(
      appBar: AppBar(title: const Text('Cuenta creada')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Icon(
                    Icons.mark_email_unread_outlined,
                    size: 48,
                    color: theme.colorScheme.primary,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'Tu cuenta está pendiente de verificación',
                    style: theme.textTheme.titleLarge,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    address == null
                        ? 'La cuenta quedó creada, pero todavía no podés ingresar.'
                        : 'La cuenta $address quedó creada, pero todavía no podés '
                            'ingresar hasta que se verifique el correo.',
                    style: theme.textTheme.bodyMedium,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: controller.dismissVerificationNotice,
                    child: const Text('Ir a ingresar'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}