import 'package:deliveryuy_core/deliveryuy_core.dart';
import 'package:flutter/material.dart';

void main() {
  runApp(const DriverApp());
}

/// Root widget of the driver application.
class DriverApp extends StatelessWidget {
  /// Creates the application root.
  const DriverApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'DeliveryUY - Repartidor',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF1F6FEB)),
        useMaterial3: true,
      ),
      home: const DriverHomePage(),
    );
  }
}

/// Landing screen of the driver application.
///
/// It shows the effective configuration instead of inventing data: the API
/// origin is read from the shared package, so a misconfigured build is visible
/// immediately (AGENTS.md section 5).
class DriverHomePage extends StatelessWidget {
  /// Creates the landing screen.
  const DriverHomePage({super.key});

  @override
  Widget build(BuildContext context) {
    final AppConfig config = AppConfig.fromEnvironment();

    return Scaffold(
      appBar: AppBar(title: const Text('DeliveryUY - Repartidor')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          Text('Acepta ofertas de reparto, navega la ruta y entrega con codigo.', style: Theme.of(context).textTheme.titleMedium),
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
            for (final String scope in <String>['Registro, documentacion y verificacion del repartidor (PHASE 05)', 'Disponibilidad en linea, pausado y fuera de linea (PHASE 05)', 'Ofertas del despachador y aceptacion de entregas (PHASE 13)', 'Navegacion, punto de recoleccion y entrega (PHASE 13)', 'Confirmacion de entrega con el codigo del cliente (PHASE 14)'])
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



