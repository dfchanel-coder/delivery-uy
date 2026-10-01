import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export interface SchemaField {
  /** Field name as written in the Prisma schema. */
  readonly name: string;
  /** Prisma type, for example `String`, `Decimal` or `OrderStatus`. */
  readonly type: string;
  readonly optional: boolean;
  readonly isList: boolean;
  /** Everything after the type declaration, attributes included. */
  readonly attributes: string;
  readonly line: number;
}

export interface SchemaModel {
  readonly name: string;
  readonly fields: readonly SchemaField[];
  readonly blockAttributes: readonly string[];
  readonly line: number;
}

export interface PrismaSchema {
  readonly models: readonly SchemaModel[];
  readonly enums: readonly string[];
  readonly source: string;
}

const MODEL_START = /^model\s+(\w+)\s*\{\s*$/;
const ENUM_START = /^enum\s+(\w+)\s*\{\s*$/;
const FIELD = /^ {2}([A-Za-z]\w*)(\s+)([A-Z]\w*)(\[\])?(\?)?(.*)$/;

/**
 * Minimal line-oriented parser for `schema.prisma`.
 *
 * It is intentionally not a full Prisma grammar implementation: it extracts
 * exactly what the convention checks need (models, fields, types, attributes)
 * and ignores comments and formatting. `prisma validate` remains the authority
 * on whether the schema itself is valid; these tests only assert the naming,
 * typing and safety conventions that the validator does not check.
 */
export function parsePrismaSchema(source: string): PrismaSchema {
  const lines = source.split(/\r?\n/);

  const models: SchemaModel[] = [];
  const enums: string[] = [];

  let model: {
    name: string;
    fields: SchemaField[];
    blockAttributes: string[];
    line: number;
  } | null = null;
  let insideEnum = false;

  lines.forEach((rawLine, index) => {
    // Indentation carries meaning here: fields are indented two spaces and block
    // attributes (`@@map`, `@@index`) are indented too, so only the right side
    // of the line may be trimmed for classification.
    const line = rawLine.trimEnd();
    const lineNumber = index + 1;

    if (MODEL_START.test(line)) {
      const name = MODEL_START.exec(line)?.[1] ?? '';
      model = { name, fields: [], blockAttributes: [], line: lineNumber };
      return;
    }

    if (ENUM_START.test(line)) {
      insideEnum = true;
      enums.push(ENUM_START.exec(line)?.[1] ?? '');
      return;
    }

    if (line === '}') {
      if (model !== null) {
        models.push({
          name: model.name,
          fields: model.fields,
          blockAttributes: model.blockAttributes,
          line: model.line,
        });
        model = null;
      }
      insideEnum = false;
      return;
    }

    if (model === null || insideEnum) return;

    const trimmed = line.trim();

    if (trimmed.startsWith('@@')) {
      model.blockAttributes.push(trimmed);
      return;
    }

    if (trimmed === '' || trimmed.startsWith('//')) return;

    const match = FIELD.exec(line);
    if (match === null) return;

    const [, name, , type, list = '', optional = '', attributes = ''] = match;
    if (name === undefined || type === undefined) return;

    model.fields.push({
      name,
      type,
      optional: optional === '?',
      isList: list !== '',
      attributes: attributes.trim(),
      line: lineNumber,
    });
  });

  return { models, enums, source };
}

/**
 * Reads and parses `prisma/schema.prisma` from disk.
 *
 * The path is resolved from the working directory instead of `import.meta.url`
 * because this package is emitted as CommonJS (NestJS consumers), where
 * `import.meta` is not available. Both plausible working directories are tried
 * so the tests work from the repository root and from inside the package.
 */
export function readDatabaseSchema(): PrismaSchema {
  const candidates = [
    path.resolve(process.cwd(), 'packages/database/prisma/schema.prisma'),
    path.resolve(process.cwd(), 'prisma/schema.prisma'),
  ];
  const schemaPath = candidates.find((candidate) => existsSync(candidate));

  if (schemaPath === undefined) {
    throw new Error(
      `schema.prisma not found. Looked in:\n${candidates.map((c) => `  - ${c}`).join('\n')}`,
    );
  }

  return parsePrismaSchema(readFileSync(schemaPath, 'utf8'));
}

/** Column name a field maps to, honouring `@map` (DATABASE.md snake_case rule). */
export function columnNameOf(field: SchemaField): string {
  const mapped = /@map\("([^"]+)"\)/.exec(field.attributes);
  return mapped?.[1] ?? field.name;
}

/** Fields that are scalar columns rather than relations or enum references. */
export function isScalarField(field: SchemaField, modelNames: readonly string[]): boolean {
  return (
    !field.isList && !modelNames.includes(field.type) && !field.attributes.includes('@relation')
  );
}
