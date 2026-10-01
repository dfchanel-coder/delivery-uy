import 'package:deliveryuy_core/deliveryuy_core.dart';
import 'package:flutter/material.dart';

void main() {
  runApp(const MerchantApp());
}

/// Root widget of the merchant application.
class MerchantApp extends StatelessWidget {
  /// Creates the application root.
  const MerchantApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'DeliveryUY - Comercio',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF1F6FEB)),
        useMaterial3: true,
      ),
      home: const MerchantHomePage(),
    );
  }
}

/// Landing screen of the merchant application.
///
/// It shows the effective configuration instead of inventing data: the API
/// origin is read from the shared package, so a misconfigured build is visible
/// immediately (AGENTS.md section 5).
class MerchantHomePage extends StatelessWidget {
  /// Creates the landing screen.
  const MerchantHomePage({super.key});

  @override
  Widget build(BuildContext context) {
    final AppConfig config = AppConfig.fromEnvironment();

    return Scaffold(
      appBar: AppBar(title: const Text('DeliveryUY - Comercio')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          Text('Gestiona tu catalogo, recibe pedidos y controla tus horarios.', style: Theme.of(context).textTheme.titleMedium),
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
            for (final String scope in <String>['Alta del comercio, datos fiscales y documentacion (PHASE 04)', 'Aprobacion de la cuenta por parte de la administracion (PHASE 04)', 'Catalogo, variantes, agregados, precios y stock (PHASE 08)', 'Pedidos entrantes, aceptacion, preparacion y listo para retirar (PHASE 10)', 'Liquidaciones y comisiones (PHASE 16)'])
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


