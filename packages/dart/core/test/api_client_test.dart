import 'dart:async';
import 'dart:convert';

import 'package:deliveryuy_core/deliveryuy_core.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Wraps a `MockClient` so a test can assert on what was actually sent, not
/// only on the answer it got back.
class _Recorder {
  _Recorder(this.responder);

  final Future<http.Response> Function(http.Request request) responder;
  final List<http.Request> requests = <http.Request>[];

  http.Client get client => MockClient((http.Request request) {
    requests.add(request);

    return responder(request);
  });
}

const AppConfig _config = AppConfig(
  apiBaseUrl: 'http://localhost:3000/api/v1',
  apiTimeout: Duration(seconds: 5),
);

http.Response _jsonResponse(Object? body, {int status = 200}) {
  return http.Response(
    jsonEncode(body),
    status,
    headers: <String, String>{'content-type': 'application/json'},
  );
}

void main() {
  group('ApiClient requests', () {
    test('never produces a double slash when the path has no leading one', () async {
      final _Recorder recorder = _Recorder(
        (_) async => _jsonResponse(<String, Object?>{'data': true}),
      );
      final ApiClient client = ApiClient(config: _config, httpClient: recorder.client);

      await client.post('auth/login', body: <String, String>{'email': 'a@b.c'});

      expect(
        recorder.requests.single.url.toString(),
        'http://localhost:3000/api/v1/auth/login',
      );
    });

    test('keeps a trailing slash on the configured base from doubling up', () async {
      final _Recorder recorder = _Recorder(
        (_) async => _jsonResponse(<String, Object?>{'data': null}),
      );
      final ApiClient client = ApiClient(
        config: const AppConfig(
          apiBaseUrl: 'http://localhost:3000/api/v1/',
          apiTimeout: Duration(seconds: 5),
        ),
        httpClient: recorder.client,
      );

      await client.get('/auth/me', accessToken: 'token-value');

      expect(
        recorder.requests.single.url.toString(),
        'http://localhost:3000/api/v1/auth/me',
      );
    });

    test('adds the bearer header only when a token is supplied', () async {
      final _Recorder recorder = _Recorder(
        (_) async => _jsonResponse(<String, Object?>{'data': null}),
      );
      final ApiClient client = ApiClient(config: _config, httpClient: recorder.client);

      await client.get('/auth/me');
      await client.get('/auth/me', accessToken: 'secret-token');

      expect(recorder.requests.first.headers.containsKey('Authorization'), isFalse);
      expect(recorder.requests.last.headers['Authorization'], 'Bearer secret-token');
    });

    test('appends query parameters without losing the api prefix', () async {
      final _Recorder recorder = _Recorder(
        (_) async => _jsonResponse(<String, Object?>{
          'data': <Object?>[],
        }),
      );
      final ApiClient client = ApiClient(config: _config, httpClient: recorder.client);

      await client.get('/merchants', query: <String, String>{'city': 'Rivera'});

      expect(
        recorder.requests.single.url.toString(),
        'http://localhost:3000/api/v1/merchants?city=Rivera',
      );
    });

    test('sends the posted body as json', () async {
      final _Recorder recorder = _Recorder(
        (_) async => _jsonResponse(<String, Object?>{'data': null}),
      );
      final ApiClient client = ApiClient(config: _config, httpClient: recorder.client);

      await client.post(
        '/auth/login',
        body: <String, String>{'email': 'a@b.c', 'password': 'secret'},
      );

      expect(recorder.requests.single.headers['Content-Type'], 'application/json');
      expect(
        jsonDecode(recorder.requests.single.body),
        <String, Object?>{'email': 'a@b.c', 'password': 'secret'},
      );
    });
  });

  group('ApiClient responses', () {
    test('returns the data member of a success envelope', () async {
      final ApiClient client = ApiClient(
        config: _config,
        httpClient: MockClient(
          (_) async => _jsonResponse(<String, Object?>{
            'data': <String, Object?>{'id': 'user-1'},
          }),
        ),
      );

      final Object? data = await client.get('/auth/me', accessToken: 't');

      expect((data! as Map<String, Object?>)['id'], 'user-1');
    });

    test('raises a failure carrying the code and the correlation id', () async {
      final ApiClient client = ApiClient(
        config: _config,
        httpClient: MockClient(
          (_) async => _jsonResponse(
            <String, Object?>{
              'error': <String, Object?>{
                'code': 'INVALID_CREDENTIALS',
                'message': 'Email or password is not correct.',
                'correlationId': 'c1c1c1c1-0000-4000-8000-000000000009',
              },
            },
            status: 401,
          ),
        ),
      );

      await expectLater(
        client.post('/auth/login', body: const <String, String>{}),
        throwsA(
          isA<ApiFailureException>()
              .having((ApiFailureException e) => e.code, 'code', 'INVALID_CREDENTIALS')
              .having((ApiFailureException e) => e.statusCode, 'statusCode', 401)
              .having(
                (ApiFailureException e) => e.correlationId,
                'correlationId',
                'c1c1c1c1-0000-4000-8000-000000000009',
              ),
        ),
      );
    });

    test('reads an empty 2xx body as a success with no payload', () async {
      // POST /auth/logout answers 204 with no body; calling that unreadable
      // would report a successful logout as a failure.
      final ApiClient client = ApiClient(
        config: _config,
        httpClient: MockClient((_) async => http.Response('', 204)),
      );

      expect(await client.post('/auth/logout', body: const <String, String>{}), isNull);
    });

    test('reads an empty failure body as a failure', () async {
      final ApiClient client = ApiClient(
        config: _config,
        httpClient: MockClient((_) async => http.Response('', 502)),
      );

      await expectLater(
        client.post('/auth/logout', body: const <String, String>{}),
        throwsA(
          isA<ApiFailureException>().having(
            (ApiFailureException e) => e.code,
            'code',
            'UNREADABLE_RESPONSE',
          ),
        ),
      );
    });

    test('treats an unreadable body as a failure instead of an empty answer', () async {
      // A proxy error page must never be read as a successful empty response.
      final ApiClient client = ApiClient(
        config: _config,
        httpClient: MockClient(
          (_) async => http.Response(
            '<html>gateway timeout</html>',
            504,
            headers: <String, String>{'content-type': 'text/html'},
          ),
        ),
      );

      await expectLater(
        client.get('/auth/me', accessToken: 't'),
        throwsA(
          isA<ApiFailureException>().having(
            (ApiFailureException e) => e.code,
            'code',
            'UNREADABLE_RESPONSE',
          ),
        ),
      );
    });

    test('treats a JSON body that is not an envelope as a failure', () async {
      final ApiClient client = ApiClient(
        config: _config,
        httpClient: MockClient(
          (_) async => http.Response(
            '"just a string"',
            200,
            headers: <String, String>{'content-type': 'application/json'},
          ),
        ),
      );

      await expectLater(
        client.get('/auth/me', accessToken: 't'),
        throwsA(
          isA<ApiFailureException>().having(
            (ApiFailureException e) => e.code,
            'code',
            'UNEXPECTED_RESPONSE',
          ),
        ),
      );
    });

    test('treats an envelope missing its mandatory members as a failure', () async {
      final ApiClient client = ApiClient(
        config: _config,
        httpClient: MockClient(
          (_) async => _jsonResponse(
            <String, Object?>{
              'error': <String, Object?>{'code': 'ONLY_CODE'},
            },
            status: 400,
          ),
        ),
      );

      await expectLater(
        client.get('/auth/me', accessToken: 't'),
        throwsA(
          isA<ApiFailureException>().having(
            (ApiFailureException e) => e.code,
            'code',
            'UNEXPECTED_RESPONSE',
          ),
        ),
      );
    });
  });

  group('ApiClient transport failures', () {
    test('reports an unreachable server as a transport failure', () async {
      // Kept apart from ApiFailureException on purpose: the remedy is
      // connectivity, not different input (AGENTS.md section 43).
      final ApiClient client = ApiClient(
        config: _config,
        httpClient: MockClient(
          (_) async => throw http.ClientException('connection refused'),
        ),
      );

      await expectLater(
        client.get('/auth/me', accessToken: 't'),
        throwsA(isA<ApiTransportException>()),
      );
    });

    test('gives up on a request that outlives the configured timeout', () async {
      final ApiClient client = ApiClient(
        config: const AppConfig(
          apiBaseUrl: 'http://localhost:3000/api/v1',
          apiTimeout: Duration(milliseconds: 40),
        ),
        httpClient: MockClient((_) => Completer<http.Response>().future),
      );

      await expectLater(
        client.get('/auth/me', accessToken: 't'),
        throwsA(isA<ApiTransportException>()),
      );
    });

    test('does not close a client it did not create', () async {
      // The injected client belongs to the caller and may be reused.
      final http.Client injected = MockClient(
        (_) async => _jsonResponse(<String, Object?>{'data': null}),
      );
      final ApiClient client = ApiClient(config: _config, httpClient: injected);

      client.close();

      // Still usable: a closed client would fail here.
      await expectLater(client.get('/auth/me', accessToken: 't'), completes);
    });
  });
}