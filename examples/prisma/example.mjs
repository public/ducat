// End-to-end: write Money into both column styles, read it back as Money through a client extension.
import { PrismaClient, Prisma } from './generated/index.js';
import { money } from '../../dist/index.js';
import { add, toDecimal } from '../../dist/fn.js';
import { format } from '../../dist/plugins/format.js';
import {
  decimalMoneyField,
  minorMoneyField,
  toDecimalValue,
  toMinorColumns,
} from '../../dist/plugins/prisma.js';

const db = new PrismaClient().$extends({
  result: {
    order: {
      total: minorMoneyField('totalMinor', 'currency'),
      shippingMoney: decimalMoneyField('shipping', { currency: 'EUR' }),
    },
  },
});

await db.order.deleteMany();
const total = money('1234567.89', 'EUR');
await db.order.create({
  data: {
    ...toMinorColumns(total, 'totalMinor', 'currency'),
    shipping: toDecimalValue(money('4.95', 'EUR'), Prisma.Decimal),
  },
});
const order = await db.order.findFirstOrThrow();
const grand = add(order.total, order.shippingMoney);
console.log('total   ', order.total.toString(), typeof order.totalMinor);
console.log('shipping', order.shippingMoney.toString());
console.log('grand   ', format(grand, 'de-DE'));
if (toDecimal(grand) !== '1234572.84') throw new Error('round trip failed');
console.log('ok');
await db.$disconnect();
