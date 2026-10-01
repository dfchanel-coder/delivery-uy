# DeliveryUY - Repartidor

Acepta ofertas de reparto, navega la ruta y entrega con el codigo del cliente.

Flutter application skeleton created in PHASE 01.

## What exists

- `lib/main.dart`: application shell and a landing screen that shows the
  effective configuration (API origin and timeout) read from the shared
  package `packages/dart/core`.
- `test/widget_test.dart`: widget tests asserting the shell renders and never
  presents simulated data as if it were real.
- `analysis_options.yaml`: stricter than the default template.

## What does not exist yet, and why

Nothing else is implemented on purpose. The endpoints this application would
call do not exist yet, so any authentication screen, catalog or order list would
be a fake implementation (AGENTS.md section 5). The planned phases are listed in
`../../ROADMAP.MD` and summarised on the landing screen.

## Configuration

Compile-time defines (never secrets):

```sh
flutter run --dart-define=API_BASE_URL=http://localhost:3000/api/v1
flutter run --dart-define=API_BASE_URL=http://localhost:3000/api/v1 \
            --dart-define=API_TIMEOUT=10
```

The default `API_BASE_URL` is `http://10.0.2.2:3000/api/v1` (Android emulator to
host). The iOS simulator needs `http://localhost:3000/api/v1`.

## Commands

```sh
flutter pub get
flutter analyze
flutter test
```

From the repository root: `pnpm run flutter:check`.
