import type { SqlRow } from './sqlite-database';

/**
 * A row the driver handed back did not have the column, or the value, the store knows it must have.
 *
 * The driver cannot check this: it prepared a SELECT and cannot know which table it read. The store
 * can, because that is where a row becomes a domain type. Raising here is what turns a malformed row
 * into a loud failure instead of a domain object with an `undefined` field that travels to the
 * renderer.
 */
export class RowParseError extends Error {
  override readonly name = 'RowParseError';
  constructor(
    readonly table: string,
    readonly column: string,
    readonly expected: string,
    readonly value: unknown,
  ) {
    super(
      `${table}.${column} is not a ${expected}: received ${
        value === undefined ? 'no column' : `${typeof value} (${String(value)})`
      }`,
    );
  }
}

function requireColumn(row: SqlRow, table: string, column: string, expected: string): unknown {
  const value = row[column];
  if (value === undefined || value === null)
    throw new RowParseError(table, column, expected, value);
  return value;
}

export function readText(row: SqlRow, table: string, column: string): string {
  const value = requireColumn(row, table, column, 'string');
  if (typeof value !== 'string') throw new RowParseError(table, column, 'string', value);
  return value;
}

export function readInt(row: SqlRow, table: string, column: string): number {
  const value = requireColumn(row, table, column, 'integer');
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new RowParseError(table, column, 'integer', value);
  return value;
}

/** A `0`/`1` INTEGER column as a boolean. */
export function readFlag(row: SqlRow, table: string, column: string): boolean {
  const value = requireColumn(row, table, column, '0 or 1');
  if (value !== 0 && value !== 1) throw new RowParseError(table, column, '0 or 1', value);
  return value === 1;
}

/** NULL and "column absent" both mean "no value"; anything else must be the stated type. */
export function readNullableText(row: SqlRow, table: string, column: string): string | null {
  const value = row[column];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new RowParseError(table, column, 'string or null', value);
  return value;
}

export function readNullableInt(row: SqlRow, table: string, column: string): number | null {
  const value = row[column];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new RowParseError(table, column, 'integer or null', value);
  return value;
}
