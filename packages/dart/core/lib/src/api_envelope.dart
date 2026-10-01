/// Decoding of the DeliveryUY API envelope (`docs/API_RULES.md`).
///
/// The applications never branch on human readable messages; they branch on the
/// machine readable `code` (AGENTS.md section 36). Because every application
/// needs the same decoding, it lives here instead of being copied three times.
library;

/// Failure payload of the API envelope.
class ApiFailure {
  /// Decodes an `error` object, rejecting payloads missing the mandatory keys.
  factory ApiFailure.fromJson(Map<String, Object?> json) {
    final Object? code = json['code'];
    final Object? message = json['message'];

    if (code is! String || code.isEmpty || message is! String) {
      throw const FormatException(
        'error.code and error.message must be non-empty strings',
      );
    }

    final Object? details = json['details'];
    final Object? correlationId = json['correlationId'];

    return ApiFailure(
      code: code,
      message: message,
      details: details is Map<String, Object?> ? details : null,
      correlationId: correlationId is String ? correlationId : null,
    );
  }

  /// Creates a failure descriptor.
  const ApiFailure({
    required this.code,
    required this.message,
    this.details,
    this.correlationId,
  });

  /// Machine readable error code, for example `ORDER_INVALID_STATE`.
  final String code;

  /// Human readable message, safe to display in a support conversation.
  final String message;

  /// Optional structured details supplied by the API.
  final Map<String, Object?>? details;

  /// Identifier of the server-side log entry related to this failure.
  final String? correlationId;

  @override
  String toString() => 'ApiFailure($code, correlationId: $correlationId)';
}

/// Either a success payload or a failure, exactly as the API returns it.
class ApiEnvelope {
  /// Decodes a decoded JSON object into an envelope.
  ///
  /// Throws [FormatException] when the payload is neither a success nor a failure
  /// envelope: a client that silently accepts unknown shapes will fail later in
  /// a much more confusing place.
  factory ApiEnvelope.fromJson(Map<String, Object?> json) {
    if (json.containsKey('error')) {
      final Object? error = json['error'];

      if (error is! Map<String, Object?>) {
        throw const FormatException('error must be an object');
      }

      return ApiEnvelope.failure(ApiFailure.fromJson(error));
    }

    if (!json.containsKey('data')) {
      throw const FormatException('response must contain data or error');
    }

    return ApiEnvelope.success(json['data']);
  }

  /// Creates a success envelope around [data].
  const ApiEnvelope.success(this.data) : failure = null;

  /// Creates a failure envelope.
  const ApiEnvelope.failure(ApiFailure this.failure) : data = null;

  /// Payload of a successful response.
  final Object? data;

  /// Failure descriptor, or `null` when the response succeeded.
  final ApiFailure? failure;

  /// Whether the response carried a success payload.
  bool get isSuccess => failure == null;
}