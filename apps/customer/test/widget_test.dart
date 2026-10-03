import 'dart:convert';

import 'package:deliveryuy_core/deliveryuy_core.dart';
import 'package:deliveryuy_customer/src/auth_controller.dart';
import 'package:deliveryuy_customer/src/auth_page.dart';
import 'package:deliveryuy_customer/src/customer_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const AppConfig _config = AppConfig(
  apiBaseUrl: 'http://localhost:3000/api/v1',
  apiTimeout: Duration(seconds: 5),
);

Map<String, Object?> _wireUser({String status = 'ACTIVE'}) {
  return <String, Object?>{
    'id': '3f0b3f2c-6f1a-4a0d-9f6a-3a1c9a0d2b11',
    'email': 'customer@deliveryuy.local',
    'status': status,
    'roles': <String>['CUSTOMER'],
    'locale': 'es-UY',
    'emailVerifiedAt': null,
    'mustChangePassword': false,
    'createdAt': '2026-01-05T12:00:00.000Z',
  };
}

Map<String, Object?> _wireTokens() {
  return <String, Object?>{
    'accessToken': 'header.payload.signature',
    'refreshToken': 'rt_1',
    'tokenType': 'Bearer',
    'expiresIn': 899,
    'accessTokenExpiresAt': '2026-01-05T12:15:00.000Z',
  };
}

Widget _appOver(AuthApi authApi) {
  return CustomerApp(
    controller: AuthController(
      authApi: authApi,
      config: _config,
      // Tests never launch twice, so the in-memory store is the honest choice:
      // it cannot stand in for a keystore, and nothing here needs one.
      tokenStore: InMemoryTokenStore(),
    ),
  );
}

AuthApi _apiOver(Future<http.Response> Function(http.Request) handler) {
  return AuthApi(
    ApiClient(
      config: _config,
      httpClient: MockClient((http.Request request) => handler(request)),
    ),
  );
}

/// The submit action of a form.
///
/// Scoped to the button because the same word labels the segmented control, and
/// a bare text finder would match both.
Finder _submit(String label) => find.widgetWithText(FilledButton, label);

/// One segment of the mode switch.
Finder _segment(String label) => find.descendant(
      of: find.byType(SegmentedButton<AuthMode>),
      matching: find.text(label),
    );

void main() {
  Future<void> fillCredentials(WidgetTester tester) async {
    await tester.enterText(find.byType(TextFormField).at(0), 'customer@deliveryuy.local');
    await tester.enterText(find.byType(TextFormField).at(1), 'LocalCustomer-2026!');
    await tester.tap(_submit('Ingresar'));
    await tester.pumpAndSettle();
  }

  Future<void> openSignUp(WidgetTester tester) async {
    await tester.tap(_segment('Crear cuenta'));
    await tester.pumpAndSettle();
  }

  Future<void> fillSignUp(WidgetTester tester) async {
    await tester.enterText(find.byType(TextFormField).at(0), 'nuevo@deliveryuy.local');
    await tester.enterText(find.byType(TextFormField).at(1), 'LocalCustomer-2026!');
    await tester.enterText(find.byType(TextFormField).at(2), 'LocalCustomer-2026!');
    await tester.tap(_submit('Crear cuenta'));
    await tester.pumpAndSettle();
  }

  testWidgets('arranca mostrando el formulario de ingreso', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      _appOver(
        _apiOver(
          (_) async => http.Response(
            jsonEncode(<String, Object?>{'data': null}),
            204,
          ),
        ),
      ),
    );

    expect(find.text('Correo electrónico'), findsOneWidget);
    expect(find.text('Contraseña'), findsOneWidget);
    expect(_submit('Ingresar'), findsOneWidget);
    expect(_submit('Crear cuenta'), findsNothing);
    expect(find.textContaining('/api/v1'), findsOneWidget);
  });

  testWidgets('el selector permite pasar al registro', (WidgetTester tester) async {
    await tester.pumpWidget(
      _appOver(
        _apiOver(
          (_) async => http.Response(
            jsonEncode(<String, Object?>{'data': null}),
            204,
          ),
        ),
      ),
    );

    await openSignUp(tester);

    expect(find.text('Repetir contraseña'), findsOneWidget);
    expect(_submit('Crear cuenta'), findsOneWidget);
    expect(_submit('Ingresar'), findsNothing);

    await tester.tap(find.text('Ya tengo cuenta'));
    await tester.pumpAndSettle();

    expect(find.text('Repetir contraseña'), findsNothing);
    expect(_submit('Ingresar'), findsOneWidget);
  });

  testWidgets('no envía nada si el correo está vacío', (WidgetTester tester) async {
    final List<http.Request> sent = <http.Request>[];
    await tester.pumpWidget(
      _appOver(
        _apiOver((http.Request request) async {
          sent.add(request);

          return http.Response('', 204);
        }),
      ),
    );

    await tester.enterText(find.byType(TextFormField).at(1), 'secret');
    await tester.tap(_submit('Ingresar'));
    await tester.pumpAndSettle();

    expect(find.text('Ingresa tu correo electrónico.'), findsOneWidget);
    expect(sent, isEmpty);
  });

  testWidgets('no crea la cuenta si las contraseñas no coinciden', (
    WidgetTester tester,
  ) async {
    final List<http.Request> sent = <http.Request>[];
    await tester.pumpWidget(
      _appOver(
        _apiOver((http.Request request) async {
          sent.add(request);

          return http.Response('', 204);
        }),
      ),
    );

    await openSignUp(tester);
    await tester.enterText(find.byType(TextFormField).at(0), 'nuevo@deliveryuy.local');
    await tester.enterText(find.byType(TextFormField).at(1), 'LocalCustomer-2026!');
    await tester.enterText(find.byType(TextFormField).at(2), 'otra-cosa-distinta');
    await tester.tap(_submit('Crear cuenta'));
    await tester.pumpAndSettle();

    expect(find.text('Las contraseñas no coinciden.'), findsOneWidget);
    expect(sent, isEmpty);
  });

  testWidgets('un ingreso aceptado muestra la sesión', (WidgetTester tester) async {
    await tester.pumpWidget(
      _appOver(
        _apiOver(
          (_) async => http.Response(
            jsonEncode(<String, Object?>{
              'data': <String, Object?>{
                'user': _wireUser(),
                'tokens': _wireTokens(),
              },
            }),
            200,
            headers: <String, String>{'content-type': 'application/json'},
          ),
        ),
      ),
    );

    await fillCredentials(tester);

    expect(find.text('Sesión iniciada'), findsOneWidget);
    expect(find.text('customer@deliveryuy.local'), findsOneWidget);
    expect(find.text('CUSTOMER'), findsOneWidget);
    // The credential itself must never reach the screen.
    expect(find.text('header.payload.signature'), findsNothing);
  });

  testWidgets('un rechazo del API muestra su mensaje y no abre sesión', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      _appOver(
        _apiOver(
          (_) async => http.Response(
            jsonEncode(<String, Object?>{
              'error': <String, Object?>{
                'code': 'INVALID_CREDENTIALS',
                'message': 'Email or password is not correct.',
                'correlationId': 'c1c1c1c1-0000-4000-8000-000000000004',
              },
            }),
            401,
            headers: <String, String>{'content-type': 'application/json'},
          ),
        ),
      ),
    );

    await fillCredentials(tester);

    expect(find.text('Email or password is not correct.'), findsOneWidget);
    expect(
      find.text('Referencia: c1c1c1c1-0000-4000-8000-000000000004'),
      findsOneWidget,
    );
    expect(find.text('Sesión iniciada'), findsNothing);
    expect(_submit('Ingresar'), findsOneWidget);
  });

  testWidgets('un servidor inalcanzable produce un mensaje de conexión', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      _appOver(
        _apiOver((_) async => throw http.ClientException('connection refused')),
      ),
    );

    await fillCredentials(tester);

    expect(
      find.textContaining('No pudimos conectar con el servidor'),
      findsOneWidget,
    );
    expect(find.text('Sesión iniciada'), findsNothing);
  });

  testWidgets('cerrar sesión vuelve al formulario', (WidgetTester tester) async {
    await tester.pumpWidget(
      _appOver(
        _apiOver((http.Request request) async {
          if (request.url.path.endsWith('/auth/logout')) {
            return http.Response('', 204);
          }

          return http.Response(
            jsonEncode(<String, Object?>{
              'data': <String, Object?>{
                'user': _wireUser(),
                'tokens': _wireTokens(),
              },
            }),
            200,
            headers: <String, String>{'content-type': 'application/json'},
          );
        }),
      ),
    );

    await fillCredentials(tester);
    expect(find.text('Sesión iniciada'), findsOneWidget);

    await tester.tap(find.byTooltip('Cerrar sesión'));
    await tester.pumpAndSettle();

    expect(_submit('Ingresar'), findsOneWidget);
    expect(find.text('Sesión iniciada'), findsNothing);
  });

  testWidgets('verificar la sesión consulta la API con el token', (
    WidgetTester tester,
  ) async {
    final List<http.Request> sent = <http.Request>[];
    await tester.pumpWidget(
      _appOver(
        _apiOver((http.Request request) async {
          sent.add(request);

          if (request.url.path.endsWith('/auth/me')) {
            return http.Response(
              jsonEncode(<String, Object?>{'data': _wireUser()}),
              200,
              headers: <String, String>{'content-type': 'application/json'},
            );
          }

          return http.Response(
            jsonEncode(<String, Object?>{
              'data': <String, Object?>{
                'user': _wireUser(),
                'tokens': _wireTokens(),
              },
            }),
            200,
            headers: <String, String>{'content-type': 'application/json'},
          );
        }),
      ),
    );

    await fillCredentials(tester);
    await tester.tap(find.text('Verificar sesión contra la API'));
    await tester.pumpAndSettle();

    expect(find.text('Sesión verificada contra la API'), findsOneWidget);
    expect(sent.last.url.path, '/api/v1/auth/me');
    expect(sent.last.headers['Authorization'], 'Bearer header.payload.signature');
  });

  testWidgets('un registro aceptado abre la sesión', (WidgetTester tester) async {
    final List<http.Request> sent = <http.Request>[];
    await tester.pumpWidget(
      _appOver(
        _apiOver((http.Request request) async {
          sent.add(request);

          return http.Response(
            jsonEncode(<String, Object?>{
              'data': <String, Object?>{
                'user': _wireUser(),
                'tokens': _wireTokens(),
                'verificationRequired': false,
              },
            }),
            200,
            headers: <String, String>{'content-type': 'application/json'},
          );
        }),
      ),
    );

    await openSignUp(tester);
    await fillSignUp(tester);

    expect(find.text('Sesión iniciada'), findsOneWidget);
    expect(sent.single.url.path, '/api/v1/auth/register');
  });

  testWidgets('un registro que exige verificación no promete un correo', (
    WidgetTester tester,
  ) async {
    // The API creates the account but has no configured delivery channel, so
    // the screen must not claim a message was sent: promising one the platform
    // never delivered is exactly the kind of fake the project forbids
    // (AGENTS.md section 5).
    await tester.pumpWidget(
      _appOver(
        _apiOver(
          (_) async => http.Response(
            jsonEncode(<String, Object?>{
              'data': <String, Object?>{
                'user': _wireUser(status: 'PENDING_VERIFICATION'),
                'tokens': null,
                'verificationRequired': true,
              },
            }),
            201,
            headers: <String, String>{'content-type': 'application/json'},
          ),
        ),
      ),
    );

    await openSignUp(tester);
    await fillSignUp(tester);

    expect(find.text('Tu cuenta está pendiente de verificación'), findsOneWidget);
    expect(find.textContaining('customer@deliveryuy.local'), findsOneWidget);
    expect(find.textContaining('enviamos'), findsNothing);
    expect(find.textContaining('revisá tu correo'), findsNothing);
    expect(find.textContaining('te envi'), findsNothing);
    expect(find.text('Sesión iniciada'), findsNothing);
  });

  testWidgets('la pantalla de verificación vuelve al ingreso', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      _appOver(
        _apiOver(
          (_) async => http.Response(
            jsonEncode(<String, Object?>{
              'data': <String, Object?>{
                'user': _wireUser(status: 'PENDING_VERIFICATION'),
                'tokens': null,
                'verificationRequired': true,
              },
            }),
            201,
            headers: <String, String>{'content-type': 'application/json'},
          ),
        ),
      ),
    );

    await openSignUp(tester);
    await fillSignUp(tester);
    await tester.tap(find.text('Ir a ingresar'));
    await tester.pumpAndSettle();

    // Back on the forms, in sign-in mode: the switcher is a new widget because
    // the pending screen replaced it, so it starts from its own default.
    expect(find.text('Tu cuenta está pendiente de verificación'), findsNothing);
    expect(_submit('Ingresar'), findsOneWidget);
  });

  testWidgets('el código verificado devuelve al ingreso', (WidgetTester tester) async {
    final List<http.Request> sent = <http.Request>[];
    await tester.pumpWidget(
      _appOver(
        _apiOver((http.Request request) async {
          sent.add(request);

          if (request.url.path.endsWith('/auth/verify-email')) {
            return http.Response(
              jsonEncode(<String, Object?>{
                'data': <String, Object?>{'verified': true, 'canSignIn': true},
              }),
              200,
              headers: <String, String>{'content-type': 'application/json'},
            );
          }

          return http.Response(
            jsonEncode(<String, Object?>{
              'data': <String, Object?>{
                'user': _wireUser(status: 'PENDING_VERIFICATION'),
                'tokens': null,
                'verificationRequired': true,
              },
            }),
            201,
            headers: <String, String>{'content-type': 'application/json'},
          );
        }),
      ),
    );

    await openSignUp(tester);
    await fillSignUp(tester);
    expect(find.text('Tu cuenta está pendiente de verificación'), findsOneWidget);

    await tester.enterText(find.byType(TextFormField), 'vt_abc123');
    await tester.tap(_submit('Verificar código'));
    await tester.pumpAndSettle();

    expect(sent.last.url.path, '/api/v1/auth/verify-email');
    expect(_submit('Ingresar'), findsOneWidget);
    // The code is not left on the screen for a second, already spent attempt.
    expect(find.text('vt_abc123'), findsNothing);
  });

  testWidgets('un código rechazado deja al usuario donde puede corregirlo', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      _appOver(
        _apiOver((http.Request request) async {
          if (request.url.path.endsWith('/auth/verify-email')) {
            return http.Response(
              jsonEncode(<String, Object?>{
                'error': <String, Object?>{
                  'code': 'TOKEN_INVALID',
                  'message': 'Verification code is invalid or has expired.',
                },
              }),
              401,
              headers: <String, String>{'content-type': 'application/json'},
            );
          }

          return http.Response(
            jsonEncode(<String, Object?>{
              'data': <String, Object?>{
                'user': _wireUser(status: 'PENDING_VERIFICATION'),
                'tokens': null,
                'verificationRequired': true,
              },
            }),
            201,
            headers: <String, String>{'content-type': 'application/json'},
          );
        }),
      ),
    );

    await openSignUp(tester);
    await fillSignUp(tester);
    await tester.enterText(find.byType(TextFormField), 'vt_mal');
    await tester.tap(_submit('Verificar código'));
    await tester.pumpAndSettle();

    // A wrong guess is not a lost session: the code field is still there.
    expect(find.text('Tu cuenta está pendiente de verificación'), findsOneWidget);
    expect(find.text('Verification code is invalid or has expired.'), findsOneWidget);
    expect(_submit('Verificar código'), findsOneWidget);
  });

  testWidgets('verificado pero sin aprobación no promete ingreso', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      _appOver(
        _apiOver((http.Request request) async {
          if (request.url.path.endsWith('/auth/verify-email')) {
            return http.Response(
              jsonEncode(<String, Object?>{
                'data': <String, Object?>{'verified': true, 'canSignIn': false},
              }),
              200,
              headers: <String, String>{'content-type': 'application/json'},
            );
          }

          return http.Response(
            jsonEncode(<String, Object?>{
              'data': <String, Object?>{
                'user': _wireUser(status: 'PENDING_VERIFICATION'),
                'tokens': null,
                'verificationRequired': true,
              },
            }),
            201,
            headers: <String, String>{'content-type': 'application/json'},
          );
        }),
      ),
    );

    await openSignUp(tester);
    await fillSignUp(tester);
    await tester.enterText(find.byType(TextFormField), 'vt_abc123');
    await tester.tap(_submit('Verificar código'));
    await tester.pumpAndSettle();

    expect(find.text('Tu correo quedó verificado'), findsOneWidget);
    expect(find.textContaining('espera una aprobación'), findsOneWidget);
    // The code is spent; asking again would only earn another refusal.
    expect(_submit('Verificar código'), findsNothing);
    expect(find.byType(TextFormField), findsNothing);
  });

  testWidgets('no envía nada si el código está vacío', (WidgetTester tester) async {
    final List<http.Request> sent = <http.Request>[];
    await tester.pumpWidget(
      _appOver(
        _apiOver((http.Request request) async {
          sent.add(request);

          return http.Response(
            jsonEncode(<String, Object?>{
              'data': <String, Object?>{
                'user': _wireUser(status: 'PENDING_VERIFICATION'),
                'tokens': null,
                'verificationRequired': true,
              },
            }),
            201,
            headers: <String, String>{'content-type': 'application/json'},
          );
        }),
      ),
    );

    await openSignUp(tester);
    await fillSignUp(tester);
    final int before = sent.length;
    await tester.tap(_submit('Verificar código'));
    await tester.pumpAndSettle();

    expect(find.text('Ingresá el código del mensaje.'), findsOneWidget);
    expect(sent, hasLength(before));
  });

  testWidgets('un registro rechazado muestra los motivos del API', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      _appOver(
        _apiOver(
          (_) async => http.Response(
            jsonEncode(<String, Object?>{
              'error': <String, Object?>{
                'code': 'VALIDATION_FAILED',
                'message': 'Password does not meet the requirements.',
                'details': <String, Object?>{
                  'reasons': <String>[
                    'Password must contain at least 10 characters.',
                  ],
                },
              },
            }),
            400,
            headers: <String, String>{'content-type': 'application/json'},
          ),
        ),
      ),
    );

    await openSignUp(tester);
    await fillSignUp(tester);

    expect(find.text('Password does not meet the requirements.'), findsOneWidget);
    expect(
      find.text('• Password must contain at least 10 characters.'),
      findsOneWidget,
    );
    expect(find.text('Sesión iniciada'), findsNothing);
  });
}