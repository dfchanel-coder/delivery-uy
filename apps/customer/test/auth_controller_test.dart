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

  group('register', () {
    test('opens a session when the API issues credentials', () async {
      final AuthController controller = answeringWith(<String, Object?>{
        'user': _wireUser(),
        'tokens': _wireTokens(),
        'verificationRequired': false,
      });

      await controller.register(
        email: 'new@deliveryuy.local',
        password: 'a-long-enough-one',
      );

      expect(controller.status, AuthStatus.signedIn);
      expect(controller.session!.user.email, 'customer@deliveryuy.local');
      expect(controller.accessToken, isNotNull);
      expect(controller.pendingVerificationEmail, isNull);
    });

    test('sends only the address and the secret, never a role', () async {
      // Self registration cannot pick a role: the API rejects the field, and a
      // client that offered the choice would invite an escalation attempt
      // (AGENTS.md section 8).
      final AuthController controller = answeringWith(<String, Object?>{
        'user': _wireUser(),
        'tokens': _wireTokens(),
        'verificationRequired': false,
      });

      await controller.register(email: '  new@deliveryuy.local  ', password: 'secret');

      expect(jsonDecode(sent.single.body), <String, Object?>{
        'email': 'new@deliveryuy.local',
        'password': 'secret',
      });
    });

    test('waits for verification when the API issues no credentials', () async {
      // Not a failed sign-up: the account exists, it just cannot sign in yet.
      // Treating this as an error would push the user into creating a second
      // account for the same address.
      final AuthController controller = answeringWith(<String, Object?>{
        'user': _wireUser(status: 'PENDING_VERIFICATION'),
        'tokens': null,
        'verificationRequired': true,
      });

      await controller.register(
        email: 'new@deliveryuy.local',
        password: 'a-long-enough-one',
      );

      expect(controller.status, AuthStatus.awaitingVerification);
      expect(controller.pendingVerificationEmail, 'customer@deliveryuy.local');
      expect(controller.session, isNull);
      expect(controller.accessToken, isNull);
      expect(controller.failureKind, isNull);
    });

    test('keeps the reasons the API gave for a rejected password', () async {
      // The password policy lives in server configuration, so the interface
      // repeats what the API said instead of inventing a local rule that could
      // disagree with it.
      final AuthController controller = controllerOver(
        (_) async => http.Response(
          jsonEncode(<String, Object?>{
            'error': <String, Object?>{
              'code': 'VALIDATION_FAILED',
              'message': 'Password does not meet the requirements.',
              'details': <String, Object?>{
                'reasons': <String>['Password must contain at least 10 characters.'],
              },
            },
          }),
          400,
          headers: <String, String>{'content-type': 'application/json'},
        ),
      );

      await controller.register(email: 'new@deliveryuy.local', password: 'short');

      expect(controller.status, AuthStatus.signedOut);
      expect(controller.failureKind, AuthFailureKind.rejected);
      expect(controller.failureCode, 'VALIDATION_FAILED');
      expect(controller.failureDetails?['reasons'], <String>[
        'Password must contain at least 10 characters.',
      ]);
    });

    test('reports an address that is already registered without exposing it', () async {
      final AuthController controller = controllerOver(
        (_) async => http.Response(
          jsonEncode(<String, Object?>{
            'error': <String, Object?>{
              'code': 'EMAIL_ALREADY_REGISTERED',
              'message': 'That email address cannot be registered.',
            },
          }),
          409,
          headers: <String, String>{'content-type': 'application/json'},
        ),
      );

      await controller.register(
        email: 'customer@deliveryuy.local',
        password: 'a-long-enough-one',
      );

      expect(controller.status, AuthStatus.signedOut);
      expect(controller.failureCode, 'EMAIL_ALREADY_REGISTERED');
      expect(controller.pendingVerificationEmail, isNull);
    });

    test('ignores a second tap while a registration is in flight', () async {
      final Completer<void> gate = Completer<void>();
      final AuthController controller = controllerOver((_) async {
        await gate.future;

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
      });

      final Future<void> first = controller.register(
        email: 'new@deliveryuy.local',
        password: 'a-long-enough-one',
      );
      await controller.register(
        email: 'other@deliveryuy.local',
        password: 'a-long-enough-one',
      );

      gate.complete();
      await first;

      expect(sent, hasLength(1));
      expect(controller.status, AuthStatus.signedIn);
    });
  });

  group('dismissVerificationNotice', () {
    test('returns to the sign-in form and forgets the address', () async {
      final AuthController controller = answeringWith(<String, Object?>{
        'user': _wireUser(status: 'PENDING_VERIFICATION'),
        'tokens': null,
        'verificationRequired': true,
      });

      await controller.register(
        email: 'new@deliveryuy.local',
        password: 'a-long-enough-one',
      );
      controller.dismissVerificationNotice();

      expect(controller.status, AuthStatus.signedOut);
      expect(controller.pendingVerificationEmail, isNull);
    });

    test('does nothing while the account is signed in', () async {
      // The notice is not a way out of a live session.
      final AuthController controller = answeringWith(<String, Object?>{
        'user': _wireUser(),
        'tokens': _wireTokens(),
        'verificationRequired': false,
      });

      await controller.signIn(email: 'customer@deliveryuy.local', password: 'secret');
      controller.dismissVerificationNotice();

      expect(controller.status, AuthStatus.signedIn);
      expect(controller.session, isNotNull);
    });
  });

  group('clearFailure', () {
    test('forgets the last failure and notifies once', () async {
      final AuthController controller = controllerOver(
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

      int notifications = 0;
      controller.addListener(() => notifications++);

      controller.clearFailure();
      expect(controller.failureKind, isNull);
      expect(notifications, 1);

      controller.clearFailure();
      expect(notifications, 1, reason: 'no change means no notification');
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