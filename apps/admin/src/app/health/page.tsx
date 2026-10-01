import type { ReactElement } from 'react';
import { ApiClientError } from '@/lib/api-client';
import { fetchReadiness } from '@/lib/delivery-api';

export const dynamic = 'force-dynamic';

type DependencyName = 'database' | 'redis';

/**
 * Readiness view.
 *
 * The API answers `503` when a dependency is down and hides the reason from the
 * response body on purpose, so the panel reports the connectivity failure and
 * points operators at the API logs / correlation id.
 */
export default async function HealthPage(): Promise<ReactElement> {
  try {
    const readiness = await fetchReadiness();
    const rows: DependencyName[] = ['database', 'redis'];

    return (
      <section className="card">
        <h2>Readiness</h2>
        <p>
          Resultado: <span className={`status ${readiness.status}`}>{readiness.status}</span>{' '}
          <span className="muted">(verificado {readiness.checkedAt})</span>
        </p>
        <table>
          <thead>
            <tr>
              <th>Dependencia</th>
              <th>Estado</th>
              <th>Latencia</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((name) => {
              const dependency = readiness.dependencies[name];
              return (
                <tr key={name}>
                  <td>{name}</td>
                  <td>
                    <span className={`status ${dependency.status === 'up' ? 'up' : 'down'}`}>
                      {dependency.status}
                    </span>
                  </td>
                  <td>{dependency.latencyMs} ms</td>
                  <td className="muted">{dependency.error ?? '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    );
  } catch (error: unknown) {
    const correlationId = error instanceof ApiClientError ? error.correlationId : null;

    return (
      <section className="card">
        <h2>Readiness</h2>
        <p>
          Resultado: <span className="status down">degraded</span>
        </p>
        <p className="muted">
          {error instanceof ApiClientError
            ? error.message
            : 'Error inesperado al consultar la API.'}
        </p>
        {correlationId !== null ? (
          <p className="muted">
            Busque <code>{correlationId}</code> en los logs del backend para ver el detalle de
            PostgreSQL y Redis.
          </p>
        ) : null}
      </section>
    );
  }
}
