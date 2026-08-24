# Issue #103 — Implementation notes (for adversarial review)

**Implementer:** Cursor Grok 4.5 (plan-execution + review remediation) · **Branch:**
`feat/issue-103-write-override-warning` · **Plan:**
`docs/plans/issue-103-write-override-warning/PLAN.md` · **Baseline:** `main` @
`15e07d0cf1d015f43a0cdea25cc7822b31f64d83` — no rebase required (`origin/main` still at baseline)

## Status

**Done — Round 1 review findings remediating.** Once-per-class write-override warning shipped;
implementation-review Round 1 (`review.md`) **APPROVE WITH FIXES** addressed: M1 (false
`patchInTransaction` bypass on `updateInTransaction`) + N1 (`bulkWrite` bypass completeness).
Feat commit `7396e16`; remediation commit follows on this branch.

## Ambiguities resolved

None beyond §1. Claimed ADR number **0043** after listing `docs/adr/` (0042 was highest). Living-index
`(#N–#41)` footers left untouched per §9.1 (not a deferral issue). Optional ADR-0040 backlink: skipped
(plan says only if touching 0040). READMEs declared unaffected (grepped — no subclass/override pitch).

## Deviations from the plan

1. **`Function` → `ConstructorIdentity` in `writeOverrideWarning.ts`.** The prototype used bare
   `Function` for ctor params / `WeakSet<Function>`. ESLint `@typescript-eslint/no-unsafe-function-type`
   fails the gate on those. Replaced with a small `ConstructorIdentity` object type (name /
   prototype / optional suppress flag) and `WeakSet<object>`. Behavior unchanged — still keyed by
   constructor identity. Recorded so reviewers do not treat the diff vs `prototype.patch` as drift.
2. **`reference/repository.md` also documents `suppressWriteOverrideWarning` (adversarial F1).** Plan
   §9.4 named only `patterns.md`. The public static is part of the observable FR contract, so
   docs-api-sync / adversarial review required the Static methods section on the repository reference
   page too.

## Round 1 review dispositions (`review.md` @ `7396e16`)

| Id | Severity | Disposition | Fix |
| -- | -------- | ----------- | --- |
| **M1** | Major | **Fixed** | Omit `'patchInTransaction()'` from `BYPASS_PATHS.updateInTransaction` (keep it on `BYPASS_PATHS.update`). Added **U-3b**: override `updateInTransaction`, assert that bypass line does `not.toMatch(/patchInTransaction\(\)/)`. ADR-0043 decision §6 + context updated for both self-delegates. |
| **N1** | Minor / nit | **Fixed** (completeness) | Expand `BYPASS_PATHS.bulkWrite` to concrete sibling paths — drop `*InTransaction()` glob; add `patch` / `upsert` / `bulkPatch` / `createWithId` / `bulkCreateWithIds` / each `*InTransaction()` / `recursiveDeleteCollection()`. Pinned by **N1** unit test via `formatWriteOverrideWarning(..., ['bulkWrite'])`. |

Not defects (per review — no code change): Probe 04 FAIL expected; identity-drop clones silent;
empty child naming; suppress inheritance; Anon name inference; no path-specific coverage gate for
helper; optional ADR-0040 backlink skipped.

## Files touched and why

| File | Change | Plan / review reference |
| ---- | ------ | ----------------------- |
| `src/core/writeOverrideWarning.ts` | create + M1/N1 bypass fixes | §6.1 / M1 / N1 |
| `src/core/FirestoreRepository.ts` | import + static + ctor call + inheritance JSDoc (F5) | §6.1 / P19 |
| `src/tests/types/write-override-warning.type-test.ts` | create | §6.3 / §8.2 |
| `src/tests/unit/writeOverrideWarning.unit.test.ts` | U-1…U-9 + U-3b + N1 + D4 | §8.1 / M1 / N1 |
| `website/.../guides/advanced/patterns.md` | warn + opt-out + inheritance note | §9.4 |
| `website/.../reference/repository.md` | document static flag (F1) | deviation 2 |
| `docs/adr/0043-write-override-warning.md` | create + self-delegate decision §6 | §9.2 / M1 |
| `docs/adr/README.md` | index row | §9.3 |
| `docs/plans/.../notes.md` | this file | skill |
| `docs/plans/.../review.md` | Round 1 review artifact | review |

## Edge cases / traps handled

| Trap | Handled by | Pinned by |
| ---- | ---------- | --------- |
| T1 | short-circuit order in `warnIfWriteMethodsOverridden` | U-2, U-4 |
| T2 | docs/JSDoc state limitation; no instance walk | U-9 |
| T3 | `WeakSet` keyed by constructor | U-4 |
| T4 | `AssertTrue<ExpectEqual<…>>` both sides | T-1 / T-2 mutation |
| T5 | `BYPASS_PATHS.update` omits `patch()` | U-3 |
| T5-tx (M1) | `BYPASS_PATHS.updateInTransaction` omits `patchInTransaction()` | U-3b |
| T6 | adds-only silent; no existing subclass changes | U-2 |
| T7 | unique classes / describe-scoped once class | U-4 |
| T8 | no barrel export | grep `src/index.ts` empty |
| T9 | no `process.env` | grep new files empty |
| T10 | identity sites untouched | probe 02 OK post-change |
| N1 | concrete `bulkWrite` bypass list | N1 unit test |

## Tests added

| Id | Suite | Asserts | Guards |
| -- | ----- | ------- | ------ |
| U-1 | unit | base → no warn | T3 short-circuit |
| U-2 | unit | adds-only → no warn | T6 / P4 |
| U-3 | unit | update override warns; no `patch()` in update bypasses | T5 |
| U-3b | unit | updateInTransaction override; no `patchInTransaction()` on that bypass line | M1 / T5-tx |
| U-4 | unit | second instance → still one warn | T3 / T7 |
| U-5 | unit | suppress flag → no warn | D2 |
| U-6 | unit | update+bulkUpdate both named | P6 |
| U-7 | unit | 2-level chain names delete+update | P5 |
| U-8 | unit | REPOSITORY_WRITE_METHODS = 19-name list | durability |
| U-9 | unit | class-field override → no warn (ctor-time non-detection) | T2 |
| N1 | unit | bulkWrite bypass concrete; no glob; includes recursiveDeleteCollection | N1 |
| (extra) | unit | empty className + `not.toMatch(/interceptor/i)` | §5 / D4 |
| T-1 | type | Missing/Extra* = never via AssertTrue | T4 |

## Mutation checks

Restored via file backup (`cp` of pre-mutation file), never `git checkout` / `git restore`.

| Test | Mutation | Result |
| ---- | -------- | ------ |
| T-2 | Drop `'upsert'` from `Write` (not added to `NonWrite`) | **Fails** — `TS2344` on `_m` assert line |
| U-3/U-4/U-6/U-7 | No-op `warnIfWriteMethodsOverridden` body | **Fails** — Expected 1 call, received 0 |
| U-3 | Add `'patch()'` to `BYPASS_PATHS.update` | **Fails** — `expect(...).not.toMatch(/patch\(\)/)` |
| U-5 | Comment out suppress short-circuit | **Fails** — Expected 0 calls, received 1 |
| U-3b (M1) | Re-add `'patchInTransaction()'` to `BYPASS_PATHS.updateInTransaction` | **Fails** — U-3b alone (`not.toMatch(/patchInTransaction\(\)/)`) |

## Gate results

Baseline plan predicted: unit **35/456 → up**; integration **37/548 → stay**.

### Run 1 (after implementation, before adversarial fixes)

```
npm run test:types                         ✓
npm run lint                               ✓ (after ConstructorIdentity fix; first attempt failed on Function)
npm run check:format                       ✓ (after prettier --write on ADR + helper)
npm run test:unit                          ✓ 36 suites / 466 tests  (was 35 / 456)
npm run test:integration:emulator          ✓ 37 suites / 548 tests  (unchanged)
npm run test:unit:coverage + gate:unit     ✓ all unit path gates passed
npm run test:integration:coverage + gate   ✓ FirestoreRepository lines 98.30% / branches 92.48% / fns 93.62%
npm run build                              ✓
npm run check:package                      ✓
npm run check:consumer                     ✓ firebase-admin@^14.0.0 ESM+CJS + express subpath
npm run check:docs                         ✓ 193 doc files
npm run docs:build                         ✓; grepped built HTML — no leaked `:::`
```

Dist smoke: `WARN_COUNT 2` (UpdateOverride, TwoLevelB). Probes 01–03 OK; probe 04 FAIL as expected
(`console.warn` now exists).

### Run 2 (after adversarial F1/F3/F4/F5 fixes)

All 14 legs re-run — all ✓. Suite counts unchanged: unit **36/466**, integration **37/548**.
`docs:build` again; no leaked `:::`.

### Run 3 (after Round 1 M1 / N1 remediation)

Full 14-leg §10 gate — `EXIT=0` (logged `/tmp/issue-103-gate-r3.log`).

| Check | Result |
| ----- | ------ |
| test:types / lint / check:format | ✓ |
| test:unit | ✓ **36 suites / 468 tests** (+2: U-3b, N1) |
| test:integration:emulator | ✓ **37 / 548** (unchanged) |
| unit coverage + gate | ✓ |
| integration coverage + gate | ✓ FirestoreRepository lines 98.30% / branches 92.48% / fns 93.62% |
| build / check:package / check:consumer / check:docs / docs:build | ✓ |

M1 mutation: re-add `'patchInTransaction()'` to `BYPASS_PATHS.updateInTransaction` → **1 failed /
11 passed** (U-3b alone). Restored; 12/12 green.
## Anti-instructions checklist

| Anti-instruction | Confirmed |
| ---------------- | --------- |
| No `NODE_ENV` / `process.env` gate | ✓ grep helper empty |
| No barrel export of write list / helpers | ✓ `src/index.ts` empty for writeOverride |
| No identity-drop site edits | ✓ sites at ~1017/1069/1174/4281 still `new FirestoreRepository` |
| No `patch()` as bypass of `update` | ✓ `BYPASS_PATHS.update` + U-3 |
| No `patchInTransaction()` as bypass of `updateInTransaction` | ✓ `BYPASS_PATHS.updateInTransaction` + U-3b |
| No claim field-style detection | ✓ docs/JSDoc/U-9 state limitation |
| No throw / seal / arrows | ✓ warn-only |
| No ADR-0017 living-index updates | ✓ 0017 untouched |
| No hand-edit CHANGELOG | ✓ not in diff |

## §11 audit

| §11 item | Result | Evidence |
| -------- | ------ | -------- |
| 1 D1–D5 honored | PASS | no env; static on FR; ctor-only walk; facade string; no barrel |
| 2 prototype.patch applied + §6.1 invariants | PASS | helper + FR wiring; ConstructorIdentity + M1/N1 deltas |
| 3 Type-test green; T-2 mutation | PASS | `write-override-warning.type-test.ts` |
| 4 U-1…U-9 + U-3b + N1; load-bearing fail unfixed | PASS | unit file; mutations including M1 re-add |
| 5 Docs §9.4 + ADR + index; READMEs unaffected | PASS | patterns + repository + ADR-0043 + index |
| 6 §7 anti-instructions | PASS | checklist above |
| 7 Full gate green; suite counts | PASS | Runs 1–2; Run 3 after M1/N1 |
| 8 notes.md | PASS | this file |
| 9 Probes promoted to committed tests | PASS | §8 unit/type tests; `probes/` retained for review |
| 10 Plan dir removed after review | N/A yet | left in place per skill |

## Independent adversarial review (pre-commit WIP)

**Reviewer:** Task subagent · **Verdict:** pass with fixes → remediated (F1/F3/F4/F5)

## Round 1 implementation review

**Reviewer:** Cursor Grok 4.6 (implementation-review skill) · **Reviewed:** `7396e16` ·
**Verdict:** APPROVE WITH FIXES → M1 + N1 remediating in this notes revision.

## Could-not-verify

Carried from plan §5 (still honest):

- Emulator re-probe of the 2/9 · 1/8 · 1/7 override reachability matrix not re-run (accepted from
  audit / ADR-0040).
- `writeOverrideWarning.ts` has no path-specific coverage gate (by design; unit tests mandatory).
- Serverless cold-start noise not measured.
- Full anonymous-class *construction* smoke not run (formatter empty-name path is unit-covered).

Cleared vs plan §5:

- Full 14-leg gate — run twice on feat; Run 3 after M1/N1.
- Dist smoke — `WARN_COUNT 2` as prototype expected.

## Open questions for the reviewer

None. Round 1 M1/N1 closed.
