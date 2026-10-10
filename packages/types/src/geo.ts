import type { CurrencyCode, Uuid } from './api.js';

/**
 * Geographic reference data (docs/MODULE_BOUNDARIES.md: `geo` owns
 * `countries`, `cities` and `delivery_zones`).
 *
 * Cities are data, not code: the multi-city requirement (AGENTS.md sections 45,
 * 46) means a client discovers the city it operates in from the API rather than
 * from a hardcoded list.
 */
export interface CityResponse {
  id: Uuid;
  countryCode: string;
  name: string;
  departmentOrState: string | null;
  timezone: string;
  currency: CurrencyCode;
  isDefault: boolean;
}
