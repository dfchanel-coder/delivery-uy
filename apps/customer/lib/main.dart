import 'package:deliveryuy_core/deliveryuy_core.dart';
import 'package:flutter/material.dart';

void main() {
  runApp(const CustomerApp());
}

/// Root widget of the customer application.
class CustomerApp extends StatelessWidget {
  /// Creates the application root.
  const CustomerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'DeliveryUY - Cliente',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF1F6FEB)),
        useMaterial3: true,
      ),
      home: const CustomerHomePage(),
    );
  }
}

/// Landing screen of the customer application.
///
/// It shows the effective configuration instead of inventing data: the API
/// origin is read from the shared package, so a misconfigured build is visible
/// immediately (AGENTS.md section 5).
class CustomerHomePage extends StatelessWidget {
  /// Creates the landing screen.
  const CustomerHomePage({super.key});

  @override
  Widget build(BuildContext context) {
    final AppConfig config = AppConfig.fromEnvironment();

    return Scaffold(
      appBar: AppBar(title: const Text('DeliveryUY - Cliente')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          Text('Pide a comercios de tu barrio y sigue tu reparto en tiempo real.', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 16),
          Card(
            child: ListTile(
              title: const Text('Origen de la API'),
              subtitle: Text(config.apiBaseUrl),
              trailing: Text('${config.apiTimeout.inSeconds} s'),
            ),
          ),
          const SizedBox(height: 16),
          Text('Alcance de esta version', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          const Text('PHASE 01 - esqueleto verificable. Nada de datos simulados.'),
          const SizedBox(height: 8),
          ...<Widget>[
            for (final String scope in <String>['Registro, verificacion de cuenta y recuperacion de contrasena (PHASE 03)', 'Direcciones guardadas y seleccion en el mapa (PHASE 06)', 'Catalogo de comercios, productos, variantes y agregados (PHASE 08)', 'Carrito, cupones, checkout y pagos (PHASE 10)', 'Seguimiento del reparto y codigo de entrega (PHASE 14)'])
              ListTile(
                dense: true,
                leading: const Icon(Icons.schedule),
                title: Text(scope),
              ),
          ],
        ],
      ),
    );
  }
}


