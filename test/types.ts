// Compile-time tests: `npm run typecheck` must pass. Each @ts-expect-error must be an actual error.
import { add, allocate, compare, convert, exchangeRate, fromMinor, money, sum, type Money } from '../src/index.js';

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

void ok; void wrong; void inUsd; void parts;

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
void viaMethod; void chained;
