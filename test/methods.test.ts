// Every Money method must be exactly the free function of the same name.
import '../src/plugins/all.js';
import { describe, expect, it } from 'vitest';
import { runs } from './fc-config.js';
import fc from 'fast-check';
import * as M from '../src/fn.js';
import { money, fromMinor, type Money } from '../src/fn.js';

const eur = (s: string) => money(s, 'EUR');
const dec = (x: Money | Money[] | { net: Money; tax: Money; gross: Money }) =>
  Array.isArray(x)
    ? x.map((m) => m.toDecimal())
    : 'net' in x
      ? [x.net, x.tax, x.gross].map((m) => m.toDecimal())
      : `${x.toDecimal()} ${x.currency} @${x.scale}`;

describe('Money methods', () => {
  it('chain like the README example', () => {
    const total = eur('19.99').add(eur('5.01')).multiply('1.075', 'halfEven');
    expect(total.toDecimal()).toBe('26.88');
    expect(total.split(3).map((m) => m.toDecimal())).toEqual(['8.96', '8.96', '8.96']);
    expect(total.allocate([1, 1, 1]).map(String)).toEqual(['8.96 EUR', '8.96 EUR', '8.96 EUR']);
    expect(eur('12').extractTax(20, 'halfEven').net.toDecimal()).toBe('10.00');
    expect(eur('25').convert('JPY', '162.457', 'halfEven').toDecimal()).toBe('4061');
    expect(eur('25').format('de-DE')).toBe('25,00 €');
  });

  it('cover every free function that takes a Money first', () => {
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(eur('1'))).filter(
      (k) => k !== 'constructor',
    );
    // free functions that are not methods, on purpose (constructors, parsers, tables, types)
    const notMethods = new Set([
      'money',
      'fromMinor',
      'zero',
      'fromJSON',
      'isMoney',
      // rounding policies: a constructor, and a check that throws rather than returning Money
      'roundingPolicy',
      'cashPolicy',
      'isoPolicy',
      // a price-ending rule constructor, like roundingPolicy
      'priceEnding',
      'assertScale',
      'isMoneyIn',
      'assertCurrency',
      'sum',
      // takes a list, like sum
      'average',
      'ratio',
      'parse',
      'parseMoney',
      'cashRule',
      // takes a currency code, not an amount
      'currencyDigits',
      // currency metadata: lookups by code, not by amount
      'cashUnit',
      'numericCode',
      'currencyFromNumeric',
      'minorUnit',
      'currencyName',
      'currencySymbol',
      'territoryCurrencies',
      // wire formats: readers take the format, and the writers stay functions, like the readers
      'toGoogleMoney',
      'fromGoogleMoney',
      'toIso20022Amount',
      'fromIso20022Amount',
      'toMinorUnits',
      'fromMinorUnits',
      'currencyTerritories',
      // the historic currency table: lookups and registration by code, not by amount
      'historicCurrency',
      'historicCurrencies',
      'defineHistoricCurrencies',
      // /finance: free functions only, by design (options-heavy calls read badly as methods)
      'yearFraction',
      'interest',
      'interestExact',
      'compound',
      'amortise',
      'npv',
      'npvExact',
      'discountedSum',
      'discountedSumExact',
      'irr',
      'prorate',
      'splitPeriod',
      // /pricing: takes a quantity and a tier table, not an amount
      'tieredPrice',
      'exchangeRate',
      // fixed-point constructors; Money#toFixedPoint covers moneyToFixed
      'fixed',
      'fromScaled',
      'isFixed',
      'moneyToFixed',
      // takes a Fixed first; Fixed#toMoney covers it
      'fixedToMoney',
      // rate constructors and the conversion kernel, which work on rates rather than an amount
      'impliedRate',
      'isRate',
      'rateFromJSON',
      'rateFromQuote',
      'multiplyByRatioAtScale',
      // rate providers and their combinators
      'rateOf',
      'identity',
      'rateTable',
      'chain',
      'reversed',
      'via',
      'snapshots',
      'snapshotsFrom',
      'rateHistory',
      'quotedTable',
      // exact intermediates: constructors, a batch sum, and a conversion that returns a record
      'convertDetailed',
      'sumExact',
      'isExactMoney',
      // multi-currency totals and ordering
      'bag',
      'comparator',
      'sortByValue',
      'sumByCurrency',
      // rate source parsers
      'parseEcbXml',
      'parseEcbCsv',
      'parseBankOfCanadaJson',
      'parseBankOfEnglandCsv',
      'parseHmrcMonthlyCsv',
      'parseFedH10Csv',
      'parseEcbSdmxCsv',
      'parseEcbSdmxDecimals',
      // processor rates, read from processor records rather than a Money
      'stripeRate',
      'stripeImpliedRate',
      'adyenRate',
      'currencyExponent',
      'defineCurrency',
      'isCurrency',
      'extendMoney',
      // processor and database helpers that take codes, amounts or columns rather than a Money
      'isStripeCurrency',
      'stripeExponent',
      'fromStripe',
      'isAdyenCurrency',
      'adyenExponent',
      'fromAdyen',
      'isCheckoutCurrency',
      'checkoutExponent',
      'fromCheckout',
      'isPayPalCurrency',
      'paypalExponent',
      'fromPayPal',
      'isBraintreeCurrency',
      'braintreeExponent',
      'fromBraintree',
      'isKlarnaCurrency',
      'klarnaExponent',
      'fromKlarna',
      'fromDecimal',
      'minorMoneyField',
      'decimalMoneyField',
      'toMinorColumns',
    ]);
    const fns = Object.entries(M)
      .filter(([k, v]) => typeof v === 'function' && /^[a-z]/.test(k) && !notMethods.has(k))
      .map(([k]) => k);
    expect(fns.filter((k) => !methods.includes(k))).toEqual([]);
  });

  const amount = fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n }).map((v) => fromMinor(v, 'EUR'));
  const factor = fc
    .tuple(fc.integer({ min: -10_000, max: 10_000 }), fc.integer({ min: 0, max: 4 }))
    .map(([n, s]) => (n / 10 ** s).toFixed(s));
  const mode = fc.constantFrom<M.RoundingMode>(
    'halfEven',
    'halfExpand',
    'floor',
    'ceil',
    'trunc',
    'expand',
    'halfTrunc',
    'halfCeil',
    'halfFloor',
  );

  it('agree with the free functions (property)', () => {
    fc.assert(
      fc.property(amount, amount, factor, mode, (a, b, f, r) => {
        expect(dec(a.add(b))).toBe(dec(M.add(a, b)));
        expect(dec(a.subtract(b))).toBe(dec(M.subtract(a, b)));
        expect(dec(a.multiply(f, r))).toBe(dec(M.multiply(a, f, r)));
        if (Number(f) !== 0) expect(dec(a.divide(f, r))).toBe(dec(M.divide(a, f, r)));
        expect(dec(a.percentage(f, r))).toBe(dec(M.percentage(a, f, r)));
        expect(dec(a.discount(f, r))).toBe(dec(M.discount(a, f, r)));
        if (Number(f) > -100) expect(dec(a.addTax(f, r))).toEqual(dec(M.addTax(a, f, r)));
        if (Number(f) > -100) expect(dec(a.extractTax(f, r))).toEqual(dec(M.extractTax(a, f, r)));
        if (Number(f) > 0) expect(dec(a.convert('JPY', f, r))).toBe(dec(M.convert(a, 'JPY', f, r)));
        expect(dec(a.round(r, 0))).toBe(dec(M.round(a, r, 0)));
        expect(dec(a.toScale(5))).toBe(dec(M.toScale(a, 5)));
        expect(dec(a.negate())).toBe(dec(M.negate(a)));
        expect(dec(a.abs())).toBe(dec(M.abs(a)));
        expect(dec(a.allocate([3, 1, 2]))).toEqual(dec(M.allocate(a, [3, 1, 2])));
        expect(dec(a.split(7))).toEqual(dec(M.split(a, 7)));
        expect(dec(a.instalments(4))).toEqual(dec(M.instalments(a, 4)));
        expect(dec(a.roundToIncrement(eur('0.05'), r))).toBe(
          dec(M.roundToIncrement(a, eur('0.05'), r)),
        );
        expect(a.compare(b)).toBe(M.compare(a, b));
        expect(a.equals(b)).toBe(M.equals(a, b));
        expect(a.lessThan(b)).toBe(M.lessThan(a, b));
        expect(a.lessThanOrEqual(b)).toBe(M.lessThanOrEqual(a, b));
        expect(a.greaterThan(b)).toBe(M.greaterThan(a, b));
        expect(a.greaterThanOrEqual(b)).toBe(M.greaterThanOrEqual(a, b));
        expect([a.isZero(), a.isPositive(), a.isNegative(), a.sign()]).toEqual([
          M.isZero(a),
          M.isPositive(a),
          M.isNegative(a),
          M.sign(a),
        ]);
        expect(dec(a.min(b))).toBe(dec(M.min(a, b)));
        expect(dec(a.max(b))).toBe(dec(M.max(a, b)));
        expect(a.toDecimal()).toBe(M.toDecimal(a));
        expect(a.toMinor()).toBe(M.toMinor(a));
        expect(a.format('en-US')).toBe(M.format(a, 'en-US'));
      }),
      { numRuns: runs(300) },
    );
  });

  it('keep the number/bigint representation invariant', () => {
    const big = money('125000000000000.00', 'USD'); // world GDP: 1.25e16 cents, beyond 2^53
    expect(typeof big.minor).toBe('bigint');
    expect(big.add(money('0.01', 'USD')).toDecimal()).toBe('125000000000000.01');
    const back = big.divide(1000, 'halfEven');
    expect(typeof back.minor).toBe('number');
    expect(() => big.toMinorNumber()).toThrow(RangeError);
  });

  it('check currencies at runtime when types are erased', () => {
    const a = fromMinor(100, 'EUR' as string),
      b = fromMinor(100, 'USD' as string);
    expect(() => a.add(b)).toThrow(M.CurrencyMismatchError);
    expect(() => a.compare(b)).toThrow(M.CurrencyMismatchError);
    expect(a.equals(b)).toBe(false);
  });

  it('does not accept bare numbers as operands', () => {
    // @ts-expect-error a number is neither major nor minor units here
    expect(() => eur('1').add(5)).toThrow(/Expected Money, got number/);
  });

  it('chunk, schedule, cashRound, clamp', () => {
    expect(
      eur('1000')
        .chunk(eur('300'))
        .map((m) => m.toDecimal()),
    ).toEqual(['300.00', '300.00', '300.00', '100.00']);
    expect(
      eur('1000')
        .schedule([{ percent: 30 }, { rest: true }])
        .map((m) => m.toDecimal()),
    ).toEqual(['300.00', '700.00']);
    expect(money('10.03', 'CHF').cashRound().toDecimal()).toBe('10.05');
    expect(eur('5').clamp(eur('1'), eur('3')).toDecimal()).toBe('3.00');
  });
});
