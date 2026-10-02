/// HTTP access to the DeliveryUY API.
///
/// Every application needs the same three things: honour the envelope of
/// `docs/API_RULES.md`, tell a refused request apart from an unreachable
/// server, and stay inside a bounded time budget. Those live here so the
/// customer, merchant and driver applications cannot drift apart
/// (AGENTS.md section 7).
///
/// The client is deliberately stateless with respect to credentials: the access
/// token is passed per call instead of being stored on the client, because
/// `POST /auth/login` and `POST /auth/refresh` must reach the API without one.
/// A client that remembered the last token would send it to endpoints that
/// should never see it.
library;

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'api_envelope.dart';
import 'app_config.dart';

/// Base class for every failure raised by [ApiClient].
abstract class ApiClientException implements Exception {
  /// Creates an exception with a message intended for logs and developer tools.
  const ApiClientException(this.reason);

  /// Technical explanation. Not user facing copy.
  final String reason;

  @override
  String toString() => '$runtimeType($reason)';
}

/// The API answered with a failure envelope.
///
/// The [code] is what a caller branches on, never the human readable
/// [ApiFailure.message]: messages are written for people and may change, while
/// codes are part of the contract (AGENTS.md section 36).
class ApiFailureException extends ApiClientException {
  /// Creates a failure from an envelope the API actually returned.
  ApiFailureException(this.failure, {required this.statusCode})
    : super('${failure.code} (HTTP $statusCode)');

  /// Descriptor supplied by the API.
  final ApiFailure failure;

  /// HTTP status that carried the failure envelope.
  final int statusCode;

  /// Machine readable code, for example `INVALID_CREDENTIALS`.
  String get code => failure.code;

  /// Identifier the API logged this failure under, for support conversations.
  String? get correlationId => failure.correlationId;
}

/// The request never produced an answer.
///
/// Kept apart from [ApiFailureException] because the remedy is different: a
/// refused request needs different input, while this one needs connectivity.
/// Mobile data is unreliable (AGENTS.md section 43), so a caller must be able to
/// tell "try again" apart from "you typed the wrong password" without parsing a
/// message.
class ApiTransportException extends ApiClientException {
  /// Creates a transport failure.
  const ApiTransportException(super.reason);
}

/// Talks to one DeliveryUY deployment.
class ApiClient {
  /// Creates a client for [config].
  ///
  /// [httpClient] exists so tests can answer without a server. When it is null
  /// the client creates and owns one, and [close] disposes of it; an injected
  /// client is left alone because whoever injected it owns its lifecycle.
  ApiClient({required this.config, http.Client? httpClient})
    // Ownership is decided by whether the client had to create it, because an
    // injected one belongs to the caller and must outlive this object.
    : _http = httpClient ?? http.Client(),
      _ownsHttpClient = httpClient == null;

  /// Content type shared by requests and responses.
  static const String _jsonContentType = 'application/json';

  /// Validated deployment this client talks to.
  final AppConfig config;
  final http.Client _http;
  final bool _ownsHttpClient;

  /// Performs a GET and returns the `data` member of the envelope.
  ///
  /// Pass [accessToken] only for endpoints that require authentication.
  Future<Object?> get(
    String path, {
    String? accessToken,
    Map<String, String>? query,
  }) {
    final Uri uri = _resolve(path, query);

    return _send(
      () => _http.get(uri, headers: _headers(accessToken)),
      'GET',
      path,
    );
  }

  /// Performs a POST and returns the `data` member of the envelope.
  ///
  /// [body] is encoded as JSON; a null body sends no payload at all.
  Future<Object?> post(
    String path, {
    Object? body,
    String? accessToken,
  }) async {
    final Uri uri = _resolve(path, null);
    final String? payload = body == null ? null : jsonEncode(body);

    final Object? data = await _send(
      () => _http.post(uri, headers: _headers(accessToken), body: payload),
      'POST',
      path,
    );

    return data;
  }

  /// Releases the underlying connection pool when this client owns it.
  void close() {
    if (_ownsHttpClient) {
      _http.close();
    }
  }

  Map<String, String> _headers(String? accessToken) {
    return <String, String>{
      'Accept': _jsonContentType,
      'Content-Type': _jsonContentType,
      if (accessToken != null) 'Authorization': 'Bearer $accessToken',
    };
  }

  /// Builds an absolute URI without ever producing a double slash.
  ///
  /// `apiBaseUrl` already carries the `/api/v1` prefix, and callers pass paths
  /// such as `/auth/login`. Normalising both ends is what keeps a future change
  /// to either one from producing a silently wrong URL.
  Uri _resolve(String path, Map<String, String>? query) {
    final String base = config.apiBaseUrl.endsWith('/')
        ? config.apiBaseUrl.substring(0, config.apiBaseUrl.length - 1)
        : config.apiBaseUrl;
    final String suffix = path.startsWith('/') ? path : '/$path';

    return Uri.parse('$base$suffix').replace(queryParameters: query);
  }

  Future<Object?> _send(
    Future<http.Response> Function() request,
    String method,
    String path,
  ) async {
    final http.Response response;

    try {
      response = await request().timeout(config.apiTimeout);
    } on TimeoutException catch (error) {
      throw ApiTransportException('$method $path timed out: ${error.message}');
    } on http.ClientException catch (error) {
      throw ApiTransportException('$method $path unreachable: ${error.message}');
    }

    return _decode(response, method, path);
  }

  Object? _decode(http.Response response, String method, String path) {
    // `204 No Content` is part of the contract (POST /auth/logout answers that
    // way). Reading an empty body as "unreadable" would turn a successful logout
    // into a failure, so an empty 2xx is read as a success with no payload.
    if (response.body.trim().isEmpty) {
      if (response.statusCode >= 200 && response.statusCode < 300) {
        return null;
      }

      throw ApiFailureException(
        const ApiFailure(
          code: 'UNREADABLE_RESPONSE',
          message: 'The API returned an empty body with a failure status.',
        ),
        statusCode: response.statusCode,
      );
    }

    final Object? decoded;

    try {
      decoded = jsonDecode(response.body);
    } on FormatException {
      throw ApiFailureException(
        const ApiFailure(
          code: 'UNREADABLE_RESPONSE',
          message: 'The API returned a body this client cannot read.',
        ),
        statusCode: response.statusCode,
      );
    }

    // A body that is not a JSON object cannot be an envelope. Treating that as
    // a failure with a code is deliberate: the caller must not treat an
    // HTML error page or a proxy timeout as a successful empty answer.
    if (decoded is! Map<String, Object?>) {
      throw ApiFailureException(
        const ApiFailure(
          code: 'UNEXPECTED_RESPONSE',
          message: 'The API returned a response that is not an envelope.',
        ),
        statusCode: response.statusCode,
      );
    }

    final ApiEnvelope envelope;

    try {
      envelope = ApiEnvelope.fromJson(decoded);
    } on FormatException {
      throw ApiFailureException(
        const ApiFailure(
          code: 'UNEXPECTED_RESPONSE',
          message: 'The API returned an envelope this client cannot read.',
        ),
        statusCode: response.statusCode,
      );
    }

    final ApiFailure? failure = envelope.failure;

    if (failure != null) {
      throw ApiFailureException(failure, statusCode: response.statusCode);
    }

    return envelope.data;
  }
}
