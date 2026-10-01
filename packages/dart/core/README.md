# `deliveryuy_core` (shared Dart package)

Contracts and configuration shared by the customer, merchant and driver
applications, so the same logic is not implemented three times (AGENTS.md
section 7).

Managed by the Dart toolchain, not by pnpm: `pnpm-workspace.yaml` excludes
`packages/dart/*` on purpose.

## Contents

| Module                     | Responsibility                                                              |
| -------------------------- | --------------------------------------------------------------------------- |
| `lib/src/app_config.dart`  | Validated configuration from `--dart-define` values, including the API URL.  |
| `lib/src/api_envelope.dart`| Decoding of `{ "data": ... }` / `{ "error": ... }` (`docs/API_RULES.md`).    |

Both modules are pure Dart with no business rule: the backend always revalidates
anything a client sends.

## Commands

```sh
flutter pub get
flutter analyze
flutter test
```