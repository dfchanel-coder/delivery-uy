import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@deliveryuy/database';
import type { CityRepository, GeoCityRecord } from '../ports.js';

/**
 * Cities, backed by PostgreSQL.
 *
 * `enabled` is filtered in the query rather than in the service: a disabled city
 * must not be offered to a client at all, and one place answering both "read
 * one" and "list" keeps that true.
 */
@Injectable()
export class PrismaCityRepository implements CityRepository {
  public constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  public async findById(id: string): Promise<GeoCityRecord | null> {
    const city = await this.prisma.city.findUnique({ where: { id } });

    return city === null ? null : toRecord(city);
  }

  public async listEnabled(): Promise<readonly GeoCityRecord[]> {
    const cities = await this.prisma.city.findMany({
      where: { enabled: true },
      orderBy: [{ countryCode: 'asc' }, { name: 'asc' }],
    });

    return cities.map(toRecord);
  }
}

function toRecord(city: {
  id: string;
  countryCode: string;
  name: string;
  departmentOrState: string | null;
  timezone: string;
  currency: string;
  isDefault: boolean;
  enabled: boolean;
}): GeoCityRecord {
  return {
    id: city.id,
    countryCode: city.countryCode,
    name: city.name,
    departmentOrState: city.departmentOrState,
    timezone: city.timezone,
    currency: city.currency,
    isDefault: city.isDefault,
    enabled: city.enabled,
  };
}
