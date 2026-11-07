// One adapter per fixed-point decimal library, each using the library's own API. A rounding mode
// the library does not offer throws FixedNotSupported ("n/a"); it is never emulated.
//
// Versions are pinned exactly in compare/package.json and carried in the names below.
/* eslint-disable @typescript-eslint/no-explicit-any -- each library has its own value type */
import BigDecimalFormatjs from '@formatjs/bigdecimal';
import { Big as BigDecimalJava, RoundingMode as JavaRoundingMode } from 'bigdecimal.js';
import { Money as BigintMoney, Round as BigintRound } from 'bigint-money';
import * as dnum from 'dnum';
import { FixedNumber } from 'ethers';
import jsBigDecimal from 'js-big-decimal';
import {
  convert,
  divide,
  money,
  multiply,
  negate,
  ratio,
  toScale,
  type Money,
} from '../../src/fn.ts';
import { FixedNotSupported, type FixedLibrary, type FixedRounding } from './library.ts';

/** decimals written in a decimal string: "12.340" has 3 */
function fractionDigits(text: string): number {
  return (text.split('.')[1] ?? '').length;
}

// --- ducat Money --------------------------------------------------------------------------------

// Money always carries a currency; EUR with an explicit scale stands in for a plain decimal.
function ducatParse(text: string): Money {
  return money(text, 'EUR', { scale: fractionDigits(text) });
}

const ducatMoneyLibrary: FixedLibrary<Money> = {
  name: 'ducat Money',
  parse: ducatParse,
  add: (first, second) => first.add(second),
  multiply: (value, factor, scale, mode) => {
    // widen first so the product is exact, then round once to the target scale
    const widened = toScale(value, value.scale + fractionDigits(factor));
    const exactProduct = multiply(widened, factor, 'unnecessary');
    return toScale(exactProduct, scale, mode);
  },
  divide: (value, divisor, scale, mode) => {
    if (scale >= value.scale) {
      return divide(toScale(value, scale), divisor, mode);
    }
    // to a coarser scale than the dividend: convert() rounds once to any scale, at a positive rate
    const isNegativeDivisor = divisor.startsWith('-');
    const dividend = isNegativeDivisor ? negate(value) : value;
    const divisorMagnitude = isNegativeDivisor ? divisor.slice(1) : divisor;
    return convert(dividend, 'EUR', ratio(1, divisorMagnitude), mode, { scale });
  },
  round: (value, scale, mode) => toScale(value, scale, mode),
  compare: (first, second) => first.compare(second),
  toString: (value) => value.toDecimal(),
};

// --- dnum ---------------------------------------------------------------------------------------

/** dnum's ROUND_HALF rounds ties away from zero; it has no half-even */
function dnumRounding(mode: FixedRounding): 'ROUND_HALF' {
  if (mode !== 'halfExpand') {
    throw new FixedNotSupported('no half-even rounding');
  }
  return 'ROUND_HALF';
}

const dnumLibrary: FixedLibrary<dnum.Dnum> = {
  name: 'dnum 2.18.1',
  parse: (text) => dnum.from(text),
  add: (first, second) => dnum.add(first, second),
  multiply: (value, factor, scale, mode) =>
    dnum.multiply(value, dnum.from(factor), { decimals: scale, rounding: dnumRounding(mode) }),
  divide: (value, divisor, scale, mode) =>
    dnum.divide(value, dnum.from(divisor), { decimals: scale, rounding: dnumRounding(mode) }),
  round: (value, scale, mode) => dnum.setDecimals(value, scale, { rounding: dnumRounding(mode) }),
  compare: (first, second) => dnum.compare(first, second),
  toString: (value) => dnum.toString(value),
};

// --- ethers FixedNumber -------------------------------------------------------------------------

// 18 decimals in 128 bits, the library's default format; inputs here are far inside its range
const ETHERS_FORMAT = 'fixed128x18';

/** FixedNumber.round() rounds "up on ties"; it has no half-even */
function ethersRound(value: FixedNumber, scale: number, mode: FixedRounding): FixedNumber {
  if (mode !== 'halfExpand') {
    throw new FixedNotSupported('no half-even rounding');
  }
  return value.round(scale);
}

const ethersLibrary: FixedLibrary<FixedNumber> = {
  name: 'ethers FixedNumber 6.17.0',
  parse: (text) => FixedNumber.fromString(text, ETHERS_FORMAT),
  add: (first, second) => first.add(second),
  multiply: (value, factor, scale, mode) =>
    ethersRound(value.mul(FixedNumber.fromString(factor, ETHERS_FORMAT)), scale, mode),
  // div() works at the format's 18 decimals; round() then takes it to the target scale
  divide: (value, divisor, scale, mode) =>
    ethersRound(value.div(FixedNumber.fromString(divisor, ETHERS_FORMAT)), scale, mode),
  round: ethersRound,
  compare: (first, second) => first.cmp(second),
  toString: (value) => value.toString(),
};

// --- js-big-decimal (decimal strings in, decimal strings out) ----------------------------------

const JS_BIG_DECIMAL_MODES: Record<FixedRounding, unknown> = {
  halfEven: (jsBigDecimal as any).RoundingModes.HALF_EVEN,
  halfExpand: (jsBigDecimal as any).RoundingModes.HALF_UP,
};

const jsBigDecimalLibrary: FixedLibrary<string> = {
  name: 'js-big-decimal 2.2.0',
  // the instance parses; the static API then works on its decimal strings
  parse: (text) => new (jsBigDecimal as any)(text).getValue(),
  add: (first, second) => (jsBigDecimal as any).add(first, second),
  multiply: (value, factor, scale, mode) => {
    const exactProduct = (jsBigDecimal as any).multiply(value, factor);
    return (jsBigDecimal as any).round(exactProduct, scale, JS_BIG_DECIMAL_MODES[mode]);
  },
  divide: (value, divisor, scale, mode) =>
    (jsBigDecimal as any).divide(value, divisor, scale, JS_BIG_DECIMAL_MODES[mode]),
  round: (value, scale, mode) =>
    (jsBigDecimal as any).round(value, scale, JS_BIG_DECIMAL_MODES[mode]),
  compare: (first, second) => (jsBigDecimal as any).compareTo(first, second),
  toString: (value) => value,
};

// --- bigdecimal.js (Java BigDecimal semantics) --------------------------------------------------

const JAVA_MODES: Record<FixedRounding, JavaRoundingMode> = {
  halfEven: JavaRoundingMode.HALF_EVEN,
  halfExpand: JavaRoundingMode.HALF_UP,
};

const bigDecimalJsLibrary: FixedLibrary<any> = {
  name: 'bigdecimal.js 1.7.2',
  parse: (text) => BigDecimalJava(text),
  add: (first, second) => first.add(second),
  multiply: (value, factor, scale, mode) =>
    value.multiply(factor).setScale(scale, JAVA_MODES[mode]),
  divide: (value, divisor, scale, mode) => value.divide(divisor, scale, JAVA_MODES[mode]),
  round: (value, scale, mode) => value.setScale(scale, JAVA_MODES[mode]),
  compare: (first, second) => first.compareTo(second),
  toString: (value) => value.toPlainString(),
};

// --- @formatjs/bigdecimal -----------------------------------------------------------------------

// It has no way to round to a number of decimals (only floor and ceil to integers)
function noDecimalRounding(): never {
  throw new FixedNotSupported('no rounding to a number of decimals');
}

const formatjsLibrary: FixedLibrary<any> = {
  name: '@formatjs/bigdecimal 0.2.10',
  parse: (text) => new (BigDecimalFormatjs as any)(text),
  add: (first, second) => first.plus(second),
  multiply: noDecimalRounding,
  divide: noDecimalRounding,
  round: noDecimalRounding,
  compare: (first, second) => {
    if (first.eq(second)) {
      return 0;
    }
    return first.lessThan(second) ? -1 : 1;
  },
  toString: (value) => value.toString(),
};

// --- bigint-money -------------------------------------------------------------------------------

// A Money needs a currency code; the value is kept with the scale to print it at, since
// bigint-money stores 20 decimals internally and rounds only on output.
interface HeldMoney {
  readonly value: any;
  readonly scale: number;
}

const BIGINT_MONEY_CURRENCY = 'XXX';
const BIGINT_MONEY_MODES: Record<FixedRounding, unknown> = {
  halfEven: (BigintRound as any).HALF_TO_EVEN,
  halfExpand: (BigintRound as any).HALF_AWAY_FROM_0,
};

function roundBigintMoney(exact: any, scale: number, mode: FixedRounding): HeldMoney {
  const withMode = new (BigintMoney as any)(
    exact.toFixed(20),
    BIGINT_MONEY_CURRENCY,
    BIGINT_MONEY_MODES[mode],
  );
  const rounded = new (BigintMoney as any)(
    withMode.toFixed(scale),
    BIGINT_MONEY_CURRENCY,
    BIGINT_MONEY_MODES[mode],
  );
  return { value: rounded, scale };
}

const bigintMoneyLibrary: FixedLibrary<HeldMoney> = {
  name: 'bigint-money 2.0.1',
  parse: (text) => ({
    value: new (BigintMoney as any)(text, BIGINT_MONEY_CURRENCY, BIGINT_MONEY_MODES.halfEven),
    scale: fractionDigits(text),
  }),
  add: (first, second) => ({
    value: first.value.add(second.value),
    scale: Math.max(first.scale, second.scale),
  }),
  multiply: (held, factor, scale, mode) =>
    roundBigintMoney(held.value.multiply(factor), scale, mode),
  divide: (held, divisor, scale, mode) => roundBigintMoney(held.value.divide(divisor), scale, mode),
  round: (held, scale, mode) => roundBigintMoney(held.value, scale, mode),
  compare: (first, second) => first.value.compare(second.value),
  toString: (held) => held.value.toFixed(held.scale),
};

export const FIXED_LIBRARIES: FixedLibrary<any>[] = [
  ducatMoneyLibrary,
  dnumLibrary,
  ethersLibrary,
  jsBigDecimalLibrary,
  bigDecimalJsLibrary,
  formatjsLibrary,
  bigintMoneyLibrary,
];
