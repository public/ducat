/**
 * `@ducatjs/money/iso`: registers every ISO 4217 currency. Every entry that builds or reads Money
 * imports it, so this matters only for `@ducatjs/money/fn`, which doesn't: a `/fn` program imports
 * it to use any ISO code, or `@ducatjs/money/iso/EUR` (one module per code) to carry only the
 * currencies it uses.
 */
import { registerIsoCurrencies } from '../currency.js';

registerIsoCurrencies();
