import 'dart:convert';

import 'package:deliveryuy_core/deliveryuy_core.dart';
import 'package:deliveryuy_customer/src/auth_controller.dart';
import 'package:deliveryuy_customer/src/customer_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const AppConfig _config = AppConfig(
  apiBaseUrl: 'http://localhost:3000/api/v1',
  apiTimeout: Duration(seconds: 5),
);

Map<String, Object?> _wireUser() {
  return <String, Object?>{
    'id': '3f0b3f2c-6f1a-4a0d-9f6a-3a1c9a0d2b11',
    'email': 'customer@deliveryuy.local',
    'status': 'ACTIVE',
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
    controller: AuthController(authApi: authApi, config: _config),
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

void main() {
  Future<void> fillCredentials(WidgetTester tester) async {
    await tester.enterText(find.byType(TextFormField).at(0), 'customer@deliveryuy.local');
    await tester.enterText(find.byType(TextFormField).at(1), 'LocalCustomer-2026!');
    await tester.tap(find.text('Ingresar'));
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
    expect(find.text('Ingresar'), findsOneWidget);
    expect(find.textContaining('/api/v1'), findsOneWidget);
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
    await tester.tap(find.text('Ingresar'));
    await tester.pumpAndSettle();

    expect(find.text('Ingresa tu correo electrónico.'), findsOneWidget);
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
    expect(find.text('Ingresar'), findsOneWidget);
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

    expect(find.text('Ingresar'), findsOneWidget);
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
}