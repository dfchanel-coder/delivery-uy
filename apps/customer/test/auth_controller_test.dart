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

Map<String, Object?> _wireTokens({
  String refreshToken = 'rt_1',
  String accessToken = 'header.payload.signature',
  String? expiresAt,
}) {
  return <String, Object?>{
    'accessToken': accessToken,
    'refreshToken': refreshToken,
    'tokenType': 'Bearer',
    'expiresIn': 899,
    // Far future by default so a test only renews when it means to; the tests
    // about expiry pass an explicit past or malformed value.
    'accessTokenExpiresAt': expiresAt ?? '2099-01-05T12:15:00.000Z',
  };
}

void main() {
  late List<http.Request> sent;
  late InMemoryTokenStore store;

  setUp(() {
    sent = <http.Request>[];
    store = InMemoryTokenStore();
  });

  AuthController controllerOver(
    Future<http.Response> Function(http.Request request) handler, {
    TokenStore? tokenStore,
  }) {
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
      tokenStore: tokenStore ?? store,
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

    test('gives up when the renewal is also rejected', () async {
      // The retry is bounded on purpose: a rejected refresh means the token is
      // gone, and looping would turn one expiry into a request storm.
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
      expect(controller.status, AuthStatus.signedOut);
      expect(controller.failureCode, 'UNAUTHENTICATED');

      final List<String> paths = sent
          .map((http.Request request) => request.url.path)
          .toList(growable: false);

      expect(
        paths.where((String path) => path.endsWith('/auth/refresh')),
        hasLength(1),
      );
    });

    test('renews once and retries when the access token had expired', () async {
      // The overwhelmingly common cause of a 401 on a session that was working a
      // minute ago is a 15-minute access token running out. The retry is decided
      // by the rejection, not by the clock, so no expiry is needed here.
      int meCalls = 0;
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

        if (request.url.path.endsWith('/auth/refresh')) {
          return http.Response(
            jsonEncode(<String, Object?>{
              'data': <String, Object?>{
                'user': _wireUser(),
                'tokens': _wireTokens(
                  refreshToken: 'rt_rotated',
                  accessToken: 'rotated.access.signature',
                ),
              },
            }),
            200,
            headers: <String, String>{'content-type': 'application/json'},
          );
        }

        meCalls += 1;

        // The expired token is refused; the rotated one is accepted.
        if (meCalls == 1) {
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
        }

        return http.Response(
          jsonEncode(<String, Object?>{'data': _wireUser()}),
          200,
          headers: <String, String>{'content-type': 'application/json'},
        );
      });

      await controller.signIn(email: 'customer@deliveryuy.local', password: 'secret');
      final AuthUser? account = await controller.loadAccount();

      expect(account, isNotNull);
      expect(controller.status, AuthStatus.signedIn);
      expect(controller.accessToken, 'rotated.access.signature');
      expect(controller.failureKind, isNull);
      expect(meCalls, 2);
    });

    test('does not retry a failure that is not an expired token', () async {
      int refreshCalls = 0;
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

        if (request.url.path.endsWith('/auth/refresh')) {
          refreshCalls += 1;
        }

        return http.Response(
          jsonEncode(<String, Object?>{
            'error': <String, Object?>{
              'code': 'FORBIDDEN',
              'message': 'The account may not do that.',
            },
          }),
          403,
          headers: <String, String>{'content-type': 'application/json'},
        );
      });

      await controller.signIn(email: 'customer@deliveryuy.local', password: 'secret');
      final AuthUser? account = await controller.loadAccount();

      expect(account, isNull);
      expect(controller.failureCode, 'FORBIDDEN');
      expect(refreshCalls, 0, reason: 'renewing would not fix a 403');
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

  group('persistence', () {
    test('stores the refresh token but never the access token', () async {
      final AuthController controller = answeringWith(<String, Object?>{
        'user': _wireUser(),
        'tokens': _wireTokens(refreshToken: 'rt_only_refresh'),
      });

      await controller.signIn(email: 'customer@deliveryuy.local', password: 'secret');

      final StoredSession? stored = await store.read(_config.apiBaseUrl);

      expect(stored, isNotNull);
      expect(stored!.refreshToken, 'rt_only_refresh');
      expect(stored.apiBaseUrl, _config.apiBaseUrl);
      expect(stored.refreshToken, isNot('header.payload.signature'));
    });

    test('a registration that issues a session is persisted too', () async {
      final AuthController controller = answeringWith(<String, Object?>{
        'user': _wireUser(),
        'tokens': _wireTokens(refreshToken: 'rt_from_register'),
        'verificationRequired': false,
      });

      await controller.register(
        email: 'nuevo@deliveryuy.local',
        password: 'a-long-enough-one',
      );

      expect(
        (await store.read(_config.apiBaseUrl))?.refreshToken,
        'rt_from_register',
      );
    });

    test('an account waiting for verification stores nothing', () async {
      // There is no session to persist, and writing a credential for an account
      // that cannot use one would be the wrong shape entirely.
      final AuthController controller = answeringWith(<String, Object?>{
        'user': _wireUser(status: 'PENDING_VERIFICATION'),
        'tokens': null,
        'verificationRequired': true,
      });

      await controller.register(
        email: 'nuevo@deliveryuy.local',
        password: 'a-long-enough-one',
      );

      expect(await store.read(_config.apiBaseUrl), isNull);
    });

    test('signing out removes the stored token even if revocation fails', () async {
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

        throw http.ClientException('connection refused');
      });

      await controller.signIn(email: 'customer@deliveryuy.local', password: 'secret');
      await controller.signOut();

      expect(await store.read(_config.apiBaseUrl), isNull);
    });

    test('a store that cannot be written still leaves the user signed in', () async {
      // Losing the session on restart is an inconvenience; refusing to sign in
      // would be a bug the user cannot do anything about.
      final AuthController controller = controllerOver(
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
        tokenStore: _BrokenTokenStore(),
      );

      await controller.signIn(email: 'customer@deliveryuy.local', password: 'secret');

      expect(controller.status, AuthStatus.signedIn);
      expect(controller.accessToken, isNotNull);
    });
  });

  group('restore', () {
    test('rebuilds the session from the stored refresh token', () async {
      await store.write(
        const StoredSession(
          refreshToken: 'rt_stored',
          apiBaseUrl: 'http://localhost:3000/api/v1',
        ),
      );

      final AuthController controller = controllerOver((http.Request request) async {
        return http.Response(
          jsonEncode(<String, Object?>{
            'data': <String, Object?>{
              'user': _wireUser(),
              'tokens': _wireTokens(refreshToken: 'rt_rotated'),
            },
          }),
          200,
          headers: <String, String>{'content-type': 'application/json'},
        );
      });

      await controller.restore();

      expect(controller.status, AuthStatus.signedIn);
      expect(controller.session!.user.email, 'customer@deliveryuy.local');
      expect(sent.single.url.path, '/api/v1/auth/refresh');
      expect(jsonDecode(sent.single.body), <String, Object?>{
        'refreshToken': 'rt_stored',
      });

      // Rotation consumed the stored token, so the new one has to be what is
      // kept. Keeping the old one would make the next launch fail for good.
      expect((await store.read(_config.apiBaseUrl))?.refreshToken, 'rt_rotated');
    });

    test('sends no request when nothing was stored', () async {
      final AuthController controller = answeringWith(null);

      await controller.restore();

      expect(sent, isEmpty);
      expect(controller.status, AuthStatus.signedOut);
      expect(controller.failureKind, isNull);
    });

    test('a rejected token is discarded and the failure is not shown', () async {
      // Nobody asked for anything at launch, so greeting the user with an error
      // over an untouched sign-in form would be the wrong message.
      await store.write(
        const StoredSession(
          refreshToken: 'rt_revoked',
          apiBaseUrl: 'http://localhost:3000/api/v1',
        ),
      );

      final AuthController controller = controllerOver(
        (_) async => http.Response(
          jsonEncode(<String, Object?>{
            'error': <String, Object?>{
              'code': 'REFRESH_TOKEN_REUSED',
              'message': 'The refresh token was already used.',
            },
          }),
          401,
          headers: <String, String>{'content-type': 'application/json'},
        ),
      );

      await controller.restore();

      expect(controller.status, AuthStatus.signedOut);
      expect(controller.failureKind, isNull);
      expect(await store.read(_config.apiBaseUrl), isNull);
    });

    test('an unreachable server keeps the token for the next attempt', () async {
      // The API was never asked, so it never rejected anything. Clearing the
      // token would sign the user out for a dropped connection.
      await store.write(
        const StoredSession(
          refreshToken: 'rt_still_good',
          apiBaseUrl: 'http://localhost:3000/api/v1',
        ),
      );

      final AuthController controller = controllerOver(
        (_) async => throw http.ClientException('connection refused'),
      );

      await controller.restore();

      expect(controller.status, AuthStatus.signedOut);
      expect(controller.failureKind, isNull);
      expect((await store.read(_config.apiBaseUrl))?.refreshToken, 'rt_still_good');
    });

    test('does not replay a token issued by a different deployment', () async {
      // Secure storage is scoped to the install, not to the deployment, so a
      // laptop build and a production build share one keyspace on one device.
      await store.write(
        const StoredSession(
          refreshToken: 'rt_from_production',
          apiBaseUrl: 'https://api.deliveryuy.example/api/v1',
        ),
      );

      final AuthController controller = answeringWith(null);

      await controller.restore();

      expect(sent, isEmpty);
      expect(controller.status, AuthStatus.signedOut);
    });

    test('runs once and never over an open session', () async {
      final Completer<void> gate = Completer<void>();
      await store.write(
        const StoredSession(
          refreshToken: 'rt_stored',
          apiBaseUrl: 'http://localhost:3000/api/v1',
        ),
      );

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

      final Future<void> first = controller.restore();
      final Future<void> second = controller.restore();

      gate.complete();
      await Future.wait(<Future<void>>[first, second]);

      expect(sent, hasLength(1));
      expect(controller.status, AuthStatus.signedIn);

      await controller.restore();

      expect(sent, hasLength(1), reason: 'a session is already open');
    });

    test('a store that cannot be read leaves the application signed out', () async {
      final AuthController controller = controllerOver(
        (_) async => http.Response('', 500),
        tokenStore: _BrokenTokenStore(),
      );

      await controller.restore();

      expect(controller.status, AuthStatus.signedOut);
      expect(sent, isEmpty);
    });
  });

  group('ensureFreshSession', () {
    test('leaves a token with margin alone', () async {
      final AuthController controller = answeringWith(<String, Object?>{
        'user': _wireUser(),
        'tokens': _wireTokens(),
      });

      await controller.signIn(email: 'customer@deliveryuy.local', password: 'secret');
      sent.clear();

      expect(await controller.ensureFreshSession(), isTrue);
      expect(sent, isEmpty, reason: 'renewing early would spend a rotated token');
      expect(controller.accessToken, 'header.payload.signature');
    });

    test('renews a token that is inside the leeway', () async {
      final AuthController controller = controllerOver((http.Request request) async {
        if (request.url.path.endsWith('/auth/login')) {
          return http.Response(
            jsonEncode(<String, Object?>{
              'data': <String, Object?>{
                'user': _wireUser(),
                'tokens': _wireTokens(expiresAt: '2026-01-05T12:15:00.000Z'),
              },
            }),
            200,
            headers: <String, String>{'content-type': 'application/json'},
          );
        }

        return http.Response(
          jsonEncode(<String, Object?>{
            'data': <String, Object?>{
              'user': _wireUser(),
              'tokens': _wireTokens(
                refreshToken: 'rt_renewed',
                accessToken: 'renewed.access.signature',
              ),
            },
          }),
          200,
          headers: <String, String>{'content-type': 'application/json'},
        );
      });

      await controller.signIn(email: 'customer@deliveryuy.local', password: 'secret');
      sent.clear();

      expect(await controller.ensureFreshSession(), isTrue);
      expect(sent.single.url.path, '/api/v1/auth/refresh');
      expect(controller.accessToken, 'renewed.access.signature');
      expect((await store.read(_config.apiBaseUrl))?.refreshToken, 'rt_renewed');
    });

    test('treats an unreadable expiry as expired', () async {
      // Renewing unnecessarily costs one request. Trusting a value that cannot be
      // read would send a credential that is already dead.
      final AuthController controller = controllerOver((http.Request request) async {
        if (request.url.path.endsWith('/auth/login')) {
          return http.Response(
            jsonEncode(<String, Object?>{
              'data': <String, Object?>{
                'user': _wireUser(),
                'tokens': _wireTokens(expiresAt: 'not-a-timestamp'),
              },
            }),
            200,
            headers: <String, String>{'content-type': 'application/json'},
          );
        }

        return http.Response(
          jsonEncode(<String, Object?>{
            'data': <String, Object?>{
              'user': _wireUser(),
              'tokens': _wireTokens(accessToken: 'renewed.access.signature'),
            },
          }),
          200,
          headers: <String, String>{'content-type': 'application/json'},
        );
      });

      await controller.signIn(email: 'customer@deliveryuy.local', password: 'secret');
      sent.clear();

      expect(await controller.ensureFreshSession(), isTrue);
      expect(sent.single.url.path, '/api/v1/auth/refresh');
    });

    test('reports false and signs out when the renewal is rejected', () async {
      final AuthController controller = controllerOver((http.Request request) async {
        if (request.url.path.endsWith('/auth/login')) {
          return http.Response(
            jsonEncode(<String, Object?>{
              'data': <String, Object?>{
                'user': _wireUser(),
                'tokens': _wireTokens(expiresAt: '2026-01-05T12:15:00.000Z'),
              },
            }),
            200,
            headers: <String, String>{'content-type': 'application/json'},
          );
        }

        return http.Response(
          jsonEncode(<String, Object?>{
            'error': <String, Object?>{
              'code': 'REFRESH_TOKEN_REUSED',
              'message': 'The refresh token was already used.',
            },
          }),
          401,
          headers: <String, String>{'content-type': 'application/json'},
        );
      });

      await controller.signIn(email: 'customer@deliveryuy.local', password: 'secret');

      expect(await controller.ensureFreshSession(), isFalse);
      expect(controller.status, AuthStatus.signedOut);
      expect(controller.failureCode, 'REFRESH_TOKEN_REUSED');
      expect(await store.read(_config.apiBaseUrl), isNull);
    });

    test('reports false when no session is open', () async {
      final AuthController controller = answeringWith(null);

      expect(await controller.ensureFreshSession(), isFalse);
      expect(sent, isEmpty);
    });
  });
}

/// Store whose every operation fails, standing in for an unreachable keystore.
class _BrokenTokenStore implements TokenStore {
  @override
  Future<StoredSession?> read(String apiBaseUrl) async => throw StateError('no storage');

  @override
  Future<void> write(StoredSession session) async => throw StateError('no storage');

  @override
  Future<void> clear(String apiBaseUrl) async => throw StateError('no storage');
}