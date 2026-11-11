# How to use ducat from CommonJS

This guide shows you how to use ducat, an ES module, from a CommonJS project. Node 24 can `require()` an ES module, so you need no build step.

## Require it

```js
const { money } = require('@ducatjs/money');
require('@ducatjs/money/allocate'); // every entry works the same way
```

## Get the types in a CommonJS TypeScript project

TypeScript finds the types with any `moduleResolution`. `nodenext` and `bundler` read `exports`, while `node10` (the default for `module: "commonjs"`) reads `types` and `typesVersions`, which name the same declarations. So you need no `paths` mapping into `dist/`.

This needs Node 24 or later, which every supported Node is: ducat is ESM only, so `isMoney()` and `instanceof Money` never fail across a CommonJS and an ESM copy.

## Related

- Explanation: [Decisions](../explanation/decisions.md) (why ESM only, Node ≥ 24)
