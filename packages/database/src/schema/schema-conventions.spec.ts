import { describe, expect, it } from 'vitest';

import {
  readDatabaseSchema,
  columnNameOf,
  isScalarField,
  type SchemaModel,
} from './parse-schema.js';
import { SOFT_DELETABLE_TABLES } from '../soft-delete.js';

const schema = readDatabaseSchema();
const modelNames = schema.models.map((model) => model.name);

function modelsWithField(fieldName: string): SchemaModel[] {
  return schema.models.filter((model) => model.fields.some((field) => field.name === fieldName));
}

/** Money and rate columns that must never be floating point. */
const MONEY_COLUMNS = [
  'amount',
  'base_fee',
  'base_price',
  'delivery_fee',
  'distance_fee_per_km',
  'discount_amount',
  'discount_total',
  'flat_fee',
  'line_total',
  'min_order_amount',
  'paid_amount',
  'price',
  'price_delta',
  'refunded_amount',
  'service_fee',
  'subtotal',
  'surcharge',
  'tax_amount',
  'tax_total',
  'total',
  'unit_price',
] as const;

/**
 * Models that hold financial, audit or legal history. Cascading a delete into
 * one of them is always a bug, so they are listed once and asserted for every
 * relation in the schema.
 */
const MONEY_OR_AUDIT_REFERENCES = [
  'Payment',
  'Refund',
  'AuditLog',
  'OrderTimeline',
  'PaymentWebhookEvent',
  'IdempotencyKey',
  'OutboxEvent',
] as const;

const moneyOrAuditReferences: readonly string[] = MONEY_OR_AUDIT_REFERENCES;

describe('Prisma schema conventions', () => {
  it('parses every model and enum declared in the schema', () => {
    expect(schema.models.length).toBeGreaterThan(0);
    expect(schema.enums.length).toBeGreaterThan(0);
  });

  describe.each(schema.models.map((model) => [model.name, model] as const))('%s', (name, model) => {
    it('maps the table to snake_case', () => {
      const tableMap = model.blockAttributes.find((attribute) => attribute.startsWith('@@map('));

      expect(tableMap, `${name} must declare @@map`).toBeDefined();
      expect(tableMap).toMatch(/@@map\("[a-z][a-z0-9_]*"\)/);
    });

    it('maps every column to snake_case', () => {
      for (const field of model.fields) {
        if (!isScalarField(field, modelNames)) continue;

        expect(columnNameOf(field), `${name}.${field.name} column name`).toMatch(
          /^[a-z][a-z0-9_]*$/,
        );
      }
    });

    it('stores timestamps as timestamptz', () => {
      for (const field of model.fields) {
        if (field.type !== 'DateTime') continue;

        expect(field.attributes, `${name}.${field.name} must use timestamptz`).toContain(
          '@db.Timestamptz(3)',
        );
      }
    });

    it('never stores money as float or unbounded numeric', () => {
      for (const field of model.fields) {
        const column = columnNameOf(field);
        if (!isScalarField(field, modelNames)) continue;

        expect(field.type, `${name}.${column} must not be Float`).not.toBe('Float');

        if (!MONEY_COLUMNS.includes(column as (typeof MONEY_COLUMNS)[number])) continue;

        expect(field.type, `${name}.${column} must be Decimal`).toBe('Decimal');
        expect(field.attributes, `${name}.${column} needs explicit precision`).toContain(
          '@db.Decimal(14, 2)',
        );
      }
    });

    it('uses uuid primary keys', () => {
      const idField = model.fields.find((field) => field.name === 'id');
      if (idField === undefined || idField.type === 'BigInt') return;

      expect(idField.attributes, `${name}.id must be uuid`).toContain('@db.Uuid');
    });

    it('records when the row was created', () => {
      const createdAt = model.fields.find((field) => field.name === 'createdAt');
      if (createdAt === undefined) return;

      expect(createdAt.attributes, `${name}.createdAt must default to now()`).toContain(
        '@default(now())',
      );
    });

    it('never cascades the deletion of money or audit history', () => {
      // Children may cascade (removing a merchant removes its catalog), but a
      // cascade must never silently destroy a financial or audit record
      // (DATABASE.md "Database-Enforced Integrity", AGENTS.md section 28).
      for (const field of model.fields) {
        if (!field.attributes.includes('@relation')) continue;
        if (!field.attributes.includes('onDelete: Cascade')) continue;

        expect(
          moneyOrAuditReferences,
          `${name}.${field.name} cascades towards ${field.type}`,
        ).not.toContain(field.type);
      }
    });
  });

  it('keeps the soft-delete catalogue aligned with the schema', () => {
    const declaredTables = new Set<string>();

    for (const model of modelsWithField('deletedAt')) {
      const tableMap = model.blockAttributes.find((attribute) => attribute.startsWith('@@map('));
      declaredTables.add(tableMap?.match(/@@map\("([^"]+)"\)/)?.[1] ?? model.name);
    }

    expect([...declaredTables].sort()).toEqual([...SOFT_DELETABLE_TABLES].sort());
  });

  it('gives money columns an explicit currency companion', () => {
    const withoutCurrency = schema.models
      .filter((model) =>
        model.fields.some((field) => columnNameOf(field) === 'total' && field.type === 'Decimal'),
      )
      .filter((model) => !model.fields.some((field) => field.name === 'currency'));

    expect(withoutCurrency.map((model) => model.name)).toEqual([]);
  });
});
