import type { Metadata } from 'next';
import type { ReactNode, ReactElement } from 'react';
import { getAdminEnv } from '@/lib/config';
import './globals.css';

export function generateMetadata(): Metadata {
  return {
    title: getAdminEnv().ADMIN_PANEL_NAME,
    description: 'Panel de administracion de DeliveryUY',
  };
}

/**
 * Copy is written in Spanish because Uruguay is the initial market. It is kept
 * in the components (never in business logic) so i18n can be introduced later
 * (AGENTS.md section 44).
 */
export default function RootLayout({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <html lang="es">
      <body>
        <div className="shell">
          <header className="masthead">
            <h1>DeliveryUY Admin</h1>
            <nav aria-label="Navegacion principal">
              <a href="/">Inicio</a>
              <a href="/health">Estado del servicio</a>
              <a href={`${getAdminEnv().API_URL}/api/docs`}>Documentacion de la API</a>
            </nav>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
