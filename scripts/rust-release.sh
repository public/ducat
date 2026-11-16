#!/usr/bin/env bash
# The Rust release's one list of crates, and the check that a tag may publish them
# (.github/workflows/rust-release.yml runs both, from rust/).
#
#   scripts/rust-release.sh crates       the crates to publish, in dependency order
#   scripts/rust-release.sh check TAG    checks that TAG is rust-v<version>, that the workspace's
#                                        publishable crates are exactly that list, and that each
#                                        has the version; prints the version
#
# Run from rust/ (it reads `cargo metadata` there). Crates with publish = false (ducat-benches) are
# not part of a release; cargo metadata gives them `"publish": []`, the others `null`.
set -euo pipefail

CRATES=(ducat ducat-words ducat-format ducat-sql-core ducat-sqlx ducat-diesel ducat-fetch)

case "${1:-}" in
crates)
  printf '%s\n' "${CRATES[@]}"
  ;;
check)
  tag=${2:?usage: rust-release.sh check TAG}
  want=${tag#rust-v}
  if [ "$want" = "$tag" ] || ! [[ $want =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
    echo "::error::tag $tag is not rust-v<version>" >&2
    exit 1
  fi
  publishable=$(cargo metadata --no-deps --format-version 1 --locked |
    jq -r '.packages[] | select(.publish == null) | "\(.name) \(.version)"' | sort)
  listed=$(printf '%s\n' "${CRATES[@]}" | sort)
  if [ "$(echo "$publishable" | cut -d' ' -f1)" != "$listed" ]; then
    echo "::error::the workspace's publishable crates aren't scripts/rust-release.sh's list" >&2
    diff <(echo "$listed") <(echo "$publishable" | cut -d' ' -f1) | sed -n 's/^</  listed, not publishable:/p; s/^>/  publishable, not listed:/p' >&2
    exit 1
  fi
  bad=$(echo "$publishable" | awk -v want="$want" '$2 != want')
  if [ -n "$bad" ]; then
    echo "::error::tag $tag wants version $want, but these crates have another:" >&2
    echo "$bad" >&2
    exit 1
  fi
  echo "$want"
  ;;
*)
  echo "usage: rust-release.sh crates | check TAG" >&2
  exit 2
  ;;
esac
