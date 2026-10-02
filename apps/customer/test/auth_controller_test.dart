import 'dart:async';
import 'dart:convert';

import 'package:deliveryuy_core/deliveryuy_core.dart';
import 'package:deliveryuy_customer/src/auth_controller.dart';
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

Map<String, Object?> _wireTokens({String refreshToken = 'rt_1'}) {
  return <String, Object?>{
    'accessToken': 'header.payload.signature',
    'refreshToken': refreshToken,
    'tokenType': 'Bearer',
    'expiresIn': 899,
    'accessTokenExpiresAt': '2026-01-05T12:15:00.000Z',
  };
}

void main() {
  late List<http.Request> sent;

  setUp(() {
    sent = <http.Request>[];
  });

  AuthController controllerOver(
    Future<http.Response> Function(http.Request request) handler,
  ) {
    return AuthController(
      authApi: AuthApi(
        ApiClient(
          config: _config,
          httpClient: MockClient((http.Request request) {
            sent.add(request);

            return handler(request);
          }),
        ),
      ),
      config: _config,
    );
  }

  AuthController answeringWith(Object? data, {int status = 200}) {
    return controllerOver(
      (_) async => http.Response(
        jsonEncode(<String, Object?>{'data': data}),
        status,
        headers: <String, String>{'content-type': 'application/json'},
      ),
    );
  }

  group('signIn', () {
    test('opens a session and keeps the token in memory only', () async {
      final AuthController controller = answeringWith(<String, Object?>{
        'user': _wireUser(),
        'tokens': _wireTokens(),
      });

      await controller.signIn(email: 'customer@deliveryuy.local', password: 'secret');

      expect(controller.status, AuthStatus.signedIn);
      expect(controller.session!.user.email, 'customer@deliveryuy.local');
      expect(controller.accessToken, 'header.payload.signature');
      expect(controller.failureKind, isNull);
    });

    test('trims the address before sending it', () async {
      final AuthController controller = answeringWith(<String, Object?>{
        'user': _wireUser(),
        'tokens': _wireTokens(),
      });

      await controller.signIn(email: '  customer@deliveryuy.local  ', password: 'secret');

      expect(
        (jsonDecode(sent.single.body) as Map<String, Object?>)['email'],
        'customer@deliveryuy.local',
      );
    });

    test('reports a rejected sign-in with the code the API sent', () async {
      final AuthController controller = controllerOver(
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
      );

      await controller.signIn(email: 'customer@deliveryuy.local', password: 'wrong');

      expect(controller.status, AuthStatus.signedOut);
      expect(controller.failureKind, AuthFailureKind.rejected);
      expect(controller.failureCode, 'INVALID_CREDENTIALS');
      expect(controller.failureMessage, 'Email or password is not correct.');
      expect(controller.failureCorrelationId, 'c1c1c1c1-0000-4000-8000-000000000004');
      expect(controller.session, isNull);
    });

    test('tells an unreachable server apart from a rejected one', () async {
      final AuthController controller = controllerOver(
        (_) async => throw http.ClientException('connection refused'),
      );

      await controller.signIn(email: 'customer@deliveryuy.local', password: 'secret');

      expect(controller.failureKind, AuthFailureKind.unreachable);
      expect(controller.failureCode, 'API_UNREACHABLE');
      expect(controller.failureMessage, isNull);
    });

    test('ignores a second tap while a sign-in is in flight', () async {
      // Double taps are common on flaky mobile data; two concurrent sign-ins
      // would open two sessions (AGENTS.md section 43).
      final Completer<void> gate = Completer<void>();
      final AuthController controller = controllerOver((_) async {
        await gate.future;

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
      });

      final Future<void> first = controller.signIn(
        email: 'customer@deliveryuy.local',
        password: 'secret',
      );
      await controller.signIn(email: 'customer@deliveryuy.local', password: 'secret');

      gate.complete();
      await first;

      expect(sent, hasLength(1));
      expect(controller.status, AuthStatus.signedIn);
    });

    test('clears the previous failure when a retry starts', () async {
      AuthController controller = controllerOver(
        (_) async => http.Response(
          jsonEncode(<String, Object?>{
            'error': <String, Object?>{
              'code': 'INVALID_CREDENTIALS',
              'message': 'Email or password is not correct.',
            },
          }),
          401,
          headers: <String, String>{'content-type': 'application/json'},
        ),
      );

      await controller.signIn(email: 'customer@deliveryuy.local', password: 'wrong');
      expect(controller.failureKind, AuthFailureKind.rejected);

      controller = answeringWith(<String, Object?>{
        'user': _wireUser(),
        'tokens': _wireTokens(),
      });
      await controller.signIn(email: 'customer@deliveryuy.local', password: 'secret');

      expect(controller.failureKind, isNull);
      expect(controller.failureCode, isNull);
    });
  });

  group('loadAccount', () {
    test('reads the account behind the current access token', () async {
      final AuthController controller = controllerOver((http.Request request) async {
        if (request.url.path.endsWith('/auth/login')) {
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
        }

        return http.Response(
          jsonEncode(<String, Object?>{'data': _wireUser()}),
          200,
          headers: <String, String>{'content-type': 'application/json'},
        );
      });

      await controller.signIn(email: 'customer@deliveryuy.local', password: 'secret');
      final AuthUser? account = await controller.loadAccount();

      expect(account!.id, '3f0b3f2c-6f1a-4a0d-9f6a-3a1c9a0d2b11');
      expect(sent.last.headers['Authorization'], 'Bearer header.payload.signature');
    });

    test('does nothing when no session is open', () async {
      final AuthController controller = answeringWith(null);

      expect(await controller.loadAccount(), isNull);
      expect(sent, isEmpty);
    });

    test('surfaces an expired token as a rejected failure', () async {
      final AuthController controller = controllerOver((http.Request request) async {
        if (request.url.path.endsWith('/auth/login')) {
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
        }

        return http.Response(
          jsonEncode(<String, Object?>{
            'error': <String, Object?>{
              'code': 'UNAUTHENTICATED',
              'message': 'The access token is missing or no longer valid.',
            },
          }),
          401,
          headers: <String, String>{'content-type': 'application/json'},
        );
      });

      await controller.signIn(email: 'customer@deliveryuy.local', password: 'secret');
      final AuthUser? account = await controller.loadAccount();

      expect(account, isNull);
      expect(controller.failureCode, 'UNAUTHENTICATED');
    });
  });

  group('signOut', () {
    test('revokes the refresh token and drops the session', () async {
      final AuthController controller = controllerOver((http.Request request) async {
        if (request.url.path.endsWith('/auth/login')) {
          return http.Response(
            jsonEncode(<String, Object?>{
              'data': <String, Object?>{
                'user': _wireUser(),
                'tokens': _wireTokens(refreshToken: 'rt_live'),
              },
            }),
            200,
            headers: <String, String>{'content-type': 'application/json'},
          );
        }

        return http.Response('', 204);
      });

      await controller.signIn(email: 'customer@deliveryuy.local', password: 'secret');
      await controller.signOut();

      expect(controller.status, AuthStatus.signedOut);
      expect(controller.session, isNull);
      expect(
        jsonDecode(sent.last.body),
        <String, Object?>{'refreshToken': 'rt_live'},
      );
    });

    test('drops the session even when revocation fails', () async {
      // The user asked to be signed out. Telling them the logout failed while
      // the interface still shows the account would be the wrong answer.
      final AuthController controller = controllerOver((http.Request request) async {
        if (request.url.path.endsWith('/auth/login')) {
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
        }

        throw http.ClientException('connection refused');
      });

      await controller.signIn(email: 'customer@deliveryuy.local', password: 'secret');
      await controller.signOut();

      expect(controller.status, AuthStatus.signedOut);
      expect(controller.session, isNull);
      expect(controller.failureKind, isNull);
    });

    test('does not call the API when there is no session', () async {
      final AuthController controller = answeringWith(null);

      await controller.signOut();

      expect(sent, isEmpty);
    });
  });
}