import 'dart:async';

import 'package:deliveryuy_core/deliveryuy_core.dart';
import 'package:flutter/material.dart';

import 'auth_controller.dart';

/// Screen shown while credentials are held.
///
/// It shows what the API reported and nothing more. In particular it never
/// decides what the account may do: the roles displayed here come from the
/// server and are informational (AGENTS.md sections 32 and 42).
class SessionPage extends StatefulWidget {
  /// Creates the session screen.
  const SessionPage({super.key, required this.controller});

  /// Session state this screen reads.
  final AuthController controller;

  @override
  State<SessionPage> createState() => _SessionPageState();
}

class _SessionPageState extends State<SessionPage> {
  AuthUser? _account;
  bool _checking = false;

  /// Confirms with the API that the access token is still accepted.
  ///
  /// This is not decoration: it is the only way the interface can tell a valid
  /// session from an expired or revoked one, because tokens are not persisted
  /// (AGENTS.md section 43).
  Future<void> _verify() async {
    _checking = true;
    setState(() {});

    final AuthUser? account = await widget.controller.loadAccount();

    _checking = false;

    if (!mounted) {
      return;
    }

    setState(() {
      _account = account;
    });
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final AuthSession? session = widget.controller.session;

    if (session == null) {
      // Unreachable while the controller says signedIn, but rendering nothing
      // beats dereferencing null if the two ever disagree.
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Mi sesión'),
        actions: <Widget>[
          IconButton(
            tooltip: 'Cerrar sesión',
            onPressed: () => unawaited(widget.controller.signOut()),
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: ListenableBuilder(
        listenable: widget.controller,
        builder: (BuildContext context, Widget? _) {
          return ListView(
            padding: const EdgeInsets.all(16),
            children: <Widget>[
              Text('Sesión iniciada', style: theme.textTheme.titleLarge),
              const SizedBox(height: 16),
              _InfoCard(
                title: 'Cuenta',
                rows: <_InfoRow>[
                  _InfoRow('Correo', session.user.email),
                  _InfoRow('Estado', session.user.status),
                  _InfoRow('Roles', session.user.roles.join(', ')),
                  _InfoRow('Idioma', session.user.locale),
                  _InfoRow(
                    'Correo verificado',
                    session.user.emailVerifiedAt == null
                        ? 'Pendiente'
                        : 'Sí',
                  ),
                ],
              ),
              const SizedBox(height: 16),
              _InfoCard(
                title: 'Credenciales',
                rows: <_InfoRow>[
                  _InfoRow('Emiten', session.tokens.tokenType),
                  _InfoRow(
                    'Vigencia',
                    '${session.tokens.expiresIn} s '
                        '(${session.tokens.accessTokenExpiresAt})',
                  ),
                  // The credential itself is never rendered: a token on screen
                  // ends up in screenshots and screen recordings.
                  _InfoRow('Token de acceso', 'oculto'),
                ],
              ),
              const SizedBox(height: 16),
              if (_account != null) ...<Widget>[
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.verified_user_outlined),
                    title: const Text('Sesión verificada contra la API'),
                    subtitle: Text('Identificador: ${_account!.id}'),
                  ),
                ),
                const SizedBox(height: 16),
              ],
              OutlinedButton(
                onPressed: _checking ? null : () => unawaited(_verify()),
                child: _checking
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Verificar sesión contra la API'),
              ),
              const SizedBox(height: 32),
              Text(
                'Servidor: ${widget.controller.config.apiBaseUrl}',
                style: theme.textTheme.bodySmall,
                textAlign: TextAlign.center,
              ),
            ],
          );
        },
      ),
    );
  }
}

/// A label and its value, kept together so the card stays readable.
class _InfoRow {
  const _InfoRow(this.label, this.value);

  final String label;
  final String value;
}

/// Card holding a titled group of label and value rows.
class _InfoCard extends StatelessWidget {
  const _InfoCard({required this.title, required this.rows});

  final String title;
  final List<_InfoRow> rows;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            for (final _InfoRow row in rows)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    SizedBox(
                      width: 160,
                      child: Text(
                        row.label,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ),
                    Expanded(child: Text(row.value)),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}