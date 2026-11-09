/**
 * `@ducatjs/money/iso/all`: registers every ISO 4217 currency, so `/fn` programs can use any code as
 * a string. The root entry and `@ducatjs/money/all` import it already.
 */
import { registerIsoCurrencies } from '../currency.js';

registerIsoCurrencies();
