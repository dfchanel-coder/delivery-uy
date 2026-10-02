/// Shared Dart contracts for the DeliveryUY mobile applications.
///
/// This package is managed by the Dart toolchain, not by pnpm
/// (`pnpm-workspace.yaml` excludes it on purpose). It exists so the customer,
/// merchant and driver applications share behaviour instead of duplicating it
/// (AGENTS.md section 7).
library;

export 'src/api_client.dart';
export 'src/api_envelope.dart';
export 'src/app_config.dart';
export 'src/auth.dart';
export 'src/token_store.dart';
