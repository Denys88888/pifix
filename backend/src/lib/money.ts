import { Prisma } from '@prisma/client';

/**
 * Pi amounts are handled exclusively as Prisma.Decimal (backed by decimal.js).
 * Never convert to Number for arithmetic — only for display, and only on the edge.
 */
export type Money = Prisma.Decimal;

export const PI_DECIMALS = 7;

export const D = (value: Prisma.Decimal.Value): Money => new Prisma.Decimal(value);

export const ZERO = (): Money => new Prisma.Decimal(0);

/** Rounds down to Pi's 7 decimals — never hand the chain more precision than it takes. */
export function toPi(value: Prisma.Decimal.Value): Money {
  return new Prisma.Decimal(value).toDecimalPlaces(PI_DECIMALS, Prisma.Decimal.ROUND_DOWN);
}

/** Serialises a Decimal for JSON responses as a fixed-precision string (no float drift). */
export function money(value: Prisma.Decimal.Value | null | undefined): string {
  if (value === null || value === undefined) return '0';
  return toPi(value).toFixed(PI_DECIMALS).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

export function percentOf(amount: Prisma.Decimal.Value, percent: Prisma.Decimal.Value): Money {
  return toPi(new Prisma.Decimal(amount).mul(new Prisma.Decimal(percent)).div(100));
}

export function sum(...values: Prisma.Decimal.Value[]): Money {
  return toPi(values.reduce<Money>((acc, value) => acc.add(new Prisma.Decimal(value)), ZERO()));
}

export function isPositive(value: Prisma.Decimal.Value): boolean {
  return new Prisma.Decimal(value).greaterThan(0);
}

/** Compares two Pi amounts at chain precision — protects against 0.0000000_1 mismatches. */
export function equalsPi(a: Prisma.Decimal.Value, b: Prisma.Decimal.Value): boolean {
  return toPi(a).equals(toPi(b));
}
