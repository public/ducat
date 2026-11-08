/**
 * `@ducatjs/money/valibot`: Valibot schemas for the JSON form of Money, `{ "amount": "12.34",
 * "currency": "EUR" }`, for API boundaries. Valibot is an optional peer dependency: only this entry
 * imports it.
 */
import * as valibot from 'valibot';
import { isMoney, type Money, type MoneyJSON } from './money.js';
import {
  readMoneyJSON,
  type MoneyFor,
  type MoneyIssue,
  type MoneySchemaOptions,
} from './schema.js';

export type { MoneyFor, MoneySchemaOptions } from './schema.js';

const jsonShape = valibot.object({ amount: valibot.string(), currency: valibot.string() });

/** The schema type both functions return: the JSON shape, then a transformation. */
export type MoneySchema<TOutput> = valibot.SchemaWithPipe<
  readonly [typeof jsonShape, valibot.RawTransformAction<MoneyJSON, TOutput>]
>;

/** A Valibot issue path pointing at the field that is wrong. */
function pathTo(json: MoneyJSON, issue: MoneyIssue): [valibot.ObjectPathItem] {
  return [
    {
      type: 'object',
      origin: 'value',
      input: json as unknown as Record<string, unknown>,
      key: issue.field,
      value: json[issue.field],
    },
  ];
}

/**
 * Parses `{ amount, currency }` into Money. The amount must be an exact decimal string with no
 * more decimals than the currency allows (unless `rounding` is given), and the currency must be
 * one of `currency` (or any known code). Problems are reported as Valibot issues on `amount` or
 * `currency`.
 *
 *     const Order = valibot.object({ total: moneySchema({ currency: 'EUR' }) })
 *     v.parse(Order, { total: { amount: '12.34', currency: 'EUR' } }).total   // Money<'EUR'>
 */
export function moneySchema<C extends string = string>(
  options?: MoneySchemaOptions<C>,
): MoneySchema<MoneyFor<C>> {
  return valibot.pipe(
    jsonShape,
    valibot.rawTransform<MoneyJSON, MoneyFor<C>>(({ dataset, addIssue, NEVER }) => {
      const json = dataset.value;
      const result = readMoneyJSON(json, options);
      if (isMoney(result)) {
        return result as Money as MoneyFor<C>;
      }
      addIssue({ message: result.message, path: pathTo(json, result) });
      return NEVER;
    }),
  );
}

/**
 * Like `moneySchema`, but the output stays the JSON object: it checks that the input would parse,
 * for code that passes the JSON on rather than computing with it.
 */
export function moneyJSONSchema<C extends string = string>(
  options?: MoneySchemaOptions<C>,
): MoneySchema<MoneyJSON<C>> {
  return valibot.pipe(
    jsonShape,
    valibot.rawTransform<MoneyJSON, MoneyJSON<C>>(({ dataset, addIssue, NEVER }) => {
      const json = dataset.value;
      const result = readMoneyJSON(json, options);
      if (isMoney(result)) {
        return json as MoneyJSON<C>;
      }
      addIssue({ message: result.message, path: pathTo(json, result) });
      return NEVER;
    }),
  );
}
