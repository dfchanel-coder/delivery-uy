import type { ReactElement } from 'react';
import { ApiClientError } from '@/lib/api-client';
import { fetchLiveness } from '@/lib/delivery-api';
import { getAdminEnv } from '@/lib/config';

export const dynamic = 'force-dynamic';

function describeFailure(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.correlationId === null
      ? `${error.message} (codigo ${error.code})`
      : `${error.message} (codigo ${error.code}, correlationId ${error.correlationId})`;
  }

  return 'Error inesperado al consultar la API.';
}

/**
 * Skeleton dashboard.
 *
 * It shows real API state on purpose: a panel that renders hardcoded data
 * would hide an outage instead of reporting it (AGENTS.md section 5).
 * Administrative modules (merchants, drivers, orders, payments) arrive in their
 * own phases; this page must not pretend they exist.
 */
export default async function HomePage(): Promise<ReactElement> {
  const env = getAdminEnv();

  let body: ReactElement;

  try {
    const liveness = await fetchLiveness();

    body = (
      <section className="card">
        <h2>API</h2>
        <p>
          Servicio <code>{liveness.service}</code>, entorno <code>{liveness.environment}</code>,
          uptime {liveness.uptimeSeconds} s.
        </p>
        <p>
          Estado del proceso: <span className="status ok">{liveness.status}</span>
        </p>
        <p className="muted">Origen configurado: {env.API_URL}</p>
      </section>
    );
  } catch (error: unknown) {
    body = (
      <section className="card">
        <h2>API</h2>
        <p>
          Estado del proceso: <span className="status down">sin respuesta</span>
        </p>
        <p className="muted">{describeFailure(error)}</p>
        <p className="muted">
          Verifique que <code>{env.API_URL}</code> este levantado y que el origen del panel este
          permitido en <code>CORS_ORIGINS</code>.
        </p>
      </section>
    );
  }

  return (
    <>
      {body}
      <section className="card">
        <h2>Alcance de esta version</h2>
        <p className="muted">
          Panel en construccion (PHASE 01). La autenticacion administrativa y los modulos de gestion
          llegan en fases posteriores; todavia no existe inicio de sesion.
        </p>
        <table>
          <thead>
            <tr>
              <th>Modulo</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Shell y cliente HTTP</td>
              <td>implementado</td>
            </tr>
            <tr>
              <td>Autenticacion y RBAC</td>
              <td className="muted">pendiente (PHASE 03)</td>
            </tr>
            <tr>
              <td>Comercios, pedidos, pagos, liquidaciones</td>
              <td className="muted">pendiente</td>
            </tr>
          </tbody>
        </table>
      </section>
    </>
  );
}
