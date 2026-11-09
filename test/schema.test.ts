import '../src/plugins/core.js'; // the tests below use the Money methods
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as v from 'valibot';
import { z } from 'zod';
import { runs } from './fc-config.js';
import { defineCurrency, fromMinor, money, type Money, type RoundingMode } from '../src/fn.js';
import * as zod from '../src/zod.js';
import * as valibot from '../src/valibot.js';

type Outcome = { ok: true; value: unknown } | { ok: false; path: string; message: string };

// The two entries must accept and reject exactly the same inputs, so every case runs through both.
const adapters = {
  zod: (input: unknown, options?: zod.MoneySchemaOptions, json = false): Outcome => {
    const schema = json ? zod.moneyJSONSchema(options) : zod.moneySchema(options);
    const result = schema.safeParse(input);
    if (result.success) {
      return { ok: true, value: result.data };
    }
    const issue = result.error.issues[0]!;
    return { ok: false, path: issue.path.join('.'), message: issue.message };
  },
  valibot: (input: unknown, options?: valibot.MoneySchemaOptions, json = false): Outcome => {
    const schema = json ? valibot.moneyJSONSchema(options) : valibot.moneySchema(options);
    const result = v.safeParse(schema, input);
    if (result.success) {
      return { ok: true, value: result.output };
    }
    const issue = result.issues[0];
    return {
      ok: false,
      path: (issue.path ?? []).map((item) => String(item.key)).join('.'),
      message: issue.message,
    };
  },
};

const text = (outcome: Outcome) =>
  outcome.ok ? String(outcome.value) : `${outcome.path}: ${outcome.message}`;

for (const [name, parse] of Object.entries(adapters)) {
  describe(`${name} moneySchema`, () => {
    it('parses the JSON form into Money', () => {
      const outcome = parse({ amount: '12.34', currency: 'EUR' });
      expect(outcome.ok).toBe(true);
      const value = (outcome as { value: Money }).value;
      expect(value.toString()).toBe('12.34 EUR');
      expect(value.scale).toBe(2);
      expect(text(parse({ amount: '-0.05', currency: 'USD' }))).toBe('-0.05 USD');
      expect(text(parse({ amount: '1000', currency: 'JPY' }))).toBe('1000 JPY');
      expect(text(parse({ amount: '123456789012345678901234.5', currency: 'EUR' }))).toBe(
        '123456789012345678901234.50 EUR',
      );
    });

    it('rejects amounts that are not exact decimal strings, on the amount path', () => {
      for (const amount of ['1e3', '+1', ' 1', '1,00', '.5', '5.', '', 'NaN', '0x10']) {
        const outcome = parse({ amount, currency: 'EUR' });
        expect(outcome.ok).toBe(false);
        expect((outcome as { path: string }).path).toBe('amount');
      }
    });

    it('rejects too many decimals unless rounding is given', () => {
      expect(text(parse({ amount: '1.005', currency: 'EUR' }))).toMatch(/^amount: /);
      expect(text(parse({ amount: '1.5', currency: 'JPY' }))).toMatch(/^amount: /);
      expect(text(parse({ amount: '1.005', currency: 'EUR' }, { rounding: 'halfEven' }))).toBe(
        '1.00 EUR',
      );
      expect(text(parse({ amount: '1.005', currency: 'EUR' }, { scale: 3 }))).toBe('1.005 EUR');
    });

    it('accepts known currencies only, or the ones given', () => {
      expect(text(parse({ amount: '1', currency: 'XYZ' }))).toBe(
        'currency: Unknown currency "XYZ"',
      );
      expect(text(parse({ amount: '1', currency: 'eur' }))).toMatch(/^currency: /);
      expect(text(parse({ amount: '1', currency: 'USD' }, { currency: 'EUR' }))).toBe(
        'currency: Expected currency EUR, got "USD"',
      );
      expect(text(parse({ amount: '1', currency: 'GBP' }, { currency: ['EUR', 'USD'] }))).toBe(
        'currency: Expected currency EUR, USD, got "GBP"',
      );
      expect(text(parse({ amount: '1', currency: 'USD' }, { currency: ['EUR', 'USD'] }))).toBe(
        '1.00 USD',
      );
      // A code no other test file uses: the registry is global, and Bun shares it across files.
      defineCurrency('XZV', 3);
      expect(text(parse({ amount: '1', currency: 'XZV' }))).toBe('1.000 XZV');
    });

    it('rejects the wrong shape', () => {
      for (const input of [
        null,
        '12.34 EUR',
        { amount: 12.34, currency: 'EUR' },
        { amount: '1' },
        [],
      ]) {
        expect(parse(input).ok).toBe(false);
      }
    });

    it('pads shorter amounts to the scale (the scale is the schema’s, not the input’s)', () => {
      expect(text(parse({ amount: '1.5', currency: 'EUR' }))).toBe('1.50 EUR');
      expect(text(parse({ amount: '007', currency: 'EUR' }))).toBe('7.00 EUR');
      expect(text(parse({ amount: '-0', currency: 'EUR' }))).toBe('0.00 EUR');
      expect(text(parse({ amount: '1.005', currency: 'EUR' }, { scale: 3 }))).toBe('1.005 EUR');
    });

    it('limits the number of digits', () => {
      const fifty = '9'.repeat(50);
      expect(parse({ amount: fifty, currency: 'JPY' }).ok).toBe(true);
      expect(text(parse({ amount: fifty + '9', currency: 'JPY' }))).toMatch(/^amount: /);
      expect(text(parse({ amount: '1'.repeat(1_000_000), currency: 'JPY' }))).toMatch(/^amount: /);
      expect(parse({ amount: '123.45', currency: 'EUR' }, { maxDigits: 5 }).ok).toBe(true);
      expect(parse({ amount: '-123.45', currency: 'EUR' }, { maxDigits: 4 }).ok).toBe(false);
    });

    it('never yields Money for a malformed amount or too many decimals (property)', () => {
      const pattern = /^-?\d+(?:\.\d+)?$/;
      fc.assert(
        fc.property(fc.oneof(fc.string(), fc.stringMatching(/^[-+ .,e0-9]{0,12}$/)), (amount) => {
          const outcome = parse({ amount, currency: 'EUR' });
          const decimals = amount.split('.')[1]?.length ?? 0;
          if (!pattern.test(amount) || decimals > 2) {
            expect(outcome.ok).toBe(false);
          } else {
            expect(outcome.ok).toBe(true);
          }
        }),
        { numRuns: runs(500) },
      );
    });

    it('moneyJSONSchema checks the same things but keeps the JSON', () => {
      // keys other than amount and currency are dropped
      const outcome = parse({ amount: '12.34', currency: 'EUR', note: 'x' }, undefined, true);
      expect(outcome).toEqual({ ok: true, value: { amount: '12.34', currency: 'EUR' } });
      expect(parse({ amount: '1.005', currency: 'EUR' }, undefined, true).ok).toBe(false);
    });

    it('round-trips every Money through JSON, at any scale given to the schema (property)', () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }),
          fc.constantFrom('EUR', 'JPY', 'KWD', 'CLF', 'USD'),
          fc.option(fc.integer({ min: 0, max: 8 }), { nil: undefined }),
          (minor, currency, scale) => {
            const original = fromMinor(minor, currency, scale);
            const wire = JSON.parse(JSON.stringify(original)) as unknown;
            const outcome = parse(wire, scale === undefined ? undefined : { scale });
            expect(outcome.ok).toBe(true);
            const back = (outcome as { value: Money }).value;
            expect(back.equals(original) && back.scale === original.scale).toBe(true);
          },
        ),
        { numRuns: runs(300) },
      );
    });
  });
}

describe('options', () => {
  it('are checked when the schema is built', () => {
    for (const build of [
      zod.moneySchema,
      zod.moneyJSONSchema,
      valibot.moneySchema,
      valibot.moneyJSONSchema,
    ]) {
      expect(() => build({ currency: 'XYZ' })).toThrow(RangeError);
      expect(() => build({ currency: ['EUR', 'eur'] })).toThrow(RangeError);
      expect(() => build({ scale: -1 })).toThrow(RangeError);
      expect(() => build({ scale: 1.5 })).toThrow(RangeError);
      expect(() => build({ rounding: 'halfUp' as RoundingMode })).toThrow(RangeError);
      expect(() => build({ maxDigits: 0 })).toThrow(RangeError);
    }
  });
});

describe('encoding', () => {
  it('Zod encodes Money back to the JSON form, and decoding it gives the same Money (property)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }),
        fc.constantFrom('EUR', 'JPY', 'KWD'),
        fc.integer({ min: 0, max: 6 }),
        (minor, currency, scale) => {
          const schema = zod.moneySchema({ scale });
          const original = fromMinor(minor, currency, scale);
          const wire = z.encode(schema, original);
          expect(wire).toEqual(original.toJSON());
          const back = z.decode(schema, wire);
          expect(back.equals(original) && back.scale === original.scale).toBe(true);
        },
      ),
      { numRuns: runs(300) },
    );
    expect(() => z.encode(zod.moneySchema(), { amount: '1', currency: 'EUR' } as never)).toThrow(
      z.ZodError,
    );
  });

  it('Valibot reads back what toJSON writes', () => {
    const original = money('1.005', 'EUR', { scale: 3 });
    const back = v.parse(valibot.moneySchema({ scale: 3 }), original.toJSON());
    expect(back.equals(original) && back.scale === 3).toBe(true);
  });
});

describe('the Zod and Valibot entries agree (property)', () => {
  it('on arbitrary amount strings and currencies', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.stringMatching(/^-?\d{1,20}(\.\d{0,6})?$/)),
        fc.constantFrom('EUR', 'JPY', 'KWD', 'XYZ', ''),
        (amount, currency) => {
          const input = { amount, currency };
          const fromZod = adapters.zod(input);
          const fromValibot = adapters.valibot(input);
          expect(text(fromValibot)).toBe(text(fromZod));
        },
      ),
      { numRuns: runs(500) },
    );
  });
});

describe('composition', () => {
  it('works inside larger schemas, with typed outputs', () => {
    const Order = z.object({ total: zod.moneySchema({ currency: 'EUR' }) });
    const order = Order.parse({ total: { amount: '9.99', currency: 'EUR' } });
    const total: Money<'EUR'> = order.total;
    expect(total.add(money('0.01', 'EUR')).toString()).toBe('10.00 EUR');
    const failed = Order.safeParse({ total: { amount: '9.999', currency: 'EUR' } });
    expect(failed.success).toBe(false);
    expect(failed.error!.issues[0]!.path).toEqual(['total', 'amount']);

    const VOrder = v.object({ total: valibot.moneySchema({ currency: ['EUR', 'USD'] }) });
    const vorder = v.parse(VOrder, { total: { amount: '9.99', currency: 'USD' } });
    const vtotal: Money<'EUR'> | Money<'USD'> = vorder.total;
    expect(String(vtotal)).toBe('9.99 USD');
    const vfailed = v.safeParse(VOrder, { total: { amount: '1', currency: 'GBP' } });
    expect(vfailed.issues?.[0]?.path?.map((item) => item.key)).toEqual(['total', 'currency']);
  });
});
