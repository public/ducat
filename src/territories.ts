/**
 * `@ducatjs/money/territories`: which currencies a territory uses and since when, from
 * CLDR. A separate entry from `@ducatjs/money/currencies` because the table is most of its size
 * (about 4.6 kB gzipped).
 */
import { CLDR_TERRITORY_CURRENCIES } from './generated/territories.js';

/** One currency a territory uses or used, from CLDR. */
export interface TerritoryCurrency {
  /** The ISO 4217 code. */
  readonly currency: string;
  /** The first day of use ('YYYY-MM-DD'), where CLDR gives one. */
  readonly from?: string;
  /** The last day of use, for a currency the territory no longer uses. */
  readonly to?: string;
  /** false for a code that isn't legal tender there, such as a fund code (CHE, USN, CLF). */
  readonly tender: boolean;
}

/** Options for `territoryCurrencies` and `currencyTerritories`. */
export interface TerritoryOptions {
  /**
   * Only the currencies in use on this day, 'YYYY-MM-DD': `{ on: '2001-06-01' }` gives both EUR
   * and DEM for Germany. Without it, every currency CLDR lists, current and past.
   */
  readonly on?: string;
  /** Whether to include codes that aren't legal tender (fund codes such as CHE); default false. */
  readonly includeNonTender?: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function readUse(use: readonly [string, (string | null)?, (string | null)?, boolean?]) {
  const [currency, from, to, tender] = use;
  const entry: { currency: string; from?: string; to?: string; tender: boolean } = {
    currency,
    tender: tender !== false,
  };
  if (typeof from === 'string') {
    entry.from = from;
  }
  if (typeof to === 'string') {
    entry.to = to;
  }
  return entry as TerritoryCurrency;
}

function isWanted(use: TerritoryCurrency, options: TerritoryOptions | undefined): boolean {
  if (!use.tender && options?.includeNonTender !== true) {
    return false;
  }
  const day = options?.on;
  if (day === undefined) {
    return true;
  }
  // 'YYYY-MM-DD' strings compare in date order; an unknown start counts as "always"
  return (use.from === undefined || use.from <= day) && (use.to === undefined || day <= use.to);
}

function checkOptions(options: TerritoryOptions | undefined): void {
  if (options?.on !== undefined && !DAY.test(options.on)) {
    throw new RangeError(`Invalid day ${options.on}; expected 'YYYY-MM-DD'`);
  }
}

/**
 * The currencies a territory (an ISO 3166 alpha-2 code such as 'DE') uses or has used, newest first,
 * with the days CLDR gives:
 *
 *     territoryCurrencies('DE')
 *     // [{ currency: 'EUR', from: '1999-01-01', tender: true },
 *     //  { currency: 'DEM', from: '1948-06-20', to: '2002-02-28', tender: true }]
 *     territoryCurrencies('DE', { on: '1990-01-01' }) // [DEM]
 *
 * Fund and accounting codes (CHE, USN) are left out unless `includeNonTender` is set. A territory
 * CLDR doesn't know gives an empty list.
 */
export function territoryCurrencies(
  territory: string,
  options?: TerritoryOptions,
): TerritoryCurrency[] {
  checkOptions(options);
  if (!Object.hasOwn(CLDR_TERRITORY_CURRENCIES, territory)) {
    return [];
  }
  return CLDR_TERRITORY_CURRENCIES[territory]!.map(readUse).filter((use) => isWanted(use, options));
}

/**
 * The territories that use or used a currency, in code order: `currencyTerritories('CHF')` is
 * `['CH', 'LI']`. With `{ on }`, only those using it on that day.
 */
export function currencyTerritories(currency: string, options?: TerritoryOptions): string[] {
  checkOptions(options);
  const territories: string[] = [];
  for (const [territory, uses] of Object.entries(CLDR_TERRITORY_CURRENCIES)) {
    if (uses.some((use) => use[0] === currency && isWanted(readUse(use), options))) {
      territories.push(territory);
    }
  }
  return territories;
}
