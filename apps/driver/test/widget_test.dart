import 'package:deliveryuy_driver/main.dart' as app;
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('muestra el nombre de la aplicacion', (WidgetTester tester) async {
    await tester.pumpWidget(const app.DriverApp());

    expect(find.text('DeliveryUY - Repartidor'), findsWidgets);
    expect(find.text('Acepta ofertas de reparto, navega la ruta y entrega con codigo.'), findsOneWidget);
  });

  testWidgets('muestra el origen de la API configurado', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const app.DriverApp());

    expect(find.text('Origen de la API'), findsOneWidget);
    expect(find.textContaining('/api/v1'), findsOneWidget);
  });

  testWidgets('declara el alcance actual en lugar de inventar datos', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const app.DriverApp());

    expect(find.textContaining('PHASE 01'), findsWidgets);
  });
}
