// Loaded before every test file (vitest setupFiles, bun --preload): registers every ISO 4217 code,
// as the root entry does, so tests that import only src/fn.ts can use codes as strings. What /fn
// does without it is checked on real bundles by scripts/bundle-check.mjs.
import '../src/plugins/iso-all.js';
