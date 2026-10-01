import 'package:deliveryuy_customer/main.dart' as app;
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('muestra el nombre de la aplicacion', (WidgetTester tester) async {
    await tester.pumpWidget(const app.CustomerApp());

    expect(find.text('DeliveryUY - Cliente'), findsWidgets);
    expect(find.text('Pide a comercios de tu barrio y sigue tu reparto en tiempo real.'), findsOneWidget);
  });

  testWidgets('muestra el origen de la API configurado', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const app.CustomerApp());

    expect(find.text('Origen de la API'), findsOneWidget);
    expect(find.textContaining('/api/v1'), findsOneWidget);
  });

  testWidgets('declara el alcance actual en lugar de inventar datos', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const app.CustomerApp());

    expect(find.textContaining('PHASE 01'), findsWidgets);
  });
}
