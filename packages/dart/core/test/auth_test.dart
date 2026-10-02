import 'dart:convert';

import 'package:deliveryuy_core/deliveryuy_core.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// The payload `GET /auth/me` really returned, recorded during a live call
/// against the running API. Field names here are the contract, not a guess.
const Map<String, Object?> _wireUser = <String, Object?>{
  'id': '0f0b3f2c-6f1a-4a0d-9f6a-3a1c9a0d2b11',
  'email': 'customer@deliveryuy.local',
  'status': 'ACTIVE',
  'roles': <String>['CUSTOMER'],
  'locale': 'es-UY',
  'emailVerifiedAt': null,
  'mustChangePassword': false,
  'createdAt': '2026-01-05T12:00:00.000Z',
};

Map<String, Object?> _wireTokens({String accessToken = 'header.payload.signature'}) {
  return <String, Object?>{
    'accessToken': accessToken,
    'refreshToken': 'rt_4f7c1e9b2a6d8f3e5c0a7b1d9e2f4c6a',
    'tokenType': 'Bearer',
    'expiresIn': 899,
    'accessTokenExpiresAt': '2026-01-05T12:15:00.000Z',
  };
}

http.Response _envelope(Object? body, {int status = 200}) {
  return http.Response(
    jsonEncode(<String, Object?>{'data': body}),
    status,
    headers: <String, String>{'content-type': 'application/json'},
  );
}

void main() {
  group('AuthUser decoding', () {
    test('reads every mandatory member of the wire user', () {
      final AuthUser user = AuthUser.fromJson(_wireUser);

      expect(user.id, '0f0b3f2c-6f1a-4a0d-9f6a-3a1c9a0d2b11');
      expect(user.email, 'customer@deliveryuy.local');
      expect(user.status, 'ACTIVE');
      expect(user.roles, <String>['CUSTOMER']);
      expect(user.locale, 'es-UY');
      expect(user.emailVerifiedAt, isNull);
      expect(user.mustChangePassword, isFalse);
      expect(user.hasRole('CUSTOMER'), isTrue);
      expect(user.hasRole('ADMIN'), isFalse);
    });

    test('ignores members the client does not use yet', () {
      // `createdAt` exists on the wire and is not modelled; an unknown key must
      // not break a client that has no use for it.
      final AuthUser user = AuthUser.fromJson(_wireUser);

      expect(user.email, 'customer@deliveryuy.local');
    });

    test('rejects a payload that is not an object', () {
      expect(
        () => AuthUser.fromJson('customer'),
        throwsA(isA<FormatException>()),
      );
    });

    test('rejects a user without an id', () {
      expect(
        () => AuthUser.fromJson(<String, Object?>{..._wireUser}..['id'] = ''),
        throwsA(isA<FormatException>()),
      );
    });

    test('rejects roles that are not a list of strings', () {
      expect(
        () => AuthUser.fromJson(<String, Object?>{
          ..._wireUser,
          'roles': <Object?>[42],
        }),
        throwsA(isA<FormatException>()),
      );
    });

    test('rejects a mustChangePassword that is not a boolean', () {
      expect(
        () => AuthUser.fromJson(<String, Object?>{
          ..._wireUser,
          'mustChangePassword': 'false',
        }),
        throwsA(isA<FormatException>()),
      );
    });

    test('rejects an emailVerifiedAt that is neither a string nor null', () {
      expect(
        () => AuthUser.fromJson(<String, Object?>{..._wireUser, 'emailVerifiedAt': 0}),
        throwsA(isA<FormatException>()),
      );
    });
  });

  group('AuthTokens decoding', () {
    test('reads the token pair and builds the authorization header', () {
      final AuthTokens tokens = AuthTokens.fromJson(_wireTokens());

      expect(tokens.tokenType, 'Bearer');
      expect(tokens.expiresIn, 899);
      expect(tokens.accessTokenExpiresAt, '2026-01-05T12:15:00.000Z');
      expect(tokens.authorizationHeader, 'Bearer header.payload.signature');
    });

    test('rejects a non integer lifetime', () {
      expect(
        () => AuthTokens.fromJson(<String, Object?>{..._wireTokens(), 'expiresIn': '900'}),
        throwsA(isA<FormatException>()),
      );
    });

    test('rejects a missing refresh token', () {
      final Map<String, Object?> payload = _wireTokens()..remove('refreshToken');

      expect(() => AuthTokens.fromJson(payload), throwsA(isA<FormatException>()));
    });
  });

  group('AuthSession decoding', () {
    test('decodes a login answer', () {
      final AuthSession session = AuthSession.fromJson(<String, Object?>{
        'user': _wireUser,
        'tokens': _wireTokens(),
      });

      expect(session.user.email, 'customer@deliveryuy.local');
      expect(session.tokens.expiresIn, 899);
    });

    test('rejects a login answer without tokens', () {
      // A session without credentials is not something a caller can act on, so
      // it must fail loudly instead of producing nulls it discovers later.
      expect(
        () => AuthSession.fromJson(<String, Object?>{
          'user': _wireUser,
          'tokens': null,
        }),
        throwsA(isA<FormatException>()),
      );
    });
  });

  group('AuthRegistration decoding', () {
    test('opens a session when the deployment issues tokens', () {
      final AuthRegistration registration = AuthRegistration.fromJson(<String, Object?>{
        'user': _wireUser,
        'tokens': _wireTokens(),
        'verificationRequired': false,
      });

      expect(registration.verificationRequired, isFalse);
      expect(registration.tokens, isNotNull);
      expect(registration.session?.tokens.accessToken, 'header.payload.signature');
    });

    test('reports a pending account without inventing credentials', () {
      final AuthRegistration registration = AuthRegistration.fromJson(<String, Object?>{
        'user': <String, Object?>{..._wireUser, 'status': 'PENDING_VERIFICATION'},
        'tokens': null,
        'verificationRequired': true,
      });

      expect(registration.verificationRequired, isTrue);
      expect(registration.tokens, isNull);
      expect(registration.session, isNull);
      expect(registration.user.status, 'PENDING_VERIFICATION');
    });

    test('rejects an answer that omits verificationRequired', () {
      expect(
        () => AuthRegistration.fromJson(<String, Object?>{
          'user': _wireUser,
          'tokens': _wireTokens(),
        }),
        throwsA(isA<FormatException>()),
      );
    });

    test('rejects tokens issued together with a verification demand', () {
      // The API never does this, and accepting it would hand a session to an
      // account the server considers unverified.
      expect(
        () => AuthRegistration.fromJson(<String, Object?>{
          'user': _wireUser,
          'tokens': _wireTokens(),
          'verificationRequired': true,
        }),
        throwsA(isA<FormatException>()),
      );
    });
  });

  group('AuthApi requests', () {
    late List<http.Request> sent;

    setUp(() {
      sent = <http.Request>[];
    });

    AuthApi apiReturning(Object? body, {int status = 200}) {
      return AuthApi(
        ApiClient(
          config: const AppConfig(
            apiBaseUrl: 'http://localhost:3000/api/v1',
            apiTimeout: Duration(seconds: 5),
          ),
          httpClient: MockClient((http.Request request) async {
            sent.add(request);

            return _envelope(body, status: status);
          }),
        ),
      );
    }

    test('login posts the credentials to the versioned path', () async {
      final AuthApi api = apiReturning(<String, Object?>{
        'user': _wireUser,
        'tokens': _wireTokens(),
      });

      await api.login(email: 'customer@deliveryuy.local', password: 'secret');

      expect(sent.single.method, 'POST');
      expect(
        sent.single.url.toString(),
        'http://localhost:3000/api/v1/auth/login',
      );
      expect(
        jsonDecode(sent.single.body),
        <String, Object?>{
          'email': 'customer@deliveryuy.local',
          'password': 'secret',
        },
      );
    });

    test('register never sends a role', () async {
      // Self registration cannot choose a role; sending one would only invite a
      // privilege escalation attempt (AGENTS.md section 8).
      final AuthApi api = apiReturning(<String, Object?>{
        'user': _wireUser,
        'tokens': _wireTokens(),
        'verificationRequired': false,
      });

      await api.register(email: 'new@deliveryuy.local', password: 'secret');

      expect(
        jsonDecode(sent.single.body),
        <String, Object?>{'email': 'new@deliveryuy.local', 'password': 'secret'},
      );
    });

    test('refresh posts the refresh token and returns the rotated pair', () async {
      final AuthApi api = apiReturning(<String, Object?>{
        'user': _wireUser,
        'tokens': _wireTokens(accessToken: 'rotated.token.value'),
      });

      final AuthSession session = await api.refresh('rt_original');

      expect(
        jsonDecode(sent.single.body),
        <String, Object?>{'refreshToken': 'rt_original'},
      );
      expect(session.tokens.accessToken, 'rotated.token.value');
    });

    test('me sends the access token as a bearer credential', () async {
      final AuthApi api = apiReturning(_wireUser);

      final AuthUser user = await api.me('header.payload.signature');

      expect(sent.single.headers['Authorization'], 'Bearer header.payload.signature');
      expect(user.email, 'customer@deliveryuy.local');
    });

    test('logout posts the refresh token and returns nothing', () async {
      final AuthApi api = apiReturning(null);

      await api.logout('rt_original');

      expect(sent.single.url.path, '/api/v1/auth/logout');
      expect(
        jsonDecode(sent.single.body),
        <String, Object?>{'refreshToken': 'rt_original'},
      );
    });

    test('surfaces the API failure code from a rejected login', () async {
      final AuthApi api = AuthApi(
        ApiClient(
          config: const AppConfig(
            apiBaseUrl: 'http://localhost:3000/api/v1',
            apiTimeout: Duration(seconds: 5),
          ),
          httpClient: MockClient(
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
          ),
        ),
      );

      await expectLater(
        api.login(email: 'customer@deliveryuy.local', password: 'wrong'),
        throwsA(
          isA<ApiFailureException>()
              .having((ApiFailureException e) => e.code, 'code', 'INVALID_CREDENTIALS')
              .having((ApiFailureException e) => e.statusCode, 'statusCode', 401),
        ),
      );
    });
  });
}