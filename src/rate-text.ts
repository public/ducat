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

/**
 * @internal
 * The records of a CSV file, RFC 4180 style: a cell may be quoted ("a, b", with "" for a quote),
 * and a quote anywhere else, or one left open, is a SyntaxError, so a stray quote can't swallow
 * the lines after it. Blank lines are skipped.
 */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  // 'start' of a cell, inside an unquoted one, inside quotes, or just after the closing quote
  let state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  const endRow = () => {
    row.push(cell);
    if (row.length > 1 || row[0]!.trim() !== '') {
      rows.push(row);
    }
    row = [];
    cell = '';
    state = 'start';
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (state === 'quoted') {
      if (char !== '"') {
        cell += char;
      } else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        state = 'closed';
      }
      continue;
    }
    if (char === ',') {
      row.push(cell);
      cell = '';
      state = 'start';
    } else if (char === '\n') {
      endRow();
    } else if (char === '\r' && text[i + 1] === '\n') {
      continue;
    } else if (char === '"' && state === 'start') {
      state = 'quoted';
    } else if (char === '"' || state === 'closed') {
      throw new SyntaxError(
        `Malformed CSV: unexpected ${JSON.stringify(char)} on line ${rows.length + 1}`,
      );
    } else {
      cell += char;
      state = 'plain';
    }
  }
  if (state === 'quoted') {
    throw new SyntaxError('Malformed CSV: a quoted cell is never closed');
  }
  if (cell !== '' || row.length > 0) {
    endRow();
  }
  return rows;
}
