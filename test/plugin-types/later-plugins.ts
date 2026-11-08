// Loads modules that test/plugin-types/plugin.ts doesn't, in a file the type checker reads after the
// user's augmentation of Money. Both the user's methods and every module's must be on Money:
// test/plugin-types.test.ts checks this file with plugin.ts in both orders.
import { expectTypeOf } from 'vitest';
import { money, type Money } from '../../src/index.js';
import '../../src/plugins/math.js';
import '../../src/plugins/tax.js';
import '../../src/plugins/cash.js';
import '../../src/plugins/format.js';
import type { TaxBreakdown } from '../../src/tax.js';

const price = money('10', 'EUR');
expectTypeOf(price.half()).toEqualTypeOf<Money<'EUR'>>();
expectTypeOf(price.percentage(10)).toEqualTypeOf<Money<'EUR'>>();
expectTypeOf(price.remainder(money('3', 'EUR'))).toEqualTypeOf<Money<'EUR'>>();
expectTypeOf(price.addTax(20)).toEqualTypeOf<TaxBreakdown<'EUR'>>();
expectTypeOf(price.cashRound()).toEqualTypeOf<Money<'EUR'>>();
expectTypeOf(price.format('de-DE')).toEqualTypeOf<string>();
expectTypeOf(price.half().trimScale().split(2)).toEqualTypeOf<Money<'EUR'>[]>();
