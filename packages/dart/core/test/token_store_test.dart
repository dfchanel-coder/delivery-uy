import 'package:deliveryuy_core/deliveryuy_core.dart';
import 'package:flutter_test/flutter_test.dart';

const String _api = 'http://localhost:3000/api/v1';
const String _otherApi = 'https://api.deliveryuy.example/api/v1';

void main() {
  late InMemoryTokenStore store;

  setUp(() {
    store = InMemoryTokenStore();
  });

  group('InMemoryTokenStore', () {
    test('reads back what it wrote', () async {
      await store.write(
        const StoredSession(refreshToken: 'rt_1', apiBaseUrl: _api),
      );

      expect((await store.read(_api))?.refreshToken, 'rt_1');
    });

    test('an empty store reads as null', () async {
      expect(await store.read(_api), isNull);
    });

    test('does not hand a token to a different deployment', () async {
      // The whole reason StoredSession carries the origin: secure storage is
      // scoped to the install, not to the deployment.
      await store.write(
        const StoredSession(refreshToken: 'rt_prod', apiBaseUrl: _otherApi),
      );

      expect(await store.read(_api), isNull);
      expect((await store.read(_otherApi))?.refreshToken, 'rt_prod');
    });

    test('clears only the deployment it was asked about', () async {
      await store.write(
        const StoredSession(refreshToken: 'rt_prod', apiBaseUrl: _otherApi),
      );

      await store.clear(_api);

      expect(
        (await store.read(_otherApi))?.refreshToken,
        'rt_prod',
        reason: 'a sign-out against one API must not touch another',
      );
    });

    test('clearing an empty store is not an error', () async {
      await expectLater(store.clear(_api), completes);
    });

    test('writing twice replaces the record', () async {
      await store.write(
        const StoredSession(refreshToken: 'rt_first', apiBaseUrl: _api),
      );
      await store.write(
        const StoredSession(refreshToken: 'rt_second', apiBaseUrl: _api),
      );

      expect((await store.read(_api))?.refreshToken, 'rt_second');
    });

    test('matches compares the origin it was created with', () {
      const StoredSession session = StoredSession(
        refreshToken: 'rt_1',
        apiBaseUrl: _api,
      );

      expect(session.matches(_api), isTrue);
      expect(session.matches(_otherApi), isFalse);
    });
  });
}