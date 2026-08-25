# Issue #112 — implementation review

**Reviewer:** Claude Sonnet 5 (implementation-review skill) · **Round:** 1 · **Reviewed:**
`7e5be56` (`fix(repository): refuse a write-interceptor transaction nested inside one already open
(#112)`) · **Branch:** `fix/issue-112-nested-transaction-guard` · **Plan:** `PLAN.md` @ baseline
`510f595` · **Tree:** unchanged by this review — three mutation edits were made to
`src/core/FirestoreRepository.ts` during mutation testing, each reverted from a backup
(`/tmp/FirestoreRepository.ts.review112.backup`) and confirmed via `git status --short` / `git diff
--stat` returning empty before moving to the next check

**Verdict: BLOCKED** — `check:docs` (§10 leg 13 of 14) is red on the tree as committed. The fix is a
one-line edit to `docs/plans/issue-112-nested-transaction-guard/notes.md:141` (see B1); every other
leg, and the implementation itself, is independently verified and holding.

---

## What I ran

| Check | Command | Result |
| ----- | ------- | ------ |
| Gate legs 1–5 (types, lint, format, unit, integration) | `(npm run test:types && npm run lint && npm run check:format && npm run test:unit && npm run test:integration:emulator) > log 2>&1; echo EXIT=$?` | `EXIT=0` — unit 37 suites/501 tests, integration 38 suites/613 tests |
| Gate legs 6–9 (unit coverage + gate, integration coverage + gate) | same pattern | `EXIT=0` — all 8 coverage-gate rows passed |
| Gate legs 10–14 (build, check:package, check:consumer, check:docs, docs:build) | same pattern | `EXIT=1` — `check:docs` failed; chain short-circuited before `docs:build` ran |
| `docs:build` (skipped by the short-circuit above) | run separately | `EXIT=0` — 61 pages built, `check-built-docs-assets: ok`, no leaked `:::` in the built `patterns` page |
| Suite counts | `test:unit`, `test:integration:emulator` | unit **37/501** (baseline 37/493, +8 ✓) · integration **38/613** (baseline 38/611, +2 ✓) — matches the plan's prediction and `notes.md` |
| Coverage gates | from my own run's LCOV, `check-coverage-gates.mjs --suite integration` | `FirestoreRepository (emulator)`: lines 98.39%/90%, branches 93.61%/75%, functions 95.16%/85% — matches `notes.md`'s claimed figures exactly |
| I-17 flakiness | `firebase emulators:exec ... "npx jest --config jest.config.integration.js -t 'I-17'"` × 5 | 5/5 green, no flake — concurrency test is stable |
| Mutation 1 (T1/T2/guard removal) | removed the `this.assertNoAmbientTransaction(operation);` call at `FirestoreRepository.ts:4864` | **U-8a, U-8e, U-8g, U-8h fail**; U-8b/c/d/f pass — matches `notes.md` row 1 |
| Mutation 2 (T1, outer wrap only) | unwrapped only the `runInTransaction` ALS wrap at `:5189` (inner wrap at `:4868` untouched) | **U-8a, U-8e, U-8g, U-8h fail** (same four) — `notes.md`'s table only names U-8a for this mutation; see N1 |
| Mutation 3 (T4 widen) | added an unconditional ambient-transaction refusal at the top of `runInTransaction`'s `try` block (`:5177`) | **Only U-8f fails** — precisely targeted, matches `notes.md` exactly |
| Revert verified after each mutation | `cp` backup back, `git status --short` / `git diff --stat` | empty both times; `writeInterceptors.unit.test.ts` re-run green (33/33) after final revert |
| Declaration emit, real build (not synthetic) | `grep -n "activeTransactionDb\|assertNoAmbientTransaction\|AsyncLocalStorage" dist/core/FirestoreRepository.d.ts dist/cjs/core/FirestoreRepository.d.ts` | Only `private assertNoAmbientTransaction;` (no signature) in both; `activeTransactionDb`/`AsyncLocalStorage` absent from both — no leak in the actual shipped artifact, not just a scratch compile |
| Surface the plan never named: `runReadOnlyAt` / `raw()` bypass | read `FirestoreRepository.ts:5263–5273` (`runReadOnlyAt` delegates entirely to `runInTransaction`, no separate `db.runTransaction` call); confirmed `raw()` (`:1356`) is a static unvalidated-repository factory, not an accessor that hands a caller the underlying `Firestore` instance to call `.runTransaction()` on directly | Clean — no second `runReadOnlyAt`-only code path to miss, and the only way to bypass the guard entirely is a consumer calling their own `db.runTransaction()` directly with the `Firestore` instance they themselves constructed the repository with — a pre-existing characteristic of every ORM guarantee here (hooks, interceptors, validation all have the same bypass), not something #112 introduces or could close |
| Blast radius re-confirmed on shipped code | `grep -n "\.runTransaction(" src/core/FirestoreRepository.ts` | Exactly 2 code sites (`:4869`, `:5190`), same count as the plan's baseline enumeration |

---

## Blockers

### B1 — `check:docs` fails on a self-inflicted broken link in `notes.md` (`docs/plans/issue-112-nested-transaction-guard/notes.md:141`)

**Evidence:**

```
$ npm run check:docs
✗ 1 broken documentation link(s):
  docs/plans/issue-112-nested-transaction-guard/notes.md:141  [link]  a40d5865-8b6e-460d-beb4-fb51d998d6ad
```

Line 141 reads:

```
**Reviewer:** fresh `generalPurpose` subagent ([Adversarial review #112](a40d5865-8b6e-460d-beb4-fb51d998d6ad)) · ...
```

```
[Adversarial review #112](a40d5865-8b6e-460d-beb4-fb51d998d6ad)
```

is Markdown link syntax whose target is a bare subagent session id, not a file path or URL —
`check-doc-links.mjs` correctly treats it as a relative link and fails because no such path exists.
This is exactly the failure mode this skill's own preamble warns about (#37): a claim in `notes.md`
("Full §10 gate green twice") that was sincere when the gate last actually ran, made stale by
content added to `notes.md` itself afterward — the session-id reference was almost certainly added
while finalizing the "Independent adversarial review" section, after the last real `check:docs`
run.

**Failure scenario:** any CI run, or any contributor running `npm run check:docs` locally on this
branch, gets a red exit code with no code defect behind it — and the `release:verify` superset
would fail here too.

**What closes it:** remove the link brackets so the session id renders as plain text or a code
span, e.g. `` `a40d5865-8b6e-460d-beb4-fb51d998d6ad` ``, or drop the parenthetical entirely (it is
not an externally resolvable reference for a reader of this repo). Then re-run `npm run check:docs`
— expect it to pass with the same "207 doc files" (or 208, if the edit doesn't remove a line)
count. No other leg needs re-running; all 13 others are independently confirmed green above on this
exact commit.

---

## Major

None found.

---

## Minor / nits

- **N1** — `notes.md`'s mutation-check table (`docs/plans/issue-112-nested-transaction-guard/notes.md:82`)
  under-reports which tests the "unwrap only outer `runInTransaction` ALS wrap" mutation actually
  fails. The table lists only U-8a as failing and U-8c/U-8f as still passing, but omits U-8e, U-8g,
  and U-8h — which I confirmed also fail under that exact mutation (see "What I ran" above). This is
  not a code defect (the four failures are all expected and correct: each of U-8a/e/g/h nests a
  promoted write inside *some* `runInTransaction` call, which is exactly the site this mutation
  breaks), only an incomplete accounting in the notes. **What closes it:** update the table row to
  read `U-8a, U-8e, U-8g, U-8h | Unwrap only outer runInTransaction ALS wrap (T1) | Fails (all
  four) — resolves instead of rejecting`. Not required before B1 is fixed; can land in the same
  commit.

---

## Verified and holding

- **The core mechanism is correct and precisely scoped.** All three §4 traps (T1, T2, T4) are
  genuinely pinned — reconfirmed by mutation testing I ran myself, not by trusting `notes.md`'s
  table (T4's mutation in particular fails *exactly* one test, U-8f, which is as clean a signal as
  a mutation check gets).
- **I-17's rewritten contention/retry mechanic is sound and not flaky.** Ran it five times in
  isolation against the real emulator; 5/5 green. The per-worker entry-count design genuinely fixes
  the false-green risk a shared counter would have had (two first attempts alone can hit 2 with zero
  retries) — this is a real improvement over the plan's own sketched metric.
- **Declaration emit is clean on the real, shipped build**, not just a scratch/synthetic compile —
  checked both `dist/core/FirestoreRepository.d.ts` and `dist/cjs/core/FirestoreRepository.d.ts`
  directly.
- **Every doc/ADR edit matches the plan and stays inside its stated scope.** Read the full diffs for
  `docs/adr/0040-repository-write-interceptors.md`, `patterns.md`, and
  `scope-and-capabilities.md` — the ADR amendment lands exactly where §9.2 specified and leaves
  Decision 7's paragraph and the "mode-union footgun" Consequences bullet untouched; the caution
  block rewrite matches §9.3 verbatim; `docs:build`'s output confirms no leaked `:::`.
- **Scope discipline held.** `git show --stat 7e5be56` shows exactly the 6 files the plan named
  (`FirestoreRepository.ts`, the two test files, the ADR, and the two website pages) plus
  `notes.md` — no drift into `QueryBuilder.ts`, `CollectionGroup.ts`, `Errors.ts`, `ErrorParser.ts`,
  `src/express/index.ts`, or `src/index.ts`.
- **Deviations from the plan, judged:**
  - *Inline WHY comments at the wrap/guard call sites* (notes.md "Deviations" #1) — **right call**,
    small and improves readability without changing behavior; the plan's §6 code blocks didn't
    preclude it.
  - *File-backup mutation-check procedure instead of `git stash`* (#2) — **right call**, functionally
    equivalent and what the `plan-execution` skill's restore rule asks for; I used the same
    backup-file pattern myself for the same reason.
  - *I-17 rewrite from a shared `attempts` counter to per-worker entry counts + a first-read barrier*
    (#3) — **right call, and the most valuable deviation in this implementation.** The plan's own
    sketch was genuinely false-green-capable; the adversarial self-review caught a real gap in the
    plan itself, not just in the code, and the replacement is stronger than what was asked for.

---

## Not defects

- **F4 (T3 unpinned by a test, carried from the implementer's own self-review) is correctly left as
  a named structural gap, not a missing test.** The plan's §8.3 explicitly pre-authorized this
  ("Named gap, not silently assumed... not required by this plan"), and the guard is structurally
  hard to get wrong by accident — `activeTransactionDb` is typed `AsyncLocalStorage<Firestore>`,
  not `<boolean>`, so a second-instance false positive would require someone to deliberately widen
  the type. Not re-litigated.
- **`check:consumer` only ran the local `firebase-admin@^14.0.0` leg**, not the `^12`/`^13`/pinned-firestore
  CI matrix — this matches the plan's own §5 bound (`Only Node 24.18.0 + installed firebase-admin
  exercised locally`) and is not something this review can close either; it is CI-owned by design.

---

## Verdict: BLOCKED

`check:docs` is red on the tree as committed (B1). The fix is a one-line edit to `notes.md` with no
code, test, or doc-content risk — everything substantive about the implementation (the guard
mechanism, all three traps, the ADR/docs edits, the real build's declaration emit, and I-17's
robustness) is independently verified and holds. After fixing B1 (and optionally N1 in the same
commit), re-run `npm run check:docs` and `npm run docs:build` and this should clear to APPROVE
without re-running the other 13 legs, which are confirmed green on this exact commit.
