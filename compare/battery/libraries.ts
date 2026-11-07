// One adapter per library, each using the library's own API the way its README teaches. Where a
// library lacks a capability the method is absent or throws NotSupported ("n/a" in the results):
// a missing capability is never emulated with our own code.
//
// Versions are pinned exactly in compare/package.json; the names below carry them so the results
// table always says what was measured.
/* eslint-disable @typescript-eslint/no-explicit-any -- each library has its own value type */
import { Decimal as PrismaDecimal } from '@prisma/client/runtime/index-browser';
import { Currencies as ScreenyCurrencies, Money as ScreenyMoney } from '@screeny05/ts-money';
import Big from 'big.js';
import { Money as BigintMoney, Round as BigintRound } from 'bigint-money';
import BigNumber from 'bignumber.js';
import currency from 'currency.js';
import Decimal from 'decimal.js';
import DecimalLight from 'decimal.js-light';
import Dinero1 from 'dinero-v1';
import * as Dinero2 from 'dinero.js';
import * as Dinero2Bigint from 'dinero.js/bigint';
import * as Dinero2BigintCurrencies from 'dinero.js/bigint/currencies';
import * as Dinero2Currencies from 'dinero.js/currencies';
import JsMoney from 'js-money';
import * as Monetra from 'monetra';
import moneyMath from 'money-math';
import TsMoneyPackage from 'ts-money';
import { ducatLibrary } from './ducat.ts';
import { NotSupported, type MoneyLibrary, type RoundingName } from './vectors.ts';

type AnyLibrary = MoneyLibrary<any>;

const { Money: TsMoney, Currencies: TsCurrencies } = TsMoneyPackage as any;

/**
 * ISO 4217 exponents, used only where a library makes the caller supply the scale (dinero.js 1,
 * currency.js, bigint-money and the decimal libraries). Those libraries get no credit for knowing
 * exponents: the exponent vectors report n/a for them.
 */
const ISO_EXPONENTS: Record<string, number> = {
  EUR: 2,
  USD: 2,
  GBP: 2,
  JPY: 0,
  KWD: 3,
  CLF: 4,
  ISK: 0,
};

/** Exact decimal string of integer minor units at `scale`. */
function minorToDecimal(minorUnits: number | bigint, scale: number): string {
  let magnitude = BigInt(minorUnits);
  const isNegative = magnitude < 0n;
  if (isNegative) {
    magnitude = -magnitude;
  }

  let digits = magnitude.toString().padStart(scale + 1, '0');
  if (scale > 0) {
    digits = digits.slice(0, -scale) + '.' + digits.slice(-scale);
  }
  return isNegative ? '-' + digits : digits;
}

// --- dinero.js 2 (number and bigint calculators) -------------------------------------------------

function dinero2Library(api: any, currencies: any, usesBigint: boolean, name: string): AnyLibrary {
  const toNumeric = usesBigint ? BigInt : Number;

  function currencyNamed(code: string): any {
    const definition = currencies[code];
    if (!definition) {
      throw new NotSupported(`no ${code} in dinero.js/currencies`);
    }
    return definition;
  }

  /** dinero has no parser; its docs show decimals as a scaled amount { amount, scale } */
  function scaledAmount(decimal: string): { amount: number | bigint; scale: number | bigint } {
    const isNegative = decimal.startsWith('-');
    const [integerPart, fractionPart = ''] = decimal.replace('-', '').split('.');
    const magnitude = toNumeric(integerPart + fractionPart);
    return {
      amount: isNegative ? -magnitude : magnitude,
      scale: toNumeric(fractionPart.length),
    };
  }

  const roundingFunctions: Record<RoundingName, unknown> = {
    halfEven: api.halfEven,
    halfExpand: api.halfAwayFromZero,
  };

  function toCurrencyScale(value: any, code: string, mode: RoundingName): any {
    return api.transformScale(value, currencyNamed(code).exponent, roundingFunctions[mode]);
  }

  return {
    name,
    fromDecimal: (decimal, code) => {
      const { amount, scale } = scaledAmount(decimal);
      return api.dinero({ amount, currency: currencyNamed(code), scale });
    },
    fromMinor: (minorUnits, code) => api.dinero({ amount: toNumeric(minorUnits), currency: currencyNamed(code) }),
    toDecimal: (value) => api.toDecimal(value),
    add: api.add,
    subtract: api.subtract,
    multiply: (value, factor, mode) => {
      const product = api.multiply(value, scaledAmount(factor));
      return toCurrencyScale(product, api.toSnapshot(value).currency.code, mode);
    },
    // dinero.js 2 has no divide(): only multiplication by a scaled amount
    allocate: (value, weights) => api.allocate(value, weights.map(toNumeric)),
    split: (value, count) =>
      api.allocate(
        value,
        Array.from({ length: count }, () => toNumeric(1)),
      ),
    convert: (value, target, rate, mode) => {
      const converted = api.convert(value, currencyNamed(target), { [target]: scaledAmount(rate) });
      return toCurrencyScale(converted, target, mode);
    },
    compare: (first, second) => Number(api.compare(first, second)),
    equals: api.equal,
    exponent: (code) => Number(currencyNamed(code).exponent),
  };
}

// --- dinero.js 1 ---------------------------------------------------------------------------------

const DINERO1_ROUNDING: Record<RoundingName, string> = {
  halfEven: 'HALF_EVEN',
  halfExpand: 'HALF_AWAY_FROM_ZERO',
};

const dinero1Library: AnyLibrary = {
  name: 'dinero.js 1.9.1',
  // the precision is caller-supplied: dinero.js 1 has no exponent table (2 for every currency)
  fromMinor: (minorUnits, code) =>
    (Dinero1 as any)({ amount: minorUnits, currency: code, precision: ISO_EXPONENTS[code] }),
  toDecimal: (value) => minorToDecimal(value.getAmount(), value.getPrecision()),
  add: (first, second) => first.add(second),
  subtract: (first, second) => first.subtract(second),
  multiply: (value, factor, mode) => value.multiply(Number(factor), DINERO1_ROUNDING[mode]),
  divide: (value, divisor, mode) => value.divide(Number(divisor), DINERO1_ROUNDING[mode]),
  allocate: (value, weights) => value.allocate(weights),
  split: (value, count) => value.allocate(Array.from({ length: count }, () => 1)),
  // its convert() fetches rates over HTTP, so there is no offline conversion to test
  compare: (first, second) => {
    if (first.lessThan(second)) {
      return -1;
    }
    return first.equalsTo(second) ? 0 : 1;
  },
  equals: (first, second) => first.equalsTo(second),
};

// --- currency.js ---------------------------------------------------------------------------------

// A currency.js value carries only a precision, no currency code. The code is kept beside it so the
// battery can ask for mismatches, but currency.js itself never sees it.
function currencyJsValue(code: string, amount: unknown, options: object = {}): any {
  const value = (currency as any)(amount, { precision: ISO_EXPONENTS[code], ...options });
  return Object.assign(value, { code });
}

function onlyHalfUp(mode: RoundingName): void {
  if (mode !== 'halfExpand') {
    throw new NotSupported('no rounding modes');
  }
}

const currencyJsLibrary: AnyLibrary = {
  name: 'currency.js 2.0.4',
  hasNoCurrency: true,
  fromDecimal: (decimal, code) => currencyJsValue(code, decimal),
  fromFloat: (amount, code) => currencyJsValue(code, amount),
  fromMinor: (minorUnits, code) => currencyJsValue(code, minorUnits, { fromCents: true }),
  toDecimal: (value) => value.toString(),
  add: (first, second) => Object.assign(first.add(second), { code: first.code }),
  subtract: (first, second) => Object.assign(first.subtract(second), { code: first.code }),
  multiply: (value, factor, mode) => {
    onlyHalfUp(mode);
    return Object.assign(value.multiply(Number(factor)), { code: value.code });
  },
  divide: (value, divisor, mode) => {
    onlyHalfUp(mode);
    return Object.assign(value.divide(Number(divisor)), { code: value.code });
  },
  split: (value, count) => value.distribute(count),
  compare: (first, second) => Math.sign(first.value - second.value),
  equals: (first, second) => first.value === second.value,
};

// --- js-money, ts-money, @screeny05/ts-money (Fowler-style money, number minor units) ------------

// These take a rounding *function*; we pass correct ones, which is the API's intended use. The
// product being rounded is still computed by the library as a float (amount * factor).
const ROUNDING_FUNCTIONS: Record<RoundingName, (value: number) => number> = {
  halfExpand: (value) => Math.sign(value) * Math.round(Math.abs(value)),
  halfEven: (value) => {
    const floor = Math.floor(value);
    const fraction = value - floor;
    if (fraction > 0.5) {
      return floor + 1;
    }
    if (fraction < 0.5) {
      return floor;
    }
    return floor % 2 === 0 ? floor : floor + 1;
  },
};

function fowlerLibrary(Money: any, currencies: any, name: string): AnyLibrary {
  function currencyNamed(code: string): any {
    const definition = currencies[code];
    if (!definition) {
      throw new NotSupported(`no ${code} in currency table`);
    }
    return definition;
  }

  return {
    name,
    // the number API, as their READMEs pass numbers
    fromDecimal: (decimal, code) => Money.fromDecimal(Number(decimal), currencyNamed(code)),
    fromFloat: (amount, code) => Money.fromDecimal(amount, currencyNamed(code)),
    fromMinor: (minorUnits, code) => new Money(minorUnits, currencyNamed(code)),
    toDecimal: (value) => value.toString(),
    add: (first, second) => first.add(second),
    subtract: (first, second) => first.subtract(second),
    multiply: (value, factor, mode) => value.multiply(Number(factor), ROUNDING_FUNCTIONS[mode]),
    divide: (value, divisor, mode) => value.divide(Number(divisor), ROUNDING_FUNCTIONS[mode]),
    allocate: (value, weights) => value.allocate(weights),
    split: (value, count) => value.allocate(Array.from({ length: count }, () => 1)),
    compare: (first, second) => first.compare(second),
    equals: (first, second) => first.equals(second),
    exponent: (code) => currencyNamed(code).decimal_digits,
  };
}

// --- money-math (strings "x.yy", 2 decimals only) ------------------------------------------------

function onlyTwoDecimalCurrencies(code: string): void {
  if (ISO_EXPONENTS[code] !== 2) {
    throw new NotSupported('2-decimal amounts only');
  }
}

function moneyMathFactor(text: string, what: string): void {
  if (!/^\d+\.\d\d$/.test(text)) {
    throw new NotSupported(`${what} must be an x.yy amount`);
  }
}

const moneyMathLibrary: AnyLibrary = {
  name: 'money-math 2.6.3',
  hasNoCurrency: true,
  fromDecimal: (decimal, code) => {
    onlyTwoDecimalCurrencies(code);
    if (!/^-?\d+\.\d\d$/.test(decimal)) {
      throw new NotSupported('needs exactly 2 decimals');
    }
    return decimal;
  },
  fromFloat: (amount, code) => {
    onlyTwoDecimalCurrencies(code);
    return (moneyMath as any).floatToAmount(amount);
  },
  toDecimal: (value) => value,
  add: (moneyMath as any).add,
  subtract: (moneyMath as any).subtract,
  multiply: (value, factor, mode) => {
    if (mode !== 'halfExpand') {
      throw new NotSupported('fixed half-up');
    }
    moneyMathFactor(factor, 'factor');
    return (moneyMath as any).mul(value, factor);
  },
  divide: (value, divisor, mode) => {
    if (mode !== 'halfExpand') {
      throw new NotSupported('fixed half-up');
    }
    moneyMathFactor(divisor, 'divisor');
    return (moneyMath as any).div(value, divisor);
  },
  compare: (moneyMath as any).cmp,
  equals: (moneyMath as any).isEqual,
};

// --- monetra -------------------------------------------------------------------------------------

const MONETRA_ROUNDING: Record<RoundingName, unknown> = {
  halfEven: (Monetra as any).RoundingMode.HALF_EVEN,
  halfExpand: (Monetra as any).RoundingMode.HALF_UP,
};

const monetraLibrary: AnyLibrary = {
  name: 'monetra 2.3.0',
  fromDecimal: (decimal, code) => (Monetra as any).Money.fromMajor(decimal, code),
  fromFloat: (amount, code) => (Monetra as any).Money.fromFloat(amount, code),
  fromMinor: (minorUnits, code) => (Monetra as any).Money.fromMinor(minorUnits, code),
  toDecimal: (value) => value.toDecimalString(),
  add: (first, second) => first.add(second),
  subtract: (first, second) => first.subtract(second),
  multiply: (value, factor, mode) => value.multiply(factor, { rounding: MONETRA_ROUNDING[mode] }),
  divide: (value, divisor, mode) => value.divide(divisor, { rounding: MONETRA_ROUNDING[mode] }),
  allocate: (value, weights) => value.allocate(weights),
  split: (value, count) => value.split(count),
  compare: (first, second) => first.compare(second),
  equals: (first, second) => first.equals(second),
  exponent: (code) => (Monetra as any).getCurrency(code).decimals,
};

// --- bigint-money (fixed 20-digit internal precision, rounding on output) ------------------------

const BIGINT_MONEY_ROUNDING: Record<RoundingName, unknown> = {
  halfEven: (BigintRound as any).HALF_TO_EVEN,
  halfExpand: (BigintRound as any).HALF_AWAY_FROM_0,
};

/** bigint-money keeps 20 fraction digits; rounding to the currency happens in toFixed(digits) */
function roundBigintMoney(exact: any, code: string, mode: RoundingName): any {
  const rounding = BIGINT_MONEY_ROUNDING[mode];
  const atFullPrecision = new (BigintMoney as any)(exact.toFixed(20), code, rounding);
  return new (BigintMoney as any)(atFullPrecision.toFixed(ISO_EXPONENTS[code]), code, rounding);
}

const bigintMoneyLibrary: AnyLibrary = {
  name: 'bigint-money 2.0.1',
  hasNoExponentTable: true,
  fromDecimal: (decimal, code) => new (BigintMoney as any)(decimal, code, (BigintRound as any).HALF_TO_EVEN),
  fromFloat: (amount, code) => new (BigintMoney as any)(amount, code, (BigintRound as any).HALF_TO_EVEN),
  // the output precision is caller-supplied
  toDecimal: (value) => value.toFixed(ISO_EXPONENTS[value.currency]),
  add: (first, second) => first.add(second),
  subtract: (first, second) => first.subtract(second),
  multiply: (value, factor, mode) => roundBigintMoney(value.multiply(factor), value.currency, mode),
  divide: (value, divisor, mode) => roundBigintMoney(value.divide(divisor), value.currency, mode),
  split: (value, count) => value.allocate(count, ISO_EXPONENTS[value.currency]),
  compare: (first, second) => first.compare(second),
  equals: (first, second) => first.isEqual(second),
};

// --- decimal libraries: a value plus a currency code the caller carries -------------------------

interface DecimalOperations {
  create(amount: string | number): any;
  roundTo(value: any, decimals: number, mode: RoundingName): any;
  toFixed(value: any, decimals: number): string;
}

function decimalLibrary(name: string, operations: DecimalOperations): AnyLibrary {
  const { create, roundTo, toFixed } = operations;

  function withCode(value: any, code: string): { value: any; code: string } {
    return { value, code };
  }

  return {
    name,
    isDecimalLibrary: true,
    hasNoCurrency: true,
    fromDecimal: (decimal, code) => withCode(create(decimal), code),
    fromFloat: (amount, code) => withCode(create(amount), code),
    toDecimal: (held) => toFixed(held.value, ISO_EXPONENTS[held.code]!),
    add: (first, second) => withCode(first.value.plus(second.value), first.code),
    subtract: (first, second) => withCode(first.value.minus(second.value), first.code),
    multiply: (held, factor, mode) => {
      const product = held.value.times(factor);
      return withCode(roundTo(product, ISO_EXPONENTS[held.code]!, mode), held.code);
    },
    divide: (held, divisor, mode) => {
      const quotient = held.value.div(divisor);
      return withCode(roundTo(quotient, ISO_EXPONENTS[held.code]!, mode), held.code);
    },
    convert: (held, target, rate, mode) => {
      const converted = held.value.times(rate);
      return withCode(roundTo(converted, ISO_EXPONENTS[target]!, mode), target);
    },
    compare: (first, second) => first.value.cmp(second.value),
    equals: (first, second) => first.value.eq(second.value),
  };
}

/** decimal.js, decimal.js-light and Prisma.Decimal share one API */
function decimalJsFamily(DecimalClass: any, name: string): AnyLibrary {
  const modes: Record<RoundingName, number> = {
    halfEven: DecimalClass.ROUND_HALF_EVEN,
    halfExpand: DecimalClass.ROUND_HALF_UP,
  };
  return decimalLibrary(name, {
    create: (amount) => new DecimalClass(amount),
    roundTo: (value, decimals, mode) => value.toDecimalPlaces(decimals, modes[mode]),
    toFixed: (value, decimals) => value.toFixed(decimals),
  });
}

const bigJsModes: Record<RoundingName, number> = {
  halfEven: (Big as any).roundHalfEven,
  halfExpand: (Big as any).roundHalfUp,
};

const bigNumberModes: Record<RoundingName, number> = {
  halfEven: BigNumber.ROUND_HALF_EVEN,
  halfExpand: BigNumber.ROUND_HALF_UP,
};

export const LIBRARIES: AnyLibrary[] = [
  ducatLibrary,
  dinero2Library(Dinero2, Dinero2Currencies, false, 'dinero.js 2.0.2'),
  dinero2Library(Dinero2Bigint, Dinero2BigintCurrencies, true, 'dinero.js 2.0.2 bigint'),
  dinero1Library,
  currencyJsLibrary,
  fowlerLibrary(JsMoney, JsMoney, 'js-money 0.6.3'),
  fowlerLibrary(TsMoney, TsCurrencies, 'ts-money 0.4.8'),
  fowlerLibrary(ScreenyMoney, ScreenyCurrencies, '@screeny05/ts-money 1.2.0'),
  moneyMathLibrary,
  monetraLibrary,
  bigintMoneyLibrary,
  decimalLibrary('big.js 7.0.1', {
    create: (amount) => new Big(amount),
    roundTo: (value, decimals, mode) => value.round(decimals, bigJsModes[mode]),
    toFixed: (value, decimals) => value.toFixed(decimals),
  }),
  decimalLibrary('bignumber.js 11.1.5', {
    create: (amount) => new BigNumber(amount),
    roundTo: (value, decimals, mode) => value.decimalPlaces(decimals, bigNumberModes[mode]),
    toFixed: (value, decimals) => value.toFixed(decimals),
  }),
  decimalJsFamily(Decimal, 'decimal.js 10.6.0'),
  decimalJsFamily(DecimalLight, 'decimal.js-light 2.5.1'),
  decimalJsFamily(PrismaDecimal, 'Prisma.Decimal 7.10.1'),
];
