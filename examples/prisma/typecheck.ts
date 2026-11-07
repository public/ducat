// Type-level check that the helpers fit Prisma's result-extension types: `npx tsc -p examples/prisma`.
import { PrismaClient } from './generated/index.js';
import type { Money } from '../../src/index.js';
import { add } from '../../src/index.js';
import { decimalMoneyField, minorMoneyField } from '../../src/prisma.js';

const db = new PrismaClient().$extends({
  result: {
    order: {
      total: minorMoneyField('totalMinor', 'currency'),
      shippingMoney: decimalMoneyField('shipping', { currency: 'EUR' }),
    },
  },
});
export async function check(): Promise<Money> {
  const o = await db.order.findFirstOrThrow();
  const t: Money = o.total;
  const s: Money<'EUR'> = o.shippingMoney;
  return add(t, s);
}
