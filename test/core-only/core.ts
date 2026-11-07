// Type-checked on its own (tsconfig.json here): without an opt-in module imported, its methods don't exist.
import { money } from '../../src/index.js';

const m = money('100', 'EUR');
m.add(m).multiply('1.075').toDecimal();
// @ts-expect-error allocate() needs @ducatjs/money/allocate
m.allocate([1, 1]);
// @ts-expect-error format() needs @ducatjs/money/format
m.format('en-GB');
// @ts-expect-error convert() needs @ducatjs/money/convert
m.convert('USD', '1.08');
