import { Inject, Injectable } from '@nestjs/common';
import { loadConfig, type AppConfig } from '@deliveryuy/config';

export const APP_CONFIG = 'APP_CONFIG';

/**
 * Thin, typed accessor for the validated bootstrap configuration.
 *
 * The configuration is parsed once at startup; nothing else reads
 * `process.env` (ADR-013, docs/MODULE_BOUNDARIES.md).
 */
@Injectable()
export class AppConfigService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get(): AppConfig {
    return this.config;
  }

  get service(): AppConfig['service'] {
    return this.config.service;
  }

  get database(): AppConfig['database'] {
    return this.config.database;
  }

  get redis(): AppConfig['redis'] {
    return this.config.redis;
  }

  get auth(): AppConfig['auth'] {
    return this.config.auth;
  }

  get health(): AppConfig['health'] {
    return this.config.health;
  }

  get providers(): AppConfig['providers'] {
    return this.config.providers;
  }

  get featureFlags(): AppConfig['featureFlags'] {
    return this.config.featureFlags;
  }
}

export function parseEnvironment(): AppConfig {
  return loadConfig();
}
