#!/usr/bin/env bash
# Builds a self-contained runner archive for one runtime:
#   compare/runner/make.sh RUNTIME WARM_UP_MS ROUNDS OUTPUT.zip
# RUNTIME is node, bun or deno. The archive holds run.sh at its root, the benchmark bundle and the
# settings; copy it to a clean Linux x64 machine, unzip, and run ./run.sh.
set -euo pipefail
if [ $# -ne 4 ]; then
  echo "usage: $0 node|bun|deno WARM_UP_MS ROUNDS OUTPUT.zip" >&2
  exit 2
fi

cd "$(dirname "$0")/.."
OUTPUT=$(realpath -m "$4")

node build.mjs bench/bench.ts out/bench.mjs

STAGING=$(mktemp -d)
trap 'rm -rf "$STAGING"' EXIT
cp runner/run.sh "$STAGING/"
# run.sh and env.txt know the bundle as bench.bundle.mjs
cp out/bench.mjs "$STAGING/bench.bundle.mjs"
echo "$1" > "$STAGING/runtime.txt"
echo "$2" > "$STAGING/bench_ms.txt"
echo "$3" > "$STAGING/rounds.txt"

(cd "$STAGING" && zip -q -r "$OUTPUT" .)
sha256sum "$OUTPUT"
