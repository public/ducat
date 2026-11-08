#!/bin/sh
# check-commit-msg.sh: Conventional Commits (https://www.conventionalcommits.org/en/v1.0.0/) for this repo.
#   check-commit-msg.sh FILE           the commit-msg hook: FILE holds the message (.githooks/commit-msg calls this)
#   check-commit-msg.sh --subject TEXT one subject line (CI: the PR title, which becomes the squash commit's subject)
# Accepted: type(optional-scope)!: description, with type one of
#   build chore ci docs feat fix perf refactor revert style test
# and a subject of at most 100 characters. Git's own messages (Merge ..., Revert "...", fixup!/squash!/amend!) pass.
set -eu
TYPES='build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test'
if [ "${1:-}" = --subject ]; then subj="${2:-}"; else subj="$(grep -v '^#' "$1" | sed -n '/[^[:space:]]/{p;q;}')"; fi
case "$subj" in "Merge "* | "Revert \""* | "fixup! "* | "squash! "* | "amend! "*) exit 0 ;; esac
if ! printf '%s\n' "$subj" | grep -Eq "^($TYPES)(\([A-Za-z0-9][A-Za-z0-9._/#-]*\))?!?: [^ ].*"; then
  printf 'commit message is not a Conventional Commit:\n  %s\n' "$subj" >&2
  printf 'use type(scope): description, with type one of %s\n' "$(echo "$TYPES" | tr '|' ' ')" >&2
  printf 'e.g. "fix(parse): check where group separators are", or "feat(core)!: ..." for a breaking change\n' >&2
  exit 1
fi
[ "${#subj}" -le 100 ] || {
  printf 'commit subject is %s characters; keep it to 100:\n  %s\n' "${#subj}" "$subj" >&2
  exit 1
}
