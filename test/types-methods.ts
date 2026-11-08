// Compile-time tests for the methods API: `pnpm typecheck` must pass, and each @ts-expect-error must
// be a real error. Each plugin's methods keep the currency type parameter. A user's own plugin is
// checked separately (test/plugin-types.test.ts).
import { expectTypeOf } from 'vitest';
import '../src/plugins/all.js';
import { money, type Money } from '../src/index.js';
import { exchangeRate } from '../src/fn.js';
import type { ExactMoney } from '../src/exact.js';
import type { Fixed } from '../src/fixed.js';
import type { TaxBreakdown } from '../src/tax.js';

const eur = money('10', 'EUR');
const usd = money('10', 'USD');
declare const anyCurrency: Money<string>;

// --- core methods keep the currency
expectTypeOf(eur.add(eur)).toEqualTypeOf<Money<'EUR'>>();
expectTypeOf(eur.multiply('1.075', 'halfEven')).toEqualTypeOf<Money<'EUR'>>();
expectTypeOf(eur.divide(3)).toEqualTypeOf<Money<'EUR'>>();
expectTypeOf(eur.negate().abs().round('halfEven')).toEqualTypeOf<Money<'EUR'>>();
expectTypeOf(eur.min(eur, eur)).toEqualTypeOf<Money<'EUR'>>();
expectTypeOf(eur.compare(eur)).toEqualTypeOf<-1 | 0 | 1>();
expectTypeOf(eur.toDecimal()).toEqualTypeOf<string>();
expectTypeOf(anyCurrency.add(anyCurrency)).toEqualTypeOf<Money<string>>();
// @ts-expect-error a method checks the other operand's currency
eur.subtract(usd);
// @ts-expect-error min too
eur.min(eur, usd);
// @ts-expect-error and clamp's bounds
eur.clamp(usd, eur);

// --- allocate
expectTypeOf(eur.allocate([1, 2])).toEqualTypeOf<Money<'EUR'>[]>();
expectTypeOf(eur.split(3)).toEqualTypeOf<Money<'EUR'>[]>();
expectTypeOf(eur.instalments(3)).toEqualTypeOf<Money<'EUR'>[]>();
expectTypeOf(eur.chunk(money('3', 'EUR'))).toEqualTypeOf<Money<'EUR'>[]>();
// @ts-expect-error a tranche in another currency
eur.schedule([{ amount: usd }]);
// @ts-expect-error a chunk size in another currency
eur.chunk(usd);

// --- tax
expectTypeOf(eur.percentage('20')).toEqualTypeOf<Money<'EUR'>>();
expectTypeOf(eur.discount('15')).toEqualTypeOf<Money<'EUR'>>();
expectTypeOf(eur.addTax('20')).toEqualTypeOf<TaxBreakdown<'EUR'>>();
expectTypeOf(eur.extractTax('20').net).toEqualTypeOf<Money<'EUR'>>();

// --- convert: the target currency comes from the rate or the code
const eurUsd = exchangeRate('EUR', 'USD', '1.0832');
expectTypeOf(eur.convert(eurUsd, 'halfEven')).toEqualTypeOf<Money<'USD'>>();
expectTypeOf(eur.convert('JPY', '162.457')).toEqualTypeOf<Money<'JPY'>>();
// @ts-expect-error a USD → … rate cannot convert EUR
eur.convert(exchangeRate('USD', 'JPY', '150'));

// --- cash, exact and fixed
expectTypeOf(eur.cashRound()).toEqualTypeOf<Money<'EUR'>>();
expectTypeOf(eur.roundToIncrement(money('0.05', 'EUR'))).toEqualTypeOf<Money<'EUR'>>();
// @ts-expect-error an increment in another currency
eur.roundToIncrement(money('0.05', 'USD'));
expectTypeOf(eur.exact()).toEqualTypeOf<ExactMoney<'EUR'>>();
expectTypeOf(eur.toFixedPoint()).toEqualTypeOf<Fixed>();

// --- format and processors
expectTypeOf(eur.format('de-DE')).toEqualTypeOf<string>();
expectTypeOf(eur.formatToParts('de-DE')).toEqualTypeOf<Intl.NumberFormatPart[]>();
expectTypeOf(eur.toStripeAmount()).toEqualTypeOf<number>();
expectTypeOf(eur.toStripe()).toEqualTypeOf<{ amount: number; currency: string }>();
expectTypeOf(eur.toAdyen()).toEqualTypeOf<{ value: number; currency: string }>();
expectTypeOf(eur.toCheckout()).toEqualTypeOf<{ amount: number; currency: string }>();
expectTypeOf(eur.toPayPal()).toEqualTypeOf<{ currency_code: string; value: string }>();
expectTypeOf(eur.toBraintree()).toEqualTypeOf<string>();
expectTypeOf(eur.toKlarna()).toEqualTypeOf<number>();
