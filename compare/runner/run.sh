#!/usr/bin/env bash
# Clean-machine benchmark runner. Runs ONE runtime (named in runtime.txt) over the bundled money
# and fixed-point benchmarks, one after the other. It installs that runtime itself, pinned and
# checked by SHA-256, so the machine needs nothing but bash, curl, tar, unzip and coreutils.
# Writes $OUT/bench.json, $OUT/fixed-bench.json and $OUT/env.txt.
set -euo pipefail
cd "$(dirname "$0")"

OUT="${OUT:-$PWD/out}"
mkdir -p "$OUT" runtime

RUNTIME=$(cat runtime.txt)
WARM_UP_MS=$(cat bench_ms.txt)
ROUNDS=$(cat rounds.txt)

# download once, then refuse to run anything whose hash does not match
fetch_verified() {
  local url=$1 expected_sha256=$2 file=$3
  if [ ! -f "$file" ]; then
    # five tries, 10/20/40/80 s apart: a GitHub 504 must not cost a box hour
    local attempt
    for attempt in 1 2 3 4 5; do
      curl -sSfL -o "$file" "$url" && break
      rm -f "$file"
      if [ "$attempt" = 5 ]; then
        echo "download failed 5 times: $url" >&2
        exit 4
      fi
      sleep $((10 * 2 ** (attempt - 1)))
    done
  fi
  if ! echo "$expected_sha256  $file" | sha256sum -c --quiet -; then
    echo "sha256 mismatch for $file" >&2
    exit 3
  fi
}

case "$RUNTIME" in
  node)
    fetch_verified https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-x64.tar.xz \
      48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75 runtime/node.tar.xz
    tar -xJf runtime/node.tar.xz -C runtime
    COMMAND=(runtime/node-v24.22.2-linux-x64/bin/node)
    ;;
  bun)
    fetch_verified https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-linux-x64.zip \
      bf8ccbfb2b0b80159e0f9a6d15c55317add8077534dbc6130a3edb52fccb395c runtime/bun.zip
    unzip -q -o runtime/bun.zip -d runtime
    COMMAND=(runtime/bun-linux-x64/bun)
    ;;
  deno)
    fetch_verified https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-unknown-linux-gnu.zip \
      e890975bc2549807bbcc0b584ffafda72cc7c93349dd99c80483dd784f6c4609 runtime/deno.zip
    unzip -q -o runtime/deno.zip -d runtime
    # the benchmark reads its settings from the environment, and monetra reads NODE_ENV
    COMMAND=(runtime/deno run --no-config --no-prompt --allow-env=BENCH_MS,BENCH_ROUNDS,BENCH_ONLY,NODE_ENV)
    ;;
  *)
    echo "unknown runtime $RUNTIME (expected node, bun or deno)" >&2
    exit 2
    ;;
esac

# what the results were measured on: settings, CPU, cores, kernel, and the exact bundle
{
  echo "runtime=$RUNTIME ms=$WARM_UP_MS rounds=$ROUNDS"
  lscpu | sed -n 's/^Model name: *//p'
  nproc
  uname -r
  sha256sum bench.bundle.mjs fixed-bench.bundle.mjs
} > "$OUT/env.txt"

export BENCH_MS="$WARM_UP_MS" BENCH_ROUNDS="$ROUNDS"
"${COMMAND[@]}" bench.bundle.mjs 2> "$OUT/stderr.txt" | grep '^{' > "$OUT/bench.json"
"${COMMAND[@]}" fixed-bench.bundle.mjs 2> "$OUT/fixed-stderr.txt" | grep '^{' > "$OUT/fixed-bench.json"

echo "done $RUNTIME"
head -c 300 "$OUT/bench.json"
echo
head -c 300 "$OUT/fixed-bench.json"
