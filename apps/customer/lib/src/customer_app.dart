import 'package:deliveryuy_core/deliveryuy_core.dart';
import 'package:flutter/material.dart';

import 'auth_controller.dart';
import 'login_page.dart';
import 'session_page.dart';

/// Root widget of the customer application.
///
/// It owns the HTTP connection and swaps between the two states a customer can
/// be in, without named routes: both screens are reachable only from here, so a
/// deep link can never land on a page that assumes credentials the app does not
/// hold.
class CustomerApp extends StatefulWidget {
  /// Creates the application root.
  ///
  /// [apiClient] is the connection to close when this widget leaves the tree. It
  /// is optional because tests build the controller over an injected client they
  /// own themselves.
  const CustomerApp({super.key, required this.controller, this.apiClient});

  /// Session state the screens react to.
  final AuthController controller;

  /// Connection owned by this widget, closed on teardown when supplied.
  final ApiClient? apiClient;

  @override
  State<CustomerApp> createState() => _CustomerAppState();
}

class _CustomerAppState extends State<CustomerApp> {
  @override
  void dispose() {
    widget.controller.dispose();
    widget.apiClient?.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'DeliveryUY',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF1F6FEB)),
        useMaterial3: true,
      ),
      home: ListenableBuilder(
        listenable: widget.controller,
        builder: (BuildContext context, Widget? _) {
          if (widget.controller.status == AuthStatus.signedIn) {
            return SessionPage(controller: widget.controller);
          }

          return LoginPage(controller: widget.controller);
        },
      ),
    );
  }
}