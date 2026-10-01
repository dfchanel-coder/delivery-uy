import 'package:deliveryuy_core/deliveryuy_core.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('AppConfig.fromMap', () {
    test('falls back to the documented defaults', () {
      final AppConfig config = AppConfig.fromMap(const <String, String>{});

      expect(config.apiBaseUrl, defaultApiBaseUrl);
      expect(config.apiTimeout, const Duration(seconds: 10));
    });

    test('accepts an https origin and keeps the api prefix', () {
      final AppConfig config = AppConfig.fromMap(const <String, String>{
        'API_BASE_URL': 'https://api.deliveryuy.uy/api/v1',
      });

      expect(config.apiBaseUrl, 'https://api.deliveryuy.uy/api/v1');
    });

    test('removes a trailing slash so paths never double it', () {
      final AppConfig config = AppConfig.fromMap(const <String, String>{
        'API_BASE_URL': 'https://api.deliveryuy.uy/api/v1/',
      });

      expect(config.apiBaseUrl, 'https://api.deliveryuy.uy/api/v1');
    });

    test('rejects a relative URL', () {
      expect(
        () => AppConfig.fromMap(const <String, String>{'API_BASE_URL': '/api/v1'}),
        throwsA(
          isA<AppConfigException>().having(
            (AppConfigException e) => e.key,
            'key',
            'API_BASE_URL',
          ),
        ),
      );
    });

    test('rejects a non http scheme', () {
      expect(
        () => AppConfig.fromMap(const <String, String>{
          'API_BASE_URL': 'ftp://api.deliveryuy.uy',
        }),
        throwsA(isA<AppConfigException>()),
      );
    });

    test('rejects a non numeric timeout', () {
      expect(
        () => AppConfig.fromMap(const <String, String>{'API_TIMEOUT': 'soon'}),
        throwsA(
          isA<AppConfigException>().having(
            (AppConfigException e) => e.key,
            'key',
            'API_TIMEOUT',
          ),
        ),
      );
    });

    test('rejects an unrealistic timeout', () {
      expect(
        () => AppConfig.fromMap(const <String, String>{'API_TIMEOUT': '0'}),
        throwsA(isA<AppConfigException>()),
      );
      expect(
        () => AppConfig.fromMap(const <String, String>{'API_TIMEOUT': '600'}),
        throwsA(isA<AppConfigException>()),
      );
    });

    test('fromEnvironment returns a usable configuration without defines', () {
      final AppConfig config = AppConfig.fromEnvironment();

      expect(config.apiBaseUrl, defaultApiBaseUrl);
    });
  });
}