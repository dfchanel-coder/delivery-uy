import { MapProviderNotConfiguredError, type MapProvider } from './map-provider.js';

export * from './map-provider.js';

export const MAP_PROVIDER_NAMES = ['none', 'google', 'mapbox', 'openstreetmap'] as const;
export type MapProviderName = (typeof MAP_PROVIDER_NAMES)[number];

function reject(): Promise<never> {
  return Promise.reject(new MapProviderNotConfiguredError());
}

/**
 * Placeholder used when `MAP_PROVIDER=none`.
 *
 * Every call rejects instead of returning fabricated data, so an unconfigured
 * environment can never produce plausible-looking GPS results
 * (AGENTS.md sections 5 and 16).
 */
class UnconfiguredMapProvider implements MapProvider {
  getName(): string {
    return 'none';
  }

  geocode(): Promise<never> {
    return reject();
  }

  reverseGeocode(): Promise<never> {
    return reject();
  }

  distance(): Promise<never> {
    return reject();
  }

  directions(): Promise<never> {
    return reject();
  }
}

const registry = new Map<MapProviderName, () => MapProvider>([
  ['none', () => new UnconfiguredMapProvider()],
]);

/** Registers a concrete adapter from the composition root, never from domain code. */
export function registerMapProvider(name: MapProviderName, factory: () => MapProvider): void {
  registry.set(name, factory);
}

export function resolveMapProvider(name: MapProviderName): MapProvider {
  const factory = registry.get(name);

  if (!factory) {
    throw new MapProviderNotConfiguredError();
  }

  return factory();
}
