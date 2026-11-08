/**
 * `@ducatjs/money/historic`: withdrawn ISO 4217 codes and a few non-ISO ones, with the exponent
 * each had and, for ISO codes, the month ISO withdrew it. Nothing is registered until you ask, so
 * the core registry stays ISO 4217 as currently published:
 *
 *     defineHistoricCurrencies(['HRK', 'BGN']);
 *     money('100', 'HRK'); // 100.00 HRK
 *     historicCurrency('HRK')?.withdrawn; // '2023-01'
 */
import { defineCurrency } from './currency.js';
import { HISTORIC_CURRENCY_TABLE, ISO_4217_LIST_THREE_PUBLISHED } from './generated/historic.js';

export { ISO_4217_LIST_THREE_PUBLISHED };

/** A code in the historic table. */
export type HistoricCurrencyCode = keyof typeof HISTORIC_CURRENCY_TABLE;

/**
 * Every historic code, for the `CurrencyCode` type:
 *
 *     declare module '@ducatjs/money' {
 *       interface CustomCurrencies extends HistoricCurrencies {}
 *     }
 */
export type HistoricCurrencies = { readonly [Code in HistoricCurrencyCode]: true };

/** One entry of the historic table. */
export interface HistoricCurrency {
  readonly code: HistoricCurrencyCode;
  /** The name ISO 4217 List Three gives it (for non-ISO codes, a descriptive name). */
  readonly name: string;
  /** Its minor-unit exponent while it was current: what stored minor units of it mean. */
  readonly exponent: number;
  /** The ISO 4217 numeric code; absent for codes that were never ISO (CNH). */
  readonly numeric?: string;
  /**
   * The year and month ISO 4217 withdrew it ('2023-01'), from List Three. A code withdrawn
   * country by country has the last date. Absent for codes that were never ISO.
   */
  readonly withdrawn?: string;
}

const table: Readonly<Record<string, Omit<HistoricCurrency, 'code'>>> = HISTORIC_CURRENCY_TABLE;

/** The table entry for a code, or undefined for a code that isn't in it. */
export function historicCurrency(code: string): HistoricCurrency | undefined {
  // own properties only, so 'toString' and friends are not currencies
  if (!Object.hasOwn(table, code)) {
    return undefined;
  }
  return { code: code as HistoricCurrencyCode, ...table[code] };
}

/** Every entry of the table, by code. */
export function historicCurrencies(): HistoricCurrency[] {
  return Object.keys(table).map((code) => historicCurrency(code)!);
}

/**
 * Registers historic codes with `defineCurrency`, so Money can hold them: all of them, or only
 * `codes`. Registering one again is harmless; a code already defined with another exponent throws,
 * as `defineCurrency` does.
 */
export function defineHistoricCurrencies(codes?: readonly HistoricCurrencyCode[]): void {
  const selected: readonly string[] = codes ?? Object.keys(table);

  // check every code first, so a typo registers nothing
  for (const code of selected) {
    if (!Object.hasOwn(table, code)) {
      throw new RangeError(`${code} is not in the historic currency table`);
    }
  }

  for (const code of selected) {
    defineCurrency(code, table[code]!.exponent);
  }
}
