// An interpreter for CLDR's rule-based number formats (RBNF, the rules behind ICU's
// RuleBasedNumberFormat), for whole numbers. ECMA-402 has no spell-out, so the rules are CLDR's own
// text, generated into src/generated/rbnf/, and this follows ICU's semantics for them:
// https://unicode-org.github.io/icu/userguide/format_parse/numbers/rbnf.html
//
// It loads neither Money nor the currency table: a language pack is plain data.

/** A language's spell-out rules, from CLDR. Import one from `@ducatjs/money/words/<language>`. */
export interface SpelloutRules {
  /** The locale the rules are for, which also picks plural rules and number formats. */
  readonly locale: string;
  /** CLDR's RBNF rule text for the locale's spell-out rule sets. */
  readonly rules: string;
}

/** One piece of a rule's text. */
type Part =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'substitution';
      /** '<' quotient, '>' remainder, '=' the number itself, '>>>' remainder by the previous rule */
      readonly type: '<' | '>' | '=' | '>>>';
      /** A rule set name ('%spellout-numbering'), a decimal pattern ('#,##0'), or '' for this set */
      readonly target: string;
    }
  | {
      readonly kind: 'plural';
      readonly type: 'cardinal' | 'ordinal';
      readonly cases: ReadonlyMap<string, string>;
    }
  | {
      readonly kind: 'optional';
      readonly present: readonly Part[];
      readonly omitted: readonly Part[];
    };

interface Rule {
  readonly base: bigint;
  readonly divisor: bigint;
  readonly parts: readonly Part[];
  /** Whether a part is a remainder substitution (for ICU's rollback rule). */
  readonly hasRemainder: boolean;
}

interface RuleSet {
  readonly name: string;
  readonly rules: Rule[];
  negative?: Rule;
}

interface Compiled {
  readonly locale: string;
  readonly sets: Map<string, RuleSet>;
  readonly plurals: Map<string, Intl.PluralRules>;
  readonly numberFormats: Map<boolean, Intl.NumberFormat>;
}

const compiledRules = new WeakMap<SpelloutRules, Compiled>();

/** The exponent of the rule's divisor: the largest e with radix^e <= base. */
function divisorFor(base: bigint, radix: bigint): bigint {
  let divisor = 1n;
  while (divisor * radix <= base) {
    divisor *= radix;
  }
  return divisor;
}

/** Splits a rule's text into text, substitutions, plurals and optional parts. */
function parseParts(text: string): { parts: Part[]; hasRemainder: boolean } {
  const parts: Part[] = [];
  let hasRemainder = false;
  let literal = '';
  const flush = () => {
    if (literal !== '') {
      parts.push({ kind: 'text', text: literal });
      literal = '';
    }
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    if (char === '[') {
      const close = text.indexOf(']', i);
      const inner = text.slice(i + 1, close);
      const bar = inner.indexOf('|');
      const present = parseParts(bar < 0 ? inner : inner.slice(0, bar));
      const omitted = parseParts(bar < 0 ? '' : inner.slice(bar + 1));
      hasRemainder ||= present.hasRemainder;
      flush();
      parts.push({ kind: 'optional', present: present.parts, omitted: omitted.parts });
      i = close;
      continue;
    }

    if (char === '$' && text[i + 1] === '(') {
      // $(cardinal,one{Million}other{Millionen})$
      const close = text.indexOf(')$', i);
      const body = text.slice(i + 2, close);
      const comma = body.indexOf(',');
      const cases = new Map<string, string>();
      for (const match of body.slice(comma + 1).matchAll(/([\w=]+)\{([^}]*)\}/g)) {
        cases.set(match[1]!, match[2]!);
      }
      flush();
      parts.push({
        kind: 'plural',
        type: body.slice(0, comma) === 'ordinal' ? 'ordinal' : 'cardinal',
        cases,
      });
      i = close + 1;
      continue;
    }

    if (char === '<' || char === '>' || char === '=') {
      flush();
      if (char === '>' && text.startsWith('>>>', i)) {
        parts.push({ kind: 'substitution', type: '>>>', target: '' });
        hasRemainder = true;
        i += 2;
        continue;
      }
      const close = text.indexOf(char, i + 1);
      parts.push({ kind: 'substitution', type: char, target: text.slice(i + 1, close) });
      hasRemainder ||= char === '>';
      i = close;
      continue;
    }

    literal += char;
  }
  flush();
  return { parts, hasRemainder };
}

function compile(rules: SpelloutRules): Compiled {
  const sets = new Map<string, RuleSet>();
  let current: RuleSet | undefined;

  for (const rawLine of rules.rules.split('\n')) {
    const line = rawLine.trim();
    if (line === '') {
      continue;
    }
    if (line.startsWith('%') && line.endsWith(':')) {
      current = { name: line.slice(0, -1), rules: [] };
      sets.set(current.name, current);
      continue;
    }
    if (current === undefined) {
      throw new SyntaxError(`RBNF rules for ${rules.locale}: a rule before any rule set`);
    }

    const colon = line.indexOf(':');
    const descriptor = line.slice(0, colon).trim();
    // A leading apostrophe keeps the whitespace after it (' and =%x=).
    let body = line
      .slice(colon + 1)
      .replace(/;$/, '')
      .trimStart();
    if (body.startsWith("'")) {
      body = body.slice(1);
    }
    const { parts, hasRemainder } = parseParts(body);

    if (descriptor === '-x') {
      current.negative = { base: 0n, divisor: 1n, parts, hasRemainder };
      continue;
    }
    // Fraction, infinity and NaN rules don't apply to whole numbers.
    const base = /^(\d+)(?:\/(\d+))?$/.exec(descriptor.replaceAll(',', ''));
    if (base === null) {
      continue;
    }
    const value = BigInt(base[1]!);
    const radix = BigInt(base[2] ?? 10);
    current.rules.push({ base: value, divisor: divisorFor(value, radix), parts, hasRemainder });
  }

  return { locale: rules.locale, sets, plurals: new Map(), numberFormats: new Map() };
}

function compiled(rules: SpelloutRules): Compiled {
  let result = compiledRules.get(rules);
  if (result === undefined) {
    result = compile(rules);
    compiledRules.set(rules, result);
  }
  return result;
}

function ruleSet(language: Compiled, name: string): RuleSet {
  const set = language.sets.get(name);
  if (set === undefined) {
    throw new RangeError(`No rule set ${name} for ${language.locale}`);
  }
  return set;
}

/** The rule for a non-negative value: the last one whose base is at most the value. */
function ruleIndexFor(set: RuleSet, value: bigint): number {
  let index = -1;
  for (let i = 0; i < set.rules.length && set.rules[i]!.base <= value; i++) {
    index = i;
  }
  if (index < 0) {
    throw new RangeError(`Rule set ${set.name} has no rule for ${value}`);
  }

  // ICU's rollback: a rule whose base isn't a multiple of its divisor doesn't take values that are
  // (1100/100 doesn't spell 1200's remainder), so the rule before it does.
  const rule = set.rules[index]!;
  if (
    index > 0 &&
    rule.hasRemainder &&
    value % rule.divisor === 0n &&
    rule.base % rule.divisor !== 0n
  ) {
    return index - 1;
  }
  return index;
}

function formatDecimal(language: Compiled, pattern: string, value: bigint): string {
  const grouping = pattern.includes(',');
  let format = language.numberFormats.get(grouping);
  if (format === undefined) {
    format = new Intl.NumberFormat(language.locale, {
      useGrouping: grouping,
      maximumFractionDigits: 0,
    });
    language.numberFormats.set(grouping, format);
  }
  return format.format(value);
}

function pluralCategory(language: Compiled, type: 'cardinal' | 'ordinal', value: bigint): string {
  let rules = language.plurals.get(type);
  if (rules === undefined) {
    rules = new Intl.PluralRules(language.locale, { type });
    language.plurals.set(type, rules);
  }
  return rules.select(Number(value));
}

function applyRule(
  language: Compiled,
  set: RuleSet,
  index: number,
  rule: Rule,
  value: bigint,
  parts: readonly Part[],
): string {
  const quotient = value / rule.divisor;
  const remainder = value % rule.divisor;
  let output = '';

  for (const part of parts) {
    if (part.kind === 'text') {
      output += part.text;
    } else if (part.kind === 'optional') {
      // the bracketed text is left out when the value is a multiple of the divisor
      const chosen = remainder === 0n ? part.omitted : part.present;
      output += applyRule(language, set, index, rule, value, chosen);
    } else if (part.kind === 'plural') {
      const category = pluralCategory(language, part.type, quotient);
      output += part.cases.get(category) ?? part.cases.get('other') ?? '';
    } else if (part.type === '>>>') {
      // the remainder, through the rule before this one rather than by the usual selection
      const previous = set.rules[index - 1]!;
      output += applyRule(language, set, index - 1, previous, remainder, previous.parts);
    } else {
      let operand = value;
      if (part.type === '<') {
        operand = quotient;
      } else if (part.type === '>') {
        operand = rule === set.negative ? value : remainder;
      }
      const target = part.target;
      if (target !== '' && !target.startsWith('%')) {
        output += formatDecimal(language, target, operand);
      } else {
        output += spell(language, target === '' ? set : ruleSet(language, target), operand);
      }
    }
  }
  return output;
}

function spell(language: Compiled, set: RuleSet, value: bigint): string {
  if (value < 0n) {
    const negative = set.negative;
    if (negative === undefined) {
      // As ICU does: a set without a -x rule hands the value, sign and all, to its first rule
      // (in CLDR, always one that passes it on whole: 0: =%spellout-cardinal-masculine=)
      const first = set.rules[0]!;
      return applyRule(language, set, 0, first, value, first.parts);
    }
    return applyRule(language, set, -1, negative, -value, negative.parts);
  }
  const index = ruleIndexFor(set, value);
  const rule = set.rules[index]!;
  return applyRule(language, set, index, rule, value, rule.parts);
}

/** The public rule sets of a language: the names `spellOut` accepts. */
export function ruleSets(rules: SpelloutRules): string[] {
  return [...compiled(rules).sets.keys()].filter((name) => !name.startsWith('%%'));
}

/**
 * A whole number in words, by a language's CLDR rules: `spellOut(123, en)` is 'one hundred
 * twenty-three'. `ruleSet` picks one of the language's rule sets (default '%spellout-cardinal',
 * or the masculine one where the language has no neutral cardinal): '%spellout-ordinal',
 * '%spellout-cardinal-feminine', and the financial sets where CLDR has them. Accepts a safe integer
 * or a bigint; beyond 10^18 the rules write digits, as ICU does.
 */
export function spellOut(
  value: number | bigint,
  rules: SpelloutRules,
  ruleSetName?: string,
): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new RangeError(`spellOut takes whole numbers, got ${value}`);
  }
  const language = compiled(rules);
  const name = ruleSetName ?? defaultCardinal(language);
  return spell(language, ruleSet(language, name), BigInt(value));
}

function defaultCardinal(language: Compiled): string {
  return language.sets.has('%spellout-cardinal')
    ? '%spellout-cardinal'
    : '%spellout-cardinal-masculine';
}

/** @internal The cardinal rule set for a gender, falling back to the language's default. */
export function cardinalFor(rules: SpelloutRules, gender: string | undefined): string {
  const language = compiled(rules);
  if (gender !== undefined) {
    const name = `%spellout-cardinal-${gender}`;
    if (language.sets.has(name)) {
      return name;
    }
  }
  return defaultCardinal(language);
}
