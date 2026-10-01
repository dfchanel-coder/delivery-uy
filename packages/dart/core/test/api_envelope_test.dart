import 'package:deliveryuy_core/deliveryuy_core.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ApiEnvelope', () {
    test('decodes a success envelope', () {
      final ApiEnvelope envelope = ApiEnvelope.fromJson(const <String, Object?>{
        'data': <String, Object?>{'id': 'order-1'},
      });

      expect(envelope.isSuccess, isTrue);
      expect(envelope.failure, isNull);
      expect((envelope.data! as Map<String, Object?>)['id'], 'order-1');
    });

    test('decodes a failure envelope with the correlation id', () {
      final ApiEnvelope envelope = ApiEnvelope.fromJson(const <String, Object?>{
        'error': <String, Object?>{
          'code': 'DELIVERY_CODE_INVALID',
          'message': 'The delivery code is not valid.',
          'details': <String, Object?>{'attemptsLeft': 3},
          'correlationId': 'c1c1c1c1-0000-4000-8000-000000000002',
        },
      });

      expect(envelope.isSuccess, isFalse);
      expect(envelope.failure!.code, 'DELIVERY_CODE_INVALID');
      expect(envelope.failure!.details!['attemptsLeft'], 3);
      expect(
        envelope.failure!.correlationId,
        'c1c1c1c1-0000-4000-8000-000000000002',
      );
    });

    test('ignores unknown extra keys instead of failing', () {
      final ApiEnvelope envelope = ApiEnvelope.fromJson(const <String, Object?>{
        'error': <String, Object?>{
          'code': 'NOT_FOUND',
          'message': 'Cannot GET /api/v1/orders/1',
          'unexpected': true,
        },
      });

      expect(envelope.failure!.code, 'NOT_FOUND');
      expect(envelope.failure!.details, isNull);
    });

    test('rejects a failure without a machine readable code', () {
      expect(
        () => ApiEnvelope.fromJson(const <String, Object?>{
          'error': <String, Object?>{'message': 'Something went wrong.'},
        }),
        throwsFormatException,
      );
    });

    test('rejects a payload that is neither data nor error', () {
      expect(
        () => ApiEnvelope.fromJson(const <String, Object?>{'status': 'ok'}),
        throwsFormatException,
      );
    });

    test('rejects a non object error member', () {
      expect(
        () => ApiEnvelope.fromJson(const <String, Object?>{'error': 'boom'}),
        throwsFormatException,
      );
    });

    test('accepts a null data payload', () {
      final ApiEnvelope envelope = ApiEnvelope.fromJson(const <String, Object?>{
        'data': null,
      });

      expect(envelope.isSuccess, isTrue);
      expect(envelope.data, isNull);
    });
  });
}