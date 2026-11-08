// Compile-time tests: `pnpm typecheck` must pass. Each @ts-expect-error must be an actual error.
import '../src/plugins/all.js';
import {
  add,
  assertCurrency,
  isMoneyIn,
  allocate,
  compare,
  convert,
  exchangeRate,
  fromMinor,
  money,
  sum,
  type Money,
} from '../src/fn.js';
import { z as zodLibrary } from 'zod';
import * as valibotLibrary from 'valibot';
import { moneySchema as zodMoney } from '../src/zod.js';
import { moneySchema as valibotMoney } from '../src/valibot.js';

const eur = money('1', 'EUR');
const usd = money('1', 'USD');

const ok: Money<'EUR'> = add(eur, eur);
// @ts-expect-error different currencies cannot be added
add(eur, usd);
// @ts-expect-error nor compared
compare(usd, eur);
// @ts-expect-error nor summed
sum([eur, usd]);
// @ts-expect-error a Money<'USD'> is not a Money<'EUR'>
const wrong: Money<'EUR'> = usd;

// runtime-typed currencies are allowed and checked at runtime
const dyn = fromMinor(100, 'EUR' as string);
add(dyn, dyn);

// conversion changes the type
const inUsd: Money<'USD'> = convert(eur, 'USD', '1.08', 'halfEven');
const rate = exchangeRate('EUR', 'USD', '1.08');
rate.convert(eur, 'halfEven');
// @ts-expect-error wrong source currency for the rate
rate.convert(usd, 'halfEven');

// allocation keeps the currency
const parts: Money<'EUR'>[] = allocate(eur, [1, 2]);

// @ts-expect-error minor is readonly
eur.minor = 5;

// @ts-expect-error not a known rounding mode
money('1.005', 'EUR', { rounding: 'halfUp' });

void ok;
void wrong;
void inUsd;
void parts;

// --- methods carry the same currency checks as the free functions
eur.add(eur);
// @ts-expect-error different currencies cannot be added via a method
eur.add(usd);
// @ts-expect-error nor compared
eur.compare(usd);
// @ts-expect-error nor allocated against a foreign increment
eur.chunk(usd);
const viaMethod: Money<'USD'> = eur.convert('USD', '1.08', 'halfEven');
const chained: Money<'EUR'> = eur.add(eur).multiply('1.075', 'halfEven').negate();
dyn.add(fromMinor(1, 'USD' as string)); // erased types: checked at runtime instead
// @ts-expect-error not a known rounding mode
eur.multiply('1.1', 'halfUp');
void viaMethod;
void chained;

// --- narrowing a runtime currency to a literal one
declare const unknownCurrency: Money<string>;
// @ts-expect-error a Money<string> is not known to be a Money<'EUR'>
const notYet: Money<'EUR'> = unknownCurrency;
if (isMoneyIn(unknownCurrency, 'EUR')) {
  const narrowed: Money<'EUR'> = unknownCurrency;
  void narrowed;
}
declare const fromUnknown: unknown;
if (isMoneyIn(fromUnknown, 'USD')) {
  const narrowedUnknown: Money<'USD'> = fromUnknown;
  void narrowedUnknown;
}
declare const asserted: Money<string>;
assertCurrency(asserted, 'EUR');
const afterAssert: Money<'EUR'> = asserted.add(eur);
void notYet;
void afterAssert;
// --- with() keeps the operation's result type
const withResult: Money<'EUR'> = eur.with((value) => value.negate());
const withString: string = eur.with((value) => value.toDecimal());
// @ts-expect-error the operation receives a Money<'EUR'>, not a Money<'USD'>
eur.with((value: Money<'USD'>) => value);
void withResult;
void withString;

// --- schema outputs are typed by the allowed currencies
const zodEur: Money<'EUR'> = zodLibrary.parse(zodMoney({ currency: 'EUR' }), {});
// @ts-expect-error a schema for EUR does not produce USD
const zodUsd: Money<'USD'> = zodLibrary.parse(zodMoney({ currency: 'EUR' }), {});
const valibotEither: Money<'EUR'> | Money<'USD'> = valibotLibrary.parse(
  valibotMoney({ currency: ['EUR', 'USD'] }),
  {},
);
const anyCurrency = zodLibrary.parse(zodMoney(), {});
// exactly Money<string>: assignable both ways
const anyCurrencyIsString: Money<string> = anyCurrency;
// @ts-expect-error a schema without currencies does not claim a literal one
const anyCurrencyIsEur: Money<'EUR'> = anyCurrency;
const zodEither: Money<'EUR'> | Money<'USD'> = zodLibrary.parse(
  zodMoney({ currency: ['EUR', 'USD'] }),
  {},
);
// @ts-expect-error not a single-currency Money
const zodEitherIsEur: Money<'EUR'> = zodLibrary.parse(zodMoney({ currency: ['EUR', 'USD'] }), {});
const valibotEur: Money<'EUR'> = valibotLibrary.parse(valibotMoney({ currency: 'EUR' }), {});
// @ts-expect-error a Valibot schema for EUR does not produce USD
const valibotUsd: Money<'USD'> = valibotLibrary.parse(valibotMoney({ currency: 'EUR' }), {});
const encoded: { amount: string; currency: string } = zodLibrary.encode(
  zodMoney({ currency: 'EUR' }),
  zodEur,
);
void anyCurrencyIsString;
void anyCurrencyIsEur;
void zodEither;
void zodEitherIsEur;
void valibotEur;
void valibotUsd;
void encoded;
void zodEur;
void zodUsd;
void valibotEither;
void anyCurrency;
