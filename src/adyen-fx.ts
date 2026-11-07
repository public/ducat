// Adyen exchange rates as exact Rates, from settlement details report rows.
import { exchangeRate, type Rate, type RateInfo } from './rate.js';

/** A settlement details report row, keyed by column name (as from a CSV parser with headers). */
export type AdyenSettlementRow = Readonly<Record<string, string | undefined>>;

/**
 * The rate in a settlement details report row: "The exchange rate used for converting the gross
 * amount into the net amount", Gross Currency → Net Currency (1 when they are the same). The decimal
 * string is kept exactly. `asOf` is the Creation Date's day: Adyen gives it in the account's time
 * zone, without an offset. `undefined` when the row has no rate. For externally settled payments
 * Adyen lists its reference rate, not the acquirer's, so check those with impliedRate().
 */
export function adyenRate(row: AdyenSettlementRow): Rate | undefined {
  const gross = row['Gross Currency'];
  const net = row['Net Currency'];
  const rate = row['Exchange Rate']?.trim();
  if (!gross || !net || !rate) {
    return undefined;
  }

  const created = row['Creation Date'];
  let info: RateInfo = { source: 'adyen' };
  if (created !== undefined && /^\d{4}-\d\d-\d\d/.test(created)) {
    info = { source: 'adyen', asOf: created.slice(0, 10) };
  }
  return exchangeRate(gross, net, rate, info);
}
