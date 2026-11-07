// Engine smoke test: no test framework, bundled by scripts/smoke-runtimes.mjs and run on every engine
// (Node 18+, Deno, Bun, SpiderMonkey and JavaScriptCore shells) to catch engine-specific behaviour.
import * as M from '../src/index.ts';
import { toStripeAmount } from '../src/stripe.ts';
import { toAdyen } from '../src/adyen.ts';
import { toCheckoutAmount } from '../src/checkout.ts';
import { log, runtimeName } from '../bench/harness.ts';

let failures = 0,
  passed = 0;
function eq(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual, (_, v) => (typeof v === 'bigint' ? `${v}n` : v));
  const e = JSON.stringify(expected, (_, v) => (typeof v === 'bigint' ? `${v}n` : v));
  if (a !== e) {
    failures++;
    log(`FAIL ${what}: got ${a}, want ${e}`);
  } else passed++;
}
const d = M.toDecimal;
const eur = (s: string) => M.money(s, 'EUR');

eq(d(M.add(eur('0.10'), eur('0.20'))), '0.30', 'add');
eq(
  M.add(M.fromMinor(Number.MAX_SAFE_INTEGER, 'EUR'), M.fromMinor(1, 'EUR')).minor,
  9007199254740992n,
  'overflow to bigint',
);
eq(d(M.multiply(eur('10.00'), '1.075', 'halfEven')), '10.75', 'multiply');
eq(d(M.round(M.money('2.5', 'JPY', { scale: 1 }), 'halfEven')), '2', 'halfEven');
eq(d(M.round(M.money('-2.5', 'JPY', { scale: 1 }), 'halfExpand')), '-3', 'halfExpand');
eq(M.allocate(eur('100'), [1, 1, 1]).map(d), ['33.34', '33.33', '33.33'], 'allocate');
eq(M.instalments(eur('100'), 6).map(d)[0], '16.70', 'instalments');
eq(d(M.extractTax(M.money('12', 'GBP'), 20, 'halfEven').net), '10.00', 'VAT');
eq(d(M.convert(eur('100'), 'JPY', '162.457', 'halfEven')), '16246', 'convert');
eq(d(M.cashRound(M.money('10.03', 'CHF'))), '10.05', 'cash CHF');
eq(toStripeAmount(M.money('5', 'ISK')), 500, 'stripe ISK');
eq(toAdyen(M.money('15000', 'IDR')).value, 15000, 'adyen IDR');
eq(toCheckoutAmount(M.money('5000', 'CLP')), 500000, 'checkout CLP');
eq(JSON.stringify(eur('12.34')), '{"amount":"12.34","currency":"EUR"}', 'json');
const n = (s: string) => s.replace(/[  ]/g, ' ');
eq(n(M.format(eur('1234.5'), 'de-DE')), '1.234,50 €', 'format de-DE');
eq(M.format(M.money('1234', 'JPY'), 'en-US'), '¥1,234', 'format JPY');
eq(
  M.format(M.money('1', 'ALL'), 'en-US', { currencyDisplay: 'code' }).replace(/\s/g, ' '),
  'ALL 1.00',
  'format uses ISO digits not CLDR',
);
eq(M.parse('1.234,50 €', 'EUR', 'de-DE').minor, 123450, 'parse de-DE');
eq(M.parse('($5.00)', 'USD', 'en-US').minor, -500, 'parse accounting');
let threw = false;
try {
  void ((eur('1') as unknown as number) + 1);
} catch {
  threw = true;
}
eq(threw, true, 'toPrimitive guard');
// string input to Intl (exact beyond 2^53) - informational
const big = M.format(M.money('123456789012345678.91', 'USD'), 'en-US');
log(
  `${runtimeName()}: ${passed} passed, ${failures} failed; Intl string input ${big === '$123,456,789,012,345,678.91' ? 'exact' : 'NOT exact (' + big + ')'}`,
);
if (failures) throw new Error(`${failures} smoke failures`);
