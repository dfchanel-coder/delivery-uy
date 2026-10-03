import 'dart:async';
import 'dart:convert';

import 'package:deliveryuy_core/deliveryuy_core.dart';
import 'package:deliveryuy_customer/src/auth_controller.dart';
import 'package:deliveryuy_customer/src/password_recovery.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const AppConfig _config = AppConfig(
  apiBaseUrl: 'http://localhost:3000/api/v1',
  apiTimeout: Duration(seconds: 5),
);

/// The opaque token shape the API actually issues: `pr_` plus base64url of 32
/// random bytes (packages/auth crypto.ts).
const String _token = 'pr_9Xk2vQ7bLw0mNc4ZrT8yHsD1fGaJ5uPeRiBoXyVnC3Q';

void main() {
  late List<http.Request> sent;

  setUp(() {
    sent = <http.Request>[];
  });

  PasswordRecoveryController controllerOver(
    Future<http.Response> Function(http.Request request) handler,
  ) {
    return PasswordRecoveryController(
      authApi: AuthApi(
        ApiClient(
          config: _config,
          httpClient: MockClient((http.Request request) {
            sent.add(request);

            return handler(request);
          }),
        ),
      ),
    );
  }

  PasswordRecoveryController answeringWith(Object? data, {int status = 200}) {
    return controllerOver(
      (_) async => http.Response(
        jsonEncode(<String, Object?>{'data': data}),
        status,
        headers: <String, String>{'content-type': 'application/json'},
      ),
    );
  }

  PasswordRecoveryController refusingWith(
    String code,
    String message, {
    Object? details,
    int status = 400,
    String? correlationId,
  }) {
    return controllerOver(
      (_) async => http.Response(
        jsonEncode(<String, Object?>{
          'error': <String, Object?>{
            'code': code,
            'message': message,
            if (details case final Object value) 'details': value,
            if (correlationId case final String value) 'correlationId': value,
          },
        }),
        status,
        headers: <String, String>{'content-type': 'application/json'},
      ),
    );
  }

  group('requesting a recovery message', () {
    test('starts on the request step', () {
      expect(
        answeringWith(<String, Object?>{'status': 'accepted'}, status: 202).step,
        PasswordRecoveryStep.requesting,
      );
    });

    test('posts the address to password/forgot and accepts 202', () async {
      final PasswordRecoveryController controller = answeringWith(
        <String, Object?>{'status': 'accepted'},
        status: 202,
      );

      await controller.requestRecovery('  customer@deliveryuy.local  ');

      expect(sent, hasLength(1));
      expect(sent.single.url.path, '/api/v1/auth/password/forgot');
      expect(sent.single.method, 'POST');
      // Trimmed, because the stored address is normalized and a surrounding
      // space would be part of what is hashed.
      expect(
        jsonDecode(sent.single.body),
        <String, Object?>{'email': 'customer@deliveryuy.local'},
      );
      expect(controller.step, PasswordRecoveryStep.awaitingCode);
      expect(controller.failureKind, isNull);
    });

    test('refuses to send an empty address', () async {
      final PasswordRecoveryController controller = answeringWith(
        <String, Object?>{'status': 'accepted'},
        status: 202,
      );

      await controller.requestRecovery('   ');

      expect(sent, isEmpty);
      expect(controller.step, PasswordRecoveryStep.requesting);
    });

    test('ignores a second tap while one is in flight', () async {
      // Two requests would create two tokens and invalidate the first, leaving
      // the person holding a code the API will refuse (AGENTS.md section 43).
      final Completer<void> gate = Completer<void>();
      final PasswordRecoveryController controller = controllerOver((_) async {
        await gate.future;

        return http.Response(
          jsonEncode(<String, Object?>{
            'data': <String, Object?>{'status': 'accepted'},
          }),
          202,
          headers: <String, String>{'content-type': 'application/json'},
        );
      });

      final Future<void> first = controller.requestRecovery('customer@deliveryuy.local');
      await controller.requestRecovery('customer@deliveryuy.local');
      gate.complete();
      await first;

      expect(sent, hasLength(1));
    });

    test('refuses an acknowledgement carrying another status', () async {
      // The literal is part of the contract. Reading `status: 'sent'` as success
      // would silently accept a renamed contract, and moving to the code step
      // would send somebody looking for a message nobody confirmed.
      final PasswordRecoveryController controller = answeringWith(
        <String, Object?>{'status': 'sent'},
        status: 202,
      );

      await controller.requestRecovery('customer@deliveryuy.local');

      expect(controller.step, PasswordRecoveryStep.requesting);
      expect(controller.failureKind, AuthFailureKind.unreachable);
      expect(controller.failureCode, 'API_RESPONSE_UNREADABLE');
      // Never shown: the wording would be about the contract, not about the
      // person trying to get back into their account.
      expect(controller.failureMessage, isNull);
    });

    test('stays on the request step when the API refuses', () async {
      final PasswordRecoveryController controller = refusingWith(
        'RATE_LIMITED',
        'Too many attempts.',
        status: 429,
        correlationId: 'c1c1c1c1-0000-4000-8000-0000000000aa',
      );

      await controller.requestRecovery('customer@deliveryuy.local');

      expect(controller.step, PasswordRecoveryStep.requesting);
      expect(controller.failureKind, AuthFailureKind.rejected);
      expect(controller.failureCode, 'RATE_LIMITED');
      expect(controller.failureMessage, 'Too many attempts.');
      expect(controller.failureCorrelationId, 'c1c1c1c1-0000-4000-8000-0000000000aa');
    });

    test('tells an unreachable server apart from a refused one', () async {
      final PasswordRecoveryController controller = controllerOver(
        (_) async => throw http.ClientException('connection refused'),
      );

      await controller.requestRecovery('customer@deliveryuy.local');

      expect(controller.failureKind, AuthFailureKind.unreachable);
      expect(controller.failureCode, 'API_UNREACHABLE');
      // Deliberately null: that text is written for logs, and the interface
      // writes its own wording for a server it could not reach.
      expect(controller.failureMessage, isNull);
    });
  });

  group('redeeming the token', () {
    /// A controller that has already reached the code step.
    ///
    /// [onReset] answers the redeem call; without it the reset succeeds. Given
    /// explicitly per test so each one states what the API does on the call it is
    /// actually about, rather than relying on a shared default.
    Future<PasswordRecoveryController> atCodeStep({
      Future<http.Response> Function(http.Request request)? onReset,
    }) async {
      final PasswordRecoveryController controller = controllerOver((http.Request request) async {
        if (request.url.path.endsWith('/password/forgot')) {
          return http.Response(
            jsonEncode(<String, Object?>{
              'data': <String, Object?>{'status': 'accepted'},
            }),
            202,
            headers: <String, String>{'content-type': 'application/json'},
          );
        }

        if (onReset != null) {
          return onReset(request);
        }

        return http.Response(
          jsonEncode(<String, Object?>{'data': <String, Object?>{'status': 'reset'}}),
          200,
          headers: <String, String>{'content-type': 'application/json'},
        );
      });

      await controller.requestRecovery('customer@deliveryuy.local');
      sent.clear();

      return controller;
    }

    test('posts the token and the new password', () async {
      final PasswordRecoveryController controller = await atCodeStep();

      await controller.completeRecovery(token: '  $_token  ', password: 'NuevaClave-2026!');

      expect(sent, hasLength(1));
      expect(sent.single.url.path, '/api/v1/auth/password/reset');
      expect(jsonDecode(sent.single.body), <String, Object?>{
        'token': _token,
        'password': 'NuevaClave-2026!',
      });
      expect(controller.step, PasswordRecoveryStep.completed);
      expect(controller.failureKind, isNull);
    });

    test('refuses an empty token or password', () async {
      final PasswordRecoveryController controller = await atCodeStep();

      await controller.completeRecovery(token: '  ', password: 'NuevaClave-2026!');
      await controller.completeRecovery(token: _token, password: '');

      expect(sent, isEmpty);
      expect(controller.step, PasswordRecoveryStep.awaitingCode);
    });

    test('stays on the code step when the token is refused', () async {
      // Moving to another screen on a refusal would hide the reason and discard
      // what the person typed.
      final PasswordRecoveryController controller = await atCodeStep(
        onReset: (_) async => http.Response(
          jsonEncode(<String, Object?>{
            'error': <String, Object?>{
              'code': 'TOKEN_INVALID',
              'message': 'Recovery code is invalid or has expired.',
            },
          }),
          401,
          headers: <String, String>{'content-type': 'application/json'},
        ),
      );

      await controller.completeRecovery(token: 'pr_inventado', password: 'NuevaClave-2026!');

      expect(controller.step, PasswordRecoveryStep.awaitingCode);
      expect(controller.failureKind, AuthFailureKind.rejected);
      expect(controller.failureMessage, 'Recovery code is invalid or has expired.');
    });

    test('surfaces the reasons the API refused the password', () async {
      final PasswordRecoveryController controller = controllerOver((http.Request request) async {
        if (request.url.path.endsWith('/password/forgot')) {
          return http.Response(
            jsonEncode(<String, Object?>{
              'data': <String, Object?>{'status': 'accepted'},
            }),
            202,
            headers: <String, String>{'content-type': 'application/json'},
          );
        }

        return http.Response(
          jsonEncode(<String, Object?>{
            'error': <String, Object?>{
              'code': 'VALIDATION_FAILED',
              'message': 'Password does not meet the requirements.',
              'details': <String, Object?>{
                'reasons': <String>['Password is too short.'],
              },
            },
          }),
          400,
          headers: <String, String>{'content-type': 'application/json'},
        );
      });

      await controller.requestRecovery('customer@deliveryuy.local');
      await controller.completeRecovery(token: _token, password: 'corta');

      expect(controller.failureCode, 'VALIDATION_FAILED');
      // The server owns the policy; repeating its reasons beats a client rule
      // that could disagree with it (AGENTS.md section 42).
      expect(controller.failureDetails?['reasons'], <String>['Password is too short.']);
    });

    test('stays on the code step when the server cannot be reached', () async {
      final Completer<void> gate = Completer<void>();
      final PasswordRecoveryController controller = controllerOver((http.Request request) async {
        if (request.url.path.endsWith('/password/forgot')) {
          return http.Response(
            jsonEncode(<String, Object?>{
              'data': <String, Object?>{'status': 'accepted'},
            }),
            202,
            headers: <String, String>{'content-type': 'application/json'},
          );
        }

        await gate.future;
        throw http.ClientException('connection reset');
      });

      await controller.requestRecovery('customer@deliveryuy.local');

      final Future<void> attempt = controller.completeRecovery(
        token: _token,
        password: 'NuevaClave-2026!',
      );
      gate.complete();
      await attempt;

      expect(controller.step, PasswordRecoveryStep.awaitingCode);
      expect(controller.failureKind, AuthFailureKind.unreachable);
    });
  });

  group('going back', () {
    test('startOver returns to the request step and drops the failure', () async {
      final PasswordRecoveryController controller = controllerOver((http.Request request) async {
        if (request.url.path.endsWith('/password/forgot')) {
          return http.Response(
            jsonEncode(<String, Object?>{
              'data': <String, Object?>{'status': 'accepted'},
            }),
            202,
            headers: <String, String>{'content-type': 'application/json'},
          );
        }

        return http.Response(
          jsonEncode(<String, Object?>{
            'error': <String, Object?>{
              'code': 'TOKEN_INVALID',
              'message': 'Recovery code is invalid or has expired.',
            },
          }),
          401,
          headers: <String, String>{'content-type': 'application/json'},
        );
      });

      await controller.requestRecovery('customer@deliveryuy.local');
      await controller.completeRecovery(token: 'pr_inventado', password: 'NuevaClave-2026!');
      expect(controller.failureKind, AuthFailureKind.rejected);

      controller.startOver();

      expect(controller.step, PasswordRecoveryStep.requesting);
      expect(controller.failureKind, isNull);
      expect(controller.failureCode, isNull);
    });

    test('clearFailure leaves the step untouched', () async {
      final PasswordRecoveryController controller = controllerOver((http.Request request) async {
        if (request.url.path.endsWith('/password/forgot')) {
          return http.Response(
            jsonEncode(<String, Object?>{
              'data': <String, Object?>{'status': 'accepted'},
            }),
            202,
            headers: <String, String>{'content-type': 'application/json'},
          );
        }

        return http.Response(
          jsonEncode(<String, Object?>{
            'error': <String, Object?>{
              'code': 'TOKEN_INVALID',
              'message': 'Recovery code is invalid or has expired.',
            },
          }),
          401,
          headers: <String, String>{'content-type': 'application/json'},
        );
      });

      await controller.requestRecovery('customer@deliveryuy.local');
      await controller.completeRecovery(token: 'pr_inventado', password: 'NuevaClave-2026!');

      controller.clearFailure();

      expect(controller.failureKind, isNull);
      // Clearing the message must not move the person off the screen they need.
      expect(controller.step, PasswordRecoveryStep.awaitingCode);
    });
  });

  group('screens', () {
    Future<void> pumpRecovery(
      WidgetTester tester,
      Future<http.Response> Function(http.Request request) handler,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: PasswordRecoveryPage(
            controller: PasswordRecoveryController(
              authApi: AuthApi(
                ApiClient(
                  config: _config,
                  httpClient: MockClient(handler),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    Future<void> goToCodeStep(WidgetTester tester) async {
      await tester.enterText(find.byType(TextFormField).first, 'customer@deliveryuy.local');
      await tester.tap(find.widgetWithText(FilledButton, 'Enviar mensaje'));
      await tester.pumpAndSettle();
    }

    testWidgets('never claims a message was sent', (WidgetTester tester) async {
      await pumpRecovery(tester, (_) async => http.Response('', 202));

      // The acknowledgement is not a delivery receipt, so the wording cannot be
      // "we sent you a message" (AGENTS.md section 5).
      expect(find.textContaining('escribí el correo'), findsNothing);
      expect(find.textContaining('Si esa cuenta existe'), findsNothing);
    });

    testWidgets('asks for the address, then moves on when accepted', (
      WidgetTester tester,
    ) async {
      await pumpRecovery(
        tester,
        (_) async => http.Response(
          jsonEncode(<String, Object?>{
            'data': <String, Object?>{'status': 'accepted'},
          }),
          202,
          headers: <String, String>{'content-type': 'application/json'},
        ),
      );

      expect(find.widgetWithText(FilledButton, 'Enviar mensaje'), findsOneWidget);

      await goToCodeStep(tester);

      expect(find.widgetWithText(FilledButton, 'Cambiar contraseña'), findsOneWidget);
      expect(find.text('Código del mensaje'), findsOneWidget);
      // The email field is gone with its step, and the acknowledgement already
      // carried nothing worth keeping on screen.
      expect(find.widgetWithText(FilledButton, 'Enviar mensaje'), findsNothing);
    });

    testWidgets('keeps the address when the request could not be sent', (
      WidgetTester tester,
    ) async {
      await pumpRecovery(tester, (_) async => throw http.ClientException('refused'));

      await tester.enterText(find.byType(TextFormField).first, 'customer@deliveryuy.local');
      await tester.tap(find.widgetWithText(FilledButton, 'Enviar mensaje'));
      await tester.pumpAndSettle();

      expect(find.textContaining('No pudimos conectar'), findsOneWidget);
      // Retyping an address after a dropped connection is the last thing
      // somebody needs.
      expect(
        tester.widget<TextFormField>(find.byType(TextFormField).first).controller?.text,
        'customer@deliveryuy.local',
      );
    });

    testWidgets('rejects a repeated password before spending the token', (
      WidgetTester tester,
    ) async {
      var asked = 0;

      await pumpRecovery(tester, (http.Request request) async {
        asked += 1;

        return http.Response(
          jsonEncode(<String, Object?>{
            'data': <String, Object?>{'status': 'accepted'},
          }),
          202,
          headers: <String, String>{'content-type': 'application/json'},
        );
      });

      await goToCodeStep(tester);

      await tester.enterText(find.byType(TextFormField).at(0), _token);
      await tester.enterText(find.byType(TextFormField).at(1), 'NuevaClave-2026!');
      await tester.enterText(find.byType(TextFormField).at(2), 'OtraClave-2026!');
      await tester.tap(find.widgetWithText(FilledButton, 'Cambiar contraseña'));
      await tester.pumpAndSettle();

      expect(find.text('Las contraseñas no coinciden.'), findsOneWidget);
      // One request: the for got call only. The reset never went out, so the
      // token is still usable after the typo is fixed.
      expect(asked, 1);
    });

    testWidgets('clears the token field before the call so a spent token is not resubmitted', (
      WidgetTester tester,
    ) async {
      await pumpRecovery(tester, (http.Request request) async {
        if (request.url.path.endsWith('/password/forgot')) {
          return http.Response(
            jsonEncode(<String, Object?>{
              'data': <String, Object?>{'status': 'accepted'},
            }),
            202,
            headers: <String, String>{'content-type': 'application/json'},
          );
        }

        return http.Response(
          jsonEncode(<String, Object?>{
            'error': <String, Object?>{
              'code': 'TOKEN_INVALID',
              'message': 'Recovery code is invalid or has expired.',
            },
          }),
          401,
          headers: <String, String>{'content-type': 'application/json'},
        );
      });

      await goToCodeStep(tester);

      await tester.enterText(find.byType(TextFormField).at(0), 'pr_inventado');
      await tester.enterText(find.byType(TextFormField).at(1), 'NuevaClave-2026!');
      await tester.enterText(find.byType(TextFormField).at(2), 'NuevaClave-2026!');
      await tester.tap(find.widgetWithText(FilledButton, 'Cambiar contraseña'));
      await tester.pumpAndSettle();

      expect(find.text('Recovery code is invalid or has expired.'), findsOneWidget);
      expect(
        tester.widget<TextFormField>(find.byType(TextFormField).first).controller?.text,
        isEmpty,
      );
    });

    testWidgets('says every session was closed after a completed reset', (
      WidgetTester tester,
    ) async {
      await pumpRecovery(tester, (http.Request request) async {
        if (request.url.path.endsWith('/password/forgot')) {
          return http.Response(
            jsonEncode(<String, Object?>{
              'data': <String, Object?>{'status': 'accepted'},
            }),
            202,
            headers: <String, String>{'content-type': 'application/json'},
          );
        }

        return http.Response(
          jsonEncode(<String, Object?>{
            'data': <String, Object?>{'status': 'reset'},
          }),
          200,
          headers: <String, String>{'content-type': 'application/json'},
        );
      });

      await goToCodeStep(tester);

      await tester.enterText(find.byType(TextFormField).at(0), _token);
      await tester.enterText(find.byType(TextFormField).at(1), 'NuevaClave-2026!');
      await tester.enterText(find.byType(TextFormField).at(2), 'NuevaClave-2026!');
      await tester.tap(find.widgetWithText(FilledButton, 'Cambiar contraseña'));
      await tester.pumpAndSettle();

      expect(find.text('Tu contraseña quedó cambiado'), findsOneWidget);
      // The API returns no credentials after a reset, so claiming the person is
      // signed in would be false.
      expect(find.textContaining('cerramos todas las sesiones'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Ir a ingresar'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Cambiar contraseña'), findsNothing);
    });

    testWidgets('going back to the request step is a button, not a silent reset', (
      WidgetTester tester,
    ) async {
      await pumpRecovery(
        tester,
        (_) async => http.Response(
          jsonEncode(<String, Object?>{
            'data': <String, Object?>{'status': 'accepted'},
          }),
          202,
          headers: <String, String>{'content-type': 'application/json'},
        ),
      );

      await goToCodeStep(tester);

      expect(find.text('Usar otro correo'), findsOneWidget);

      await tester.tap(find.text('Usar otro correo'));
      await tester.pumpAndSettle();

      expect(find.widgetWithText(FilledButton, 'Enviar mensaje'), findsOneWidget);
    });
  });
}