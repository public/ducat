/**
 * `@ducatjs/money/zod`: Zod schemas for the JSON form of Money, `{ "amount": "12.34", "currency":
 * "EUR" }`, for API boundaries. Zod is an optional peer dependency: only this entry imports it.
 */
import { z } from 'zod';
import { isMoney, type Money, type MoneyJSON } from './money.js';
import {
  checkSchemaOptions,
  readMoneyJSON,
  type MoneyFor,
  type MoneySchemaOptions,
} from './schema.js';

export type { MoneyFor, MoneySchemaOptions } from './schema.js';

const jsonShape = /* @__PURE__ */ z.object({ amount: z.string(), currency: z.string() });

/** The schema `moneySchema` returns: a Zod codec between the JSON form and Money. */
export type MoneyCodec<C extends string> = z.ZodCodec<typeof jsonShape, z.ZodCustom<MoneyFor<C>>>;

/**
 * Parses `{ amount, currency }` into Money, and encodes Money back to that JSON form. It is a Zod
 * codec, so `schema.parse(json)` (or `z.decode`) gives Money and `z.encode(schema, money)` gives
 * `{ amount, currency }`, written at the amount's own scale.
 *
 * The amount must be an exact decimal string with no more decimals than the scale (the
 * currency's exponent unless `scale` is given; `rounding` allows more), and at most `maxDigits`
 * digits. The currency must be one of `currency`, or any known code. Shorter amounts are padded to
 * the scale ("1.5" EUR gives 1.50 EUR). Problems are Zod issues on `amount` or `currency`; keys
 * other than those two are dropped. Bad options throw when the schema is built.
 *
 *     const Order = z.object({ total: moneySchema({ currency: 'EUR' }) })
 *     Order.parse({ total: { amount: '12.34', currency: 'EUR' } }).total   // Money<'EUR'>
 */
export function moneySchema<C extends string = string>(
  options?: MoneySchemaOptions<C>,
): MoneyCodec<C> {
  checkSchemaOptions(options);
  return z.codec(
    jsonShape,
    z.custom<MoneyFor<C>>((value) => isMoney(value)),
    {
      decode: (json, payload) => {
        const result = readMoneyJSON(json, options);
        if (isMoney(result)) {
          return result as Money as MoneyFor<C>;
        }
        payload.issues.push({
          code: 'custom',
          message: result.message,
          input: json,
          path: [result.field],
        });
        return z.NEVER;
      },
      encode: (value) => (value as Money).toJSON(),
    },
  );
}

/**
 * Like `moneySchema`, but the output stays the JSON object (with only `amount` and `currency`): it
 * checks that the input would parse, for code that passes the JSON on rather than computing with
 * it.
 */
export function moneyJSONSchema<C extends string = string>(
  options?: MoneySchemaOptions<C>,
): z.ZodType<MoneyJSON<C>, MoneyJSON> {
  checkSchemaOptions(options);
  return jsonShape.transform((json, context) => {
    const result = readMoneyJSON(json, options);
    if (isMoney(result)) {
      return json as MoneyJSON<C>;
    }
    context.addIssue({ code: 'custom', message: result.message, path: [result.field] });
    return z.NEVER;
  });
}
