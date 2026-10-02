import 'package:deliveryuy_core/deliveryuy_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'src/auth_controller.dart';
import 'src/customer_app.dart';
import 'src/secure_token_store.dart';

Future<void> main() async {
  // Reading the keystore goes through a platform channel, and a channel needs
  // the binding. `runApp` would set it up, but the restore below has to happen
  // first.
  WidgetsFlutterBinding.ensureInitialized();

  // Fails loudly on a bad define instead of starting against an unreachable
  // origin (see AppConfig.fromEnvironment).
  final AppConfig config = AppConfig.fromEnvironment();
  final ApiClient apiClient = ApiClient(config: config);
  final AuthController controller = AuthController(
    authApi: AuthApi(apiClient),
    config: config,
    tokenStore: SecureTokenStore(const FlutterSecureStorage()),
  );

  // Before the first frame, so a restored session does not flash the sign-in form
  // and then the session screen. A failure inside restore() is already handled
  // there and leaves the application signed out.
  await controller.restore();

  runApp(CustomerApp(controller: controller, apiClient: apiClient));
}