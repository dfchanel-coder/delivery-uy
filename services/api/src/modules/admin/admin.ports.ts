import type { AdminPanelSummary } from '@deliveryuy/types';

/**
 * The admin read model (docs/MODULE_BOUNDARIES.md: `admin` owns "read models +
 * privileged commands").
 *
 * It is deliberately its own port rather than a set of repository calls in the
 * controller. The panel is a projection across several aggregates that no single
 * domain module owns, so it belongs to the module that presents it - and, being
 * a port, it can be tested without a database.
 */
export interface AdminReadModel {
  summary(): Promise<AdminPanelSummary>;
}
