// Reading rate cells from published files, shared by the source parsers so that every source
// handles missing values and stripped digits the same way.

// What sources write for "no value this day": blank (ECB CSV, BoE), ND (Fed H.10), N/A (ECB CSV),
// NA (IMF), and dashes and NaN in other files. Compared upper-cased.
const MISSING_MARKERS = new Set(['', 'ND', 'N/A', 'NA', 'N.A.', '-', '–', '—', 'NAN', 'NULL']);
const PLAIN_DECIMAL = /^\d+(?:\.\d+)?$/;

/**
 * @internal
 * A published rate cell: the decimal text, or null when the source marks the value as missing
 * (holidays, `ND`, `N/A`). Anything else throws SyntaxError: a cell that can't be read must not
 * look like "not quoted".
 */
export function readRateCell(cell: string, where: string): string | null {
  const text = cell.trim();
  if (MISSING_MARKERS.has(text.toUpperCase())) {
    return null;
  }
  if (!PLAIN_DECIMAL.test(text)) {
    throw new SyntaxError(`Not a rate: ${JSON.stringify(cell)} (${where})`);
  }
  return text;
}

/**
 * @internal
 * The published digits of a rate from a feed that strips trailing zeros, given the number of
 * decimals the publisher states: '1.175' with 4 decimals is '1.1750'. Text with more decimals than
 * stated is kept as it is, since dropping digits would change the rate.
 */
export function withDecimals(text: string, decimals: number): string {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 30) {
    throw new RangeError(`decimals must be an integer from 0 to 30, got ${decimals}`);
  }
  const point = text.indexOf('.');
  const present = point === -1 ? 0 : text.length - point - 1;
  if (present >= decimals) {
    return text;
  }
  const integerPart = point === -1 ? text : text.slice(0, point);
  const fraction = point === -1 ? '' : text.slice(point + 1);
  return `${integerPart}.${fraction.padEnd(decimals, '0')}`;
}
