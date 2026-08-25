#!/usr/bin/env bash
# Probe (asks): is `db.runTransaction` really called from exactly two sites in the whole library,
# so the blast radius of a nested-transaction guard is fully enumerable by reading?
#
# Run from the repo root: bash docs/plans/issue-112-nested-transaction-guard/probes/enumerate-runTransaction-sites.sh
#
# Expected result on baseline `main` @ 510f595: exactly two matches, both in
# src/core/FirestoreRepository.ts — line ~4846 (runInterceptedWrite's transaction-mode branch,
# the promoted write this issue is about) and line ~5125/5148 (runInTransaction itself, the public
# wrapper). No matches in src/core/QueryBuilder.ts or src/core/CollectionGroup.ts.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
echo "--- db.runTransaction call sites under src/core ---"
grep -rn "\.runTransaction(" src/core/*.ts
echo
echo "--- confirms commitInChunks (batch mode) never opens a transaction ---"
grep -n "private async commitInChunks" -A 60 src/core/FirestoreRepository.ts | grep -c "runTransaction" || true
