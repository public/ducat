// A third-party plugin, written as a user writes one: `declare module` on the package's root entry,
// and `extendMoney`. test/plugin-types.test.ts type-checks this file.
import { expectTypeOf } from 'vitest';
import '../../src/plugins/allocate.js';
import { extendMoney, money, type Money } from '../../src/index.js';

const eur = money('10', 'EUR');
const usd = money('10', 'USD');
declare const anyCurrency: Money<string>;

declare module '../../src/index.js' {
  interface Money<C extends string> {
    half(): Money<C>;
    sameCurrencyAs(other: Money<C>): boolean;
  }
}
extendMoney({
  half(this: Money) {
    return this.divide(2);
  },
  sameCurrencyAs(this: Money, other: Money) {
    return this.currency === other.currency;
  },
});
expectTypeOf(eur.half()).toEqualTypeOf<Money<'EUR'>>();
expectTypeOf(eur.half().split(2)).toEqualTypeOf<Money<'EUR'>[]>();
expectTypeOf(anyCurrency.half()).toEqualTypeOf<Money<string>>();
eur.sameCurrencyAs(eur);
// @ts-expect-error the merged method's parameter uses the currency type too
eur.sameCurrencyAs(usd);
// @ts-expect-error a method nobody declared
eur.triple();
// @ts-expect-error extendMoney's methods must accept a Money as `this`
extendMoney({ broken(this: string) {} });
