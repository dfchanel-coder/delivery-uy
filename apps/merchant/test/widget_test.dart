import 'package:deliveryuy_merchant/main.dart' as app;
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('muestra el nombre de la aplicacion', (WidgetTester tester) async {
    await tester.pumpWidget(const app.MerchantApp());

    expect(find.text('DeliveryUY - Comercio'), findsWidgets);
    expect(find.text('Gestiona tu catalogo, recibe pedidos y controla tus horarios.'), findsOneWidget);
  });

  testWidgets('muestra el origen de la API configurado', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const app.MerchantApp());

    expect(find.text('Origen de la API'), findsOneWidget);
    expect(find.textContaining('/api/v1'), findsOneWidget);
  });

  testWidgets('declara el alcance actual en lugar de inventar datos', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const app.MerchantApp());

    expect(find.textContaining('PHASE 01'), findsWidgets);
  });
}
