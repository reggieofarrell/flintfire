# Issue #103 — Implementation notes (for adversarial review)

**Implementer:** Cursor Grok 4.5 (plan-execution) · **Branch:**
`feat/issue-103-write-override-warning` · **Plan:**
`docs/plans/issue-103-write-override-warning/PLAN.md` · **Baseline:** `main` @
`15e07d0cf1d015f43a0cdea25cc7822b31f64d83` — no rebase required (`origin/main` still at baseline)

## Status

**Done — pending external review.** Once-per-class write-override warning shipped: helper module,
`FirestoreRepository` wiring, type + unit tests (mutation-checked), ADR-0043, patterns + repository
reference docs. Full §10 gate green twice (before and after adversarial fixes). Plan directory left
in place; **not committed** (user did not ask).

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

## Files touched and why

| File | Change | Plan reference |
| ---- | ------ | -------------- |
| `src/core/writeOverrideWarning.ts` | create (from patch + ConstructorIdentity lint fix) | §6.1 |
| `src/core/FirestoreRepository.ts` | import + static + ctor call + inheritance JSDoc (F5) | §6.1 / P19 |
| `src/tests/types/write-override-warning.type-test.ts` | create | §6.3 / §8.2 |
| `src/tests/unit/writeOverrideWarning.unit.test.ts` | create U-1…U-9 + D4 interceptor negative | §8.1 |
| `website/.../guides/advanced/patterns.md` | warn + opt-out + inheritance note | §9.4 |
| `website/.../reference/repository.md` | document static flag (F1) | deviation 2 |
| `docs/adr/0043-write-override-warning.md` | create | §9.2 |
| `docs/adr/README.md` | index row | §9.3 |
| `docs/plans/.../notes.md` | this file | skill |

## Edge cases / traps handled

| Trap | Handled by | Pinned by |
| ---- | ---------- | --------- |
| T1 | short-circuit order in `warnIfWriteMethodsOverridden` | U-2, U-4 |
| T2 | docs/JSDoc state limitation; no instance walk | U-9 |
| T3 | `WeakSet` keyed by constructor | U-4 |
| T4 | `AssertTrue<ExpectEqual<…>>` both sides | T-1 / T-2 mutation |
| T5 | `BYPASS_PATHS.update` omits `patch()` | U-3 |
| T6 | adds-only silent; no existing subclass changes | U-2 |
| T7 | unique classes / describe-scoped once class | U-4 |
| T8 | no barrel export | grep `src/index.ts` empty |
| T9 | no `process.env` | grep new files empty |
| T10 | identity sites untouched | probe 02 OK post-change |

## Tests added

| Id | Suite | Asserts | Guards |
| -- | ----- | ------- | ------ |
| U-1 | unit | base → no warn | T3 short-circuit |
| U-2 | unit | adds-only → no warn | T6 / P4 |
| U-3 | unit | update override warns; no `patch()` in update bypasses | T5 |
| U-4 | unit | second instance → still one warn | T3 / T7 |
| U-5 | unit | suppress flag → no warn | D2 |
| U-6 | unit | update+bulkUpdate both named | P6 |
| U-7 | unit | 2-level chain names delete+update | P5 |
| U-8 | unit | REPOSITORY_WRITE_METHODS = 19-name list | durability |
| U-9 | unit | class-field override → no warn (ctor-time non-detection) | T2 |
| (extra) | unit | empty className + `not.toMatch(/interceptor/i)` | §5 / D4 |
| T-1 | type | Missing/Extra* = never via AssertTrue | T4 |

## Mutation checks

Restored via file backup (`cp` of pre-mutation file), never `git checkout` / `git restore`.

| Test | Mutation | Result |
| ---- | -------- | ------ |
| T-2 | Drop `'upsert'` from `Write` (not added to `NonWrite`) | **Fails** — `TS2344: Type 'false' does not satisfy the constraint 'true'` on `_m` assert line |
| U-3/U-4/U-6/U-7 | No-op `warnIfWriteMethodsOverridden` body | **Fails** — Expected 1 call, received 0 |
| U-3 | Add `'patch()'` to `BYPASS_PATHS.update` | **Fails** — `expect(...).not.toMatch(/patch\(\)/)` |
| U-5 | Comment out suppress short-circuit | **Fails** — Expected 0 calls, received 1 |

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

## Anti-instructions checklist

| Anti-instruction | Confirmed |
| ---------------- | --------- |
| No `NODE_ENV` / `process.env` gate | ✓ grep helper empty |
| No barrel export of write list / helpers | ✓ `src/index.ts` empty for writeOverride |
| No identity-drop site edits | ✓ sites at ~1017/1069/1174/4281 still `new FirestoreRepository` |
| No `patch()` as bypass of `update` | ✓ `BYPASS_PATHS.update` + U-3 |
| No claim field-style detection | ✓ docs/JSDoc/U-9 state limitation |
| No throw / seal / arrows | ✓ warn-only |
| No ADR-0017 living-index updates | ✓ 0017 untouched |
| No hand-edit CHANGELOG | ✓ not in diff |
| No commit unless asked | ✓ tree dirty, uncommitted |

## §11 audit

| §11 item | Result | Evidence |
| -------- | ------ | -------- |
| 1 D1–D5 honored | PASS | no env; static at `FirestoreRepository.ts:500`; ctor-only walk; facade string at `writeOverrideWarning.ts:283`; no barrel |
| 2 prototype.patch applied + §6.1 invariants | PASS | `src/core/writeOverrideWarning.ts` + FR wiring; ConstructorIdentity deviation only |
| 3 Type-test green; T-2 mutation | PASS | `write-override-warning.type-test.ts`; mutation recorded above |
| 4 U-1…U-9; load-bearing fail unfixed | PASS | `writeOverrideWarning.unit.test.ts`; mutations A/B/C |
| 5 Docs §9.4 + ADR + index; READMEs unaffected | PASS | patterns.md + repository.md + `docs/adr/0043-…` + README index |
| 6 §7 anti-instructions | PASS | checklist above |
| 7 Full gate green; suite counts | PASS | Run 1 + Run 2; 36/466 unit, 37/548 int |
| 8 notes.md | PASS | this file (uncommitted with the rest — user forbade commit) |
| 9 Probes promoted to committed tests | PASS | §8 unit/type tests; `probes/` retained for review |
| 10 Plan dir removed after review | N/A yet | left in place per skill |

## Independent adversarial review

**Reviewer:** Task subagent (fresh context, inherit model) · **Reviewed:** uncommitted WIP ·
**Fixes in:** same WIP · **Verdict:** pass with fixes → remediated

Handed: diff, PLAN.md, implementation + tests — **not** these notes. Prompted to refute.

### Findings fixed

1. **F1 major — public static missing from repository reference** — added
   `static suppressWriteOverrideWarning` under Static methods in
   `website/src/content/docs/reference/repository.md` (also patterns inheritance note).
2. **F3 minor — U-9 overclaimed “accidental instance walk”** — softened test comment to “documents
   ctor-time non-detection.”
3. **F4 minor — no negative interceptor assertion** — formatter test
   `expect(message).not.toMatch(/interceptor/i)`.
4. **F5 minor — suppress flag inheritance undocumented** — JSDoc on FR static + patterns + reference.

### Findings not treated as defects

- **F2 major — full §10 not evidenced** — reviewer lacked gate output (notes deliberately withheld).
  Implementer had already run all 14 legs; re-ran after fixes (Run 2).
- **F6 nit — “is bypassed by” wording** — matches `prototype.patch` / plan; optional polish only.

### Findings deferred

- None. Optional follow-up for field-style via ADR-0040 choke point remains plan §9.6 (not opened —
  ADR text carries the deferral).

### Gate re-run after fixes

See Gate results → Run 2. All legs green.

## Could-not-verify

Carried from plan §5 (still honest):

- Emulator re-probe of the 2/9 · 1/8 · 1/7 override reachability matrix not re-run (accepted from
  audit / ADR-0040).
- `writeOverrideWarning.ts` has no path-specific coverage gate (by design; unit tests mandatory).
- Serverless cold-start noise not measured.
- Full anonymous-class *construction* smoke not run (formatter empty-name path is unit-covered).

Cleared vs plan §5:

- Full 14-leg gate — now run twice.
- Dist smoke — `WARN_COUNT 2` as prototype expected.

## Open questions for the reviewer

None blocking. Confirm whether F1's repository.md addition (beyond plan §9.4) is the right docs
surface completeness bar for a new public static.
