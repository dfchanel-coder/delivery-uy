import 'dart:async';

import 'package:flutter/material.dart';

import 'auth_controller.dart';
import 'auth_forms.dart';

/// Screen shown when an account exists but the API has not enabled access yet.
///
/// The wording is deliberately limited to what the API actually did: the account
/// was created and it will not sign in until the address is confirmed. It offers
/// the code field because the delivery message carries a code, and a screen that
/// only said "wait" would leave the person with no way forward.
///
/// It does not claim the message arrived. Whether it did depends on the
/// notification provider the deployment configures (or does not), so the copy is
/// conditional rather than an assertion (AGENTS.md section 5).
class VerificationPendingPage extends StatefulWidget {
  /// Creates the screen.
  const VerificationPendingPage({super.key, required this.controller});

  /// Session state holding the address that is waiting.
  final AuthController controller;

  @override
  State<VerificationPendingPage> createState() => _VerificationPendingPageState();
}

class _VerificationPendingPageState extends State<VerificationPendingPage> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _code = TextEditingController();

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }

    final String code = _code.text;
    // Cleared before the call: the controller never keeps it, and leaving it in
    // the field after a success would invite a second submission of a code that
    // is already spent.
    _code.clear();
    _formKey.currentState?.reset();

    await widget.controller.confirmEmail(code);
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final String? address = widget.controller.pendingVerificationEmail;

    return Scaffold(
      appBar: AppBar(title: const Text('Cuenta creada')),
      body: SafeArea(
        child: ListenableBuilder(
          listenable: widget.controller,
          builder: (BuildContext context, Widget? _) {
            final bool busy = widget.controller.isSubmitting;
            final bool confirmed = widget.controller.pendingVerificationConfirmed;

            return Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 420),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      Icon(
                        confirmed ? Icons.verified_outlined : Icons.mark_email_unread_outlined,
                        size: 48,
                        color: theme.colorScheme.primary,
                      ),
                      const SizedBox(height: 16),
                      Text(
                        confirmed
                            ? 'Tu correo quedó verificado'
                            : 'Tu cuenta está pendiente de verificación',
                        style: theme.textTheme.titleLarge,
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 12),
                      Text(
                        _explanation(address, confirmed),
                        style: theme.textTheme.bodyMedium,
                        textAlign: TextAlign.center,
                      ),
                      if (!confirmed) ...<Widget>[
                        const SizedBox(height: 24),
                        _CodeForm(
                          formKey: _formKey,
                          code: _code,
                          busy: busy,
                          onSubmit: () => unawaited(_submit()),
                        ),
                      ],
                      if (widget.controller.failureKind != null) ...<Widget>[
                        const SizedBox(height: 16),
                        AuthFailureBanner(controller: widget.controller),
                      ],
                      const SizedBox(height: 24),
                      FilledButton(
                        onPressed: busy ? null : widget.controller.dismissVerificationNotice,
                        child: const Text('Ir a ingresar'),
                      ),
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

  /// What is true about this account, and nothing more.
  String _explanation(String? address, bool confirmed) {
    final String target = address ?? 'tu correo';

    if (confirmed) {
      // The deployment approved nothing yet, and saying so plainly is better than
      // an account that appears ready and then refuses to sign in.
      return 'La dirección $target quedó confirmada. La cuenta todavía espera una '
          'aprobación antes de poder ingresar.';
    }

    return 'La cuenta $target quedó creada, pero todavía no podés ingresar hasta '
        'que se verifique el correo. Si recibiste el mensaje, escribí acá el '
        'código que trae.';
  }
}

/// The code field and its submit button.
class _CodeForm extends StatelessWidget {
  /// Creates the form.
  const _CodeForm({
    required this.formKey,
    required this.code,
    required this.busy,
    required this.onSubmit,
  });

  /// Form key owning the field's validation.
  final GlobalKey<FormState> formKey;

  /// Text being edited.
  final TextEditingController code;

  /// Whether a request is in flight.
  final bool busy;

  /// Invoked when the person asks to submit.
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    return Form(
      key: formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          TextFormField(
            controller: code,
            enabled: !busy,
            // The platform autocorrects and capitalises what is not a sentence,
            // which would corrupt a code the person is copying.
            autocorrect: false,
            enableSuggestions: false,
            textCapitalization: TextCapitalization.none,
            keyboardType: TextInputType.text,
            textInputAction: TextInputAction.done,
            onFieldSubmitted: busy ? null : (_) => onSubmit(),
            decoration: const InputDecoration(
              labelText: 'Código de verificación',
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
          SubmitButton(busy: busy, label: 'Verificar código', onPressed: onSubmit),
        ],
      ),
    );
  }
}
