import 'package:deliveryuy_core/deliveryuy_core.dart';
import 'package:flutter/material.dart';

import 'src/auth_controller.dart';
import 'src/customer_app.dart';

void main() {
  // Fails loudly on a bad define instead of starting against an unreachable
  // origin (see AppConfig.fromEnvironment).
  final AppConfig config = AppConfig.fromEnvironment();
  final ApiClient apiClient = ApiClient(config: config);

  runApp(
    CustomerApp(
      controller: AuthController(authApi: AuthApi(apiClient), config: config),
      apiClient: apiClient,
    ),
  );
}