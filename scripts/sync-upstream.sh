#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-upstream}"
UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/openclaw/openclaw.git}"
TARGET_BRANCH="${TARGET_BRANCH:-main}"
PROTECT_FILE="${PROTECT_FILE:-.sync-protect-paths}"
SYNC_MESSAGE="${SYNC_MESSAGE:-chore(sync): merge upstream/main and preserve local CN extension}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not inside a git repository." >&2
  exit 1
fi

if git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
  git remote set-url "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
else
  git remote add "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
fi

git fetch "$UPSTREAM_REMOTE" "$TARGET_BRANCH"

BEFORE_SHA="$(git rev-parse HEAD)"
UPSTREAM_REF="${UPSTREAM_REMOTE}/${TARGET_BRANCH}"

if ! git merge --no-ff --no-commit -X theirs "$UPSTREAM_REF"; then
  echo "Merge failed. Aborting merge." >&2
  git merge --abort || true
  exit 1
fi

if [[ -f "$PROTECT_FILE" ]]; then
  while IFS= read -r raw || [[ -n "$raw" ]]; do
    path="$(printf '%s' "$raw" | sed 's/#.*$//' | xargs)"
    [[ -z "$path" ]] && continue

    # Drop merged content for protected paths first, then restore pre-merge state.
    git rm -r --ignore-unmatch --quiet -- "$path" || true
    git checkout "$BEFORE_SHA" -- "$path" 2>/dev/null || true
  done < "$PROTECT_FILE"
fi

git add -A
if git diff --cached --quiet; then
  echo "No sync changes to commit."
  exit 0
fi

git commit -m "$SYNC_MESSAGE"
echo "Sync commit created."
