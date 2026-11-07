#!/usr/bin/env bash
# Bundle size of the same small program (create, add, multiply, toDecimal) per library, plus the
# whole package (`export *`). esbuild --bundle --minify, ESM, browser platform; gzip -9.
# Writes compare/results/sizes.tsv.
set -euo pipefail
cd "$(dirname "$0")/.."

ESBUILD=node_modules/.bin/esbuild
DUCAT="$(realpath ../src/index.ts)"

# snippets live under compare/ so bare imports resolve from compare/node_modules
SCRATCH=$(mktemp -d "$PWD/sizes/.scratch-XXXXXX")
trap 'rm -rf "$SCRATCH"' EXIT

declare -A SNIPPET PACKAGE
SNIPPET[ducat]="import { money } from '$DUCAT'; const a = money('1.00','EUR'); console.log(a.add(a).multiply('1.075','halfEven').toDecimal());"
PACKAGE[ducat]="export * from '$DUCAT';"
SNIPPET[dinero.js 2]="import { dinero, add, multiply, transformScale, halfEven, toDecimal } from 'dinero.js'; import { EUR } from 'dinero.js/currencies'; const a = dinero({amount:100,currency:EUR}); console.log(toDecimal(transformScale(multiply(add(a,a),{amount:1075,scale:3}),2,halfEven)));"
PACKAGE[dinero.js 2]="export * from 'dinero.js'; export * from 'dinero.js/currencies';"
SNIPPET[dinero.js 1]="import Dinero from 'dinero-v1'; const a = Dinero({amount:100,currency:'EUR'}); console.log(a.add(a).multiply(1.075,'HALF_EVEN').toUnit());"
PACKAGE[dinero.js 1]="export { default } from 'dinero-v1';"
SNIPPET[currency.js]="import currency from 'currency.js'; const a = currency('1.00'); console.log(a.add(a).multiply(1.075).toString());"
PACKAGE[currency.js]="export { default } from 'currency.js';"
SNIPPET[js-money]="import Money from 'js-money'; const a = new Money(100, Money.EUR); console.log(a.add(a).multiply(1.075).toString());"
PACKAGE[js-money]="export { default } from 'js-money';"
SNIPPET[ts-money]="import { Money, Currencies } from 'ts-money'; const a = new Money(100, Currencies.EUR); console.log(a.add(a).multiply(1.075).toString());"
PACKAGE[ts-money]="export * from 'ts-money';"
SNIPPET[@screeny05/ts-money]="import { Money, Currencies } from '@screeny05/ts-money'; const a = new Money(100, Currencies.EUR); console.log(a.add(a).multiply(1.075).toString());"
PACKAGE[@screeny05/ts-money]="export * from '@screeny05/ts-money';"
SNIPPET[monetra]="import { Money, RoundingMode } from 'monetra'; const a = Money.fromMajor('1.00','EUR'); console.log(a.add(a).multiply('1.075',{rounding:RoundingMode.HALF_EVEN}).toDecimalString());"
PACKAGE[monetra]="export * from 'monetra';"
SNIPPET[bigint-money]="import { Money } from 'bigint-money'; const a = new Money('1.00','EUR'); console.log(a.add(a).multiply('1.075').toFixed(2));"
PACKAGE[bigint-money]="export * from 'bigint-money';"
SNIPPET[big.js]="import Big from 'big.js'; const a = new Big('1.00'); console.log(a.plus(a).times('1.075').round(2, 2).toFixed(2));"
PACKAGE[big.js]="export { default } from 'big.js';"
SNIPPET[bignumber.js]="import BigNumber from 'bignumber.js'; const a = new BigNumber('1.00'); console.log(a.plus(a).times('1.075').decimalPlaces(2, 6).toFixed(2));"
PACKAGE[bignumber.js]="export { default } from 'bignumber.js';"
SNIPPET[decimal.js]="import Decimal from 'decimal.js'; const a = new Decimal('1.00'); console.log(a.plus(a).times('1.075').toDecimalPlaces(2, 6).toFixed(2));"
PACKAGE[decimal.js]="export { default } from 'decimal.js';"
SNIPPET[decimal.js-light]="import Decimal from 'decimal.js-light'; const a = new Decimal('1.00'); console.log(a.plus(a).times('1.075').toDecimalPlaces(2, 6).toFixed(2));"
PACKAGE[decimal.js-light]="export { default } from 'decimal.js-light';"
SNIPPET[money-math]="import m from 'money-math'; console.log(m.mul(m.add('1.00','1.00'),'1.08'));"
PACKAGE[money-math]="export { default } from 'money-math';"

LIBRARIES=(ducat "dinero.js 2" "dinero.js 1" currency.js js-money ts-money @screeny05/ts-money monetra
  bigint-money big.js bignumber.js decimal.js decimal.js-light money-math)

bundle() {
  local entry=$1 output=$2
  "$ESBUILD" "$entry" --bundle --minify --format=esm --platform=browser --external:crypto \
    --outfile="$output" --log-level=error
}

gzip_size() {
  gzip -9c "$1" | wc -c
}

mkdir -p results
printf 'lib\tsnippet_min\tsnippet_gz\tfull_min\tfull_gz\n' > results/sizes.tsv

for library in "${LIBRARIES[@]}"; do
  echo "${SNIPPET[$library]}" > "$SCRATCH/snippet.mjs"
  echo "${PACKAGE[$library]}" > "$SCRATCH/package.mjs"
  bundle "$SCRATCH/snippet.mjs" "$SCRATCH/snippet.js"
  bundle "$SCRATCH/package.mjs" "$SCRATCH/package.js"

  printf '%s\t%s\t%s\t%s\t%s\n' "$library" \
    "$(wc -c < "$SCRATCH/snippet.js")" "$(gzip_size "$SCRATCH/snippet.js")" \
    "$(wc -c < "$SCRATCH/package.js")" "$(gzip_size "$SCRATCH/package.js")" >> results/sizes.tsv
done

column -t -s$'\t' results/sizes.tsv
