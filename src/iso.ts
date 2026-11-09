/**
 * `@ducatjs/money/iso`: one constant per ISO 4217 currency, `EUR === 'EUR'`. Using a constant
 * registers that currency's exponent, so a `/fn` program carries only the currencies it names
 * instead of the whole table: `fromMinor(1250, EUR)`. With the root entry they're plain strings.
 */
export * from './generated/iso4217-constants.js';
