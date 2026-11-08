/**
 * `@ducatjs/money/zod`: Zod schemas for the JSON form of Money, `{ "amount": "12.34", "currency":
 * "EUR" }`, for API boundaries. Zod is an optional peer dependency: only this entry imports it.
 */
import { z } from 'zod';
import { isMoney, type Money, type MoneyJSON } from './money.js';
import { readMoneyJSON, type MoneyFor, type MoneySchemaOptions } from './schema.js';

export type { MoneyFor, MoneySchemaOptions } from './schema.js';

const jsonShape = z.object({ amount: z.string(), currency: z.string() });

/**
 * Parses `{ amount, currency }` into Money. The amount must be an exact decimal string with no
 * more decimals than the currency allows (unless `rounding` is given), and the currency must be
 * one of `currency` (or any known code). Problems are reported as Zod issues on `amount` or
 * `currency`.
 *
 *     const Order = z.object({ total: moneySchema({ currency: 'EUR' }) })
 *     Order.parse({ total: { amount: '12.34', currency: 'EUR' } }).total   // Money<'EUR'>
 */
export function moneySchema<C extends string = string>(
  options?: MoneySchemaOptions<C>,
): z.ZodType<MoneyFor<C>, MoneyJSON> {
  return jsonShape.transform((json, context) => {
    const result = readMoneyJSON(json, options);
    if (isMoney(result)) {
      return result as Money as MoneyFor<C>;
    }
    context.addIssue({ code: 'custom', message: result.message, path: [result.field] });
    return z.NEVER;
  });
}

/**
 * Like `moneySchema`, but the output stays the JSON object: it checks that the input would parse,
 * for code that passes the JSON on rather than computing with it.
 */
export function moneyJSONSchema<C extends string = string>(
  options?: MoneySchemaOptions<C>,
): z.ZodType<MoneyJSON<C>, MoneyJSON> {
  return jsonShape.transform((json, context) => {
    const result = readMoneyJSON(json, options);
    if (isMoney(result)) {
      return json as MoneyJSON<C>;
    }
    context.addIssue({ code: 'custom', message: result.message, path: [result.field] });
    return z.NEVER;
  });
}
