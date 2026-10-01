export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

export interface DistanceResult {
  readonly distanceMeters: number;
  readonly durationSeconds: number;
}

export interface AddressComponent {
  readonly street?: string;
  readonly streetNumber?: string;
  readonly city?: string;
  readonly department?: string;
  readonly country?: string;
  readonly zipCode?: string;
}

export interface GeocodeResult {
  readonly coordinates: Coordinates;
  readonly address?: AddressComponent;
}

export interface DirectionsResult {
  readonly points: Coordinates[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
}

/**
 * MapProvider - ADR-005.
 *
 * Domain code must depend on this interface only. All third-party map SDK
 * calls live inside concrete adapters. Do not leak vendor types.
 */
export interface MapProvider {
  getName(): string;
  geocode(query: string): Promise<GeocodeResult[]>;
  reverseGeocode(coordinates: Coordinates): Promise<GeocodeResult | null>;
  distance(origin: Coordinates, destination: Coordinates): Promise<DistanceResult>;
  directions(origin: Coordinates, destination: Coordinates): Promise<DirectionsResult | null>;
}

export class MapProviderNotConfiguredError extends Error {
  public constructor() {
    super('Map provider is not configured');
    this.name = 'MapProviderNotConfiguredError';
  }
}
