/**
 * Geographic reference ports (`geo` owns `countries`, `cities`,
 * `delivery_zones`, docs/MODULE_BOUNDARIES.md).
 *
 * The service depends on this interface rather than on Prisma so a consumer
 * such as merchant registration can be tested without a database, and so the
 * city list stays data-driven: nothing here can encode a city-specific rule
 * (AGENTS.md sections 45, 46).
 */
export interface GeoCityRecord {
  readonly id: string;
  readonly countryCode: string;
  readonly name: string;
  readonly departmentOrState: string | null;
  readonly timezone: string;
  readonly currency: string;
  readonly isDefault: boolean;
  readonly enabled: boolean;
}

export interface CityRepository {
  findById(id: string): Promise<GeoCityRecord | null>;
  /** Cities a client may choose, newest feature first is irrelevant: name order. */
  listEnabled(): Promise<readonly GeoCityRecord[]>;
}
