// The withdrawn ISO 4217 codes (List Three) registered through `defineHistoricCurrencies`. Writers
// that need an ISO code (ISO 20022) accept these as well as the current table, without bundling
// the historic table: it is filled only by a program that imports `/historic` and registers them.

/** @internal */
export const REGISTERED_WITHDRAWN_ISO = /* @__PURE__ */ new Set<string>();
