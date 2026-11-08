#!/usr/bin/env bash
# Bundle size of the same small program per library, plus the whole package (`export *`).
# esbuild --bundle --minify, ESM, browser platform; gzip -9. Two groups:
# - money libraries: create, add, multiply, toDecimal; writes compare/results/sizes.tsv;
# - fixed-point decimal libraries: parse "1.00", add it to itself, multiply by "1.075" rounding to
#   2 decimals half-up (where the library can round), toString; writes compare/results/sizes-fixed.tsv.
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

# --- fixed-point decimal libraries ---------------------------------------------------------------

declare -A FIXED_SNIPPET FIXED_PACKAGE
FIXED_SNIPPET[ducat Money]="import { money } from '$DUCAT'; const a = money('1.00','EUR'); console.log(a.add(a).multiply('1.075','halfExpand').toDecimal());"
FIXED_PACKAGE[ducat Money]="export * from '$DUCAT';"
DUCAT_FIXED="$(realpath ../src/plugins/fixed.ts)"
FIXED_SNIPPET[ducat Fixed]="import { fixed } from '$DUCAT_FIXED'; const a = fixed('1.00'); console.log(a.add(a).multiply('1.075','halfExpand').toString());"
FIXED_PACKAGE[ducat Fixed]="export * from '$DUCAT_FIXED';"
FIXED_SNIPPET[dnum]="import * as dn from 'dnum'; const a = dn.from('1.00', 2); console.log(dn.toString(dn.multiply(dn.add(a, a), '1.075', { decimals: 2, rounding: 'ROUND_HALF' })));"
FIXED_PACKAGE[dnum]="export * from 'dnum';"
FIXED_SNIPPET[js-big-decimal]="import bigDecimal from 'js-big-decimal'; const a = new bigDecimal('1.00'); console.log(a.add(a).multiply(new bigDecimal('1.075')).round(2, bigDecimal.RoundingModes.HALF_UP).getValue());"
FIXED_PACKAGE[js-big-decimal]="export * from 'js-big-decimal';"
FIXED_SNIPPET[bigdecimal.js]="import { Big, RoundingMode } from 'bigdecimal.js'; const a = Big('1.00'); console.log(a.add(a).multiply(Big('1.075')).setScale(2, RoundingMode.HALF_UP).toPlainString());"
FIXED_PACKAGE[bigdecimal.js]="export * from 'bigdecimal.js';"
# no rounding to a number of decimals at all, so the program stops at the exact product
FIXED_SNIPPET[@formatjs/bigdecimal]="import { BigDecimal } from '@formatjs/bigdecimal'; const a = new BigDecimal('1.00'); console.log(a.plus(a).times('1.075').toString());"
FIXED_PACKAGE[@formatjs/bigdecimal]="export * from '@formatjs/bigdecimal';"
FIXED_SNIPPET[bigint-money]="import { Money, Round } from 'bigint-money'; const a = new Money('1.00','EUR', Round.HALF_AWAY_FROM_0); console.log(a.add(a).multiply('1.075').toFixed(2));"
FIXED_PACKAGE[bigint-money]="export * from 'bigint-money';"

# ethers: FixedNumber from the package root and from the ethers/utils subpath; the smaller is kept,
# and its row says which import it was
ETHERS_ROOT_SNIPPET="import { FixedNumber } from 'ethers'; const f = (s) => FixedNumber.fromString(s, 'fixed128x18'); const a = f('1.00'); console.log(a.add(a).mul(f('1.075')).round(2).toString());"
ETHERS_UTILS_SNIPPET="import { FixedNumber } from 'ethers/utils'; const f = (s) => FixedNumber.fromString(s, 'fixed128x18'); const a = f('1.00'); console.log(a.add(a).mul(f('1.075')).round(2).toString());"

FIXED_LIBRARIES=("ducat Money" "ducat Fixed" dnum js-big-decimal bigdecimal.js @formatjs/bigdecimal bigint-money)

# one row: name, then minified and gzipped sizes of the program and of the whole package
size_row() {
  local name=$1 snippet=$2 package=$3
  echo "$snippet" > "$SCRATCH/snippet.mjs"
  echo "$package" > "$SCRATCH/package.mjs"
  bundle "$SCRATCH/snippet.mjs" "$SCRATCH/snippet.js"
  bundle "$SCRATCH/package.mjs" "$SCRATCH/package.js"
  printf '%s\t%s\t%s\t%s\t%s\n' "$name" \
    "$(wc -c < "$SCRATCH/snippet.js")" "$(gzip_size "$SCRATCH/snippet.js")" \
    "$(wc -c < "$SCRATCH/package.js")" "$(gzip_size "$SCRATCH/package.js")"
}

printf 'lib\tsnippet_min\tsnippet_gz\tfull_min\tfull_gz\n' > results/sizes-fixed.tsv
for library in "${FIXED_LIBRARIES[@]}"; do
  size_row "$library" "${FIXED_SNIPPET[$library]}" "${FIXED_PACKAGE[$library]}" >> results/sizes-fixed.tsv
done

root_row=$(size_row "ethers FixedNumber (import from 'ethers')" "$ETHERS_ROOT_SNIPPET" "export * from 'ethers';")
utils_row=$(size_row "ethers FixedNumber (import from 'ethers/utils')" "$ETHERS_UTILS_SNIPPET" \
  "export * from 'ethers/utils';")
root_gzip=$(echo "$root_row" | cut -f3)
utils_gzip=$(echo "$utils_row" | cut -f3)
if [ "$utils_gzip" -lt "$root_gzip" ]; then
  echo "$utils_row" >> results/sizes-fixed.tsv
else
  echo "$root_row" >> results/sizes-fixed.tsv
fi

column -t -s$'\t' results/sizes-fixed.tsv
