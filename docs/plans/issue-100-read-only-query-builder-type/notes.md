# Issue #100 — Implementation notes (for adversarial review)

**Implementer:** Cursor Grok 4.5 (plan-execution) · **Branch:** `feat/issue-100-read-only-query` ·
**Plan:** `docs/plans/issue-100-read-only-query-builder-type/PLAN.md` · **Baseline:** `main` @
`b999f40`. Rebase onto `origin/main` was a no-op (branch already contained `b999f40` + plan commits).
§3.6 line numbers re-verified — **no drift** (E1 class close still `:2290` before insert).

## Status

**Done — pending external review.** `ReadOnlyQuery` exported (root + `/vector`), type tests T-1…T-12
plus §8.3 sibling-terminal overload pins, facade guide/type-test updated, ADR-0041 Accepted in place,
website docs swept. Full §10 gate green twice (pre- and post-self-review). Plan directory left in
place. Not committed (owner decides).

## Ambiguities resolved

1. **§9.3 tip vs plain prose** — used `:::tip[Handing out the query builder safely]` as the plan's
   primary suggestion; closing `:::` on its own line with a blank line before it (T7 / F3).
2. **§8.4 restore** — skill forbids `git checkout` on a dirty tree; used `/tmp` file backup of
   `QueryBuilder.ts` and restored from that copy.
3. **Lint: `orderRepo` type-only use** — constructed `const svc = new OrderService(orderRepo)` instead
   of `declare const svc`, so eslint `@typescript-eslint/no-unused-vars` is satisfied (probes are not
   linted; committed type tests are).

## Deviations from the plan

1. **§8.4 restore method.** Plan says `git checkout -- src/`; skill forbids that on a dirty tree.
   Mutations used a file backup. Diagnostics matched plan expectations.
2. **§6.1 formatting.** Prettier wrapped a few single-line clause signatures (`orderBy`, `startAt`,
   …) after insert. Semantics identical; F4 from self-review treats this as a nit only.
3. **T-5 siblings expanded beyond the minimal §8.1 table.** Plan §8.3 says getOne/stream/paginate/
   offsetPaginate/paginateWithCount need T-5-pattern pins; the §8.1 table only listed `get`
   explicitly. Independent review proved the five siblings can be restated with
   `Parameters`/`ReturnType` while `test:types` stays green — added
   `metadataOverloadsSurviveOmitOnSiblingTerminals` (F1 fixed).
4. **Fresh LCOV vs §3.5 on-disk baseline.** Integration `QueryBuilder.ts` measured **96.57 / 86.44 /
   100.00** (plan cited 96.39 / 86.50 / 100.00 from LCOV already on disk). Diff is **+122 type/comment
   lines only** (no executable statements). Unit `index.ts` remains **100 / 100 / 75.76**. Gates pass
   with headroom. Treat §3.5 as a stale snapshot, not a regression.

## Files touched and why

| File | Change | Plan reference |
| ---- | ------ | -------------- |
| `src/core/QueryBuilder.ts` | Insert `ReadOnlyQuery` + `ReadOnlyQueryClauseKeys` after class close | §6.1 / E1 |
| `src/index.ts` | Re-export `ReadOnlyQuery` | §6.2 / E4 |
| `src/vector/index.ts` | Re-export `ReadOnlyQuery` + comment | §6.3 / E5 |
| `src/tests/types/read-only-query.type-test.ts` | New — T-1…T-12 + sibling metadata overload pins | §8.1 / E6 |
| `src/tests/unit/packageExports.unit.test.ts` | Type-only runtime absence assert | §8.2 / E8 |
| `src/tests/types/enforced-denormalization-facade.type-test.ts` | Facade `query()` + write-chain guards; header/JSDoc | §9.5 / E7 |
| `docs/adr/0041-read-only-query-builder-type.md` | Accepted + decisions 3/4/7/8 + scope resolved | §9.1 / E9 |
| `docs/adr/README.md` | Status cell | §9.1 / E10 |
| `website/.../reference/types.md` | `ReadOnlyQuery` bullet | §9.2 / E11 |
| `website/.../reference/query-builder.md` | Sentence + `## Read-only view` | §9.2 / E12 |
| `website/.../guides/advanced/patterns.md` | Facade accessor + tip (caveat aside deleted) | §9.3 / E13 |
| `website/.../guides/working-with-data/queries.md` | Two cross-links | §9.3 / E14 |
| `website/.../guides/designing/security-boundary.md` | New section before Out of scope | §9.3 / E15 |
| `docs/plans/.../notes.md` | This file | skill |

## Edge cases / traps handled

| Trap | Handled by | Pinned by |
| ---- | ---------- | --------- |
| T1 | Terminals inherited through `Omit` only | T-5 + sibling metadata pins (getOne/stream/paginate/offsetPaginate/paginateWithCount); T-6; T-7; T-8 |
| T2 | Asserted two-sided Missing/Extra | T-1 / T-2 |
| T3 | Per-clause `NoWrites` matrix + chain `@ts-expect-error`s | T-3 / T-4 |
| T4 | Clause keys listed + re-declared | T-3 + `test:types` (M3 → TS2430) |
| T5 | Helper not tagged `@internal` | `build` / `check:package` / `check:consumer`; emitted `.d.ts` |
| T6 | `W` kept with `@template` note | T-9 (W ≠ T + defaulted) |
| T7 | Tip closing fence on own line + blank line before | §10 step 6 greps empty |
| T8 | Exact `## Read-only view` heading | `check:docs` |

## Tests added

| Id | Suite | Asserts | Guards |
| -- | ----- | ------- | ------ |
| T-1 / T-2 | `test:types` | Asserted Missing / Extra = never | T2 |
| T-3 | `test:types` | 13× `NoWrites<ReturnType<RO[k]>>` | T3, T4 |
| T-4 | `test:types` | `@ts-expect-error` at five+ chain depths | T3 |
| T-5 + siblings | `test:types` | `withMetadata: true` overload survival on get + five siblings | T1 |
| T-6 / T-7 | `test:types` | aggregate Spec / distinctValues K | T1 |
| T-8 | `test:types` | both `whereId` overloads | T1 |
| T-9 | `test:types` | no-cast facade + W phantom | T6, D2 |
| T-10 | `test:types` | select DeepPartial re-parameterization | T3 |
| T-11 / T-12 | `test:types` | root + `/vector` imports | E4, E5 |
| packageExports | unit | `ReadOnlyQuery` undefined at runtime | value-export slip |
| facade type-test | `test:types` | §9.5 surface + blocked writes on `query()` | docs pin |

## Mutation checks

Restored via `/tmp/QueryBuilder.ts.issue100.bak` (not `git checkout`).

| Test | Mutation | Result |
| ---- | -------- | ------ |
| T-1 | Delete `orderById(...)` from interface; leave key in clause union | **Fails** — `TS2344` at `_t1` (`Type 'false' does not satisfy the constraint 'true'`); also TS2344/TS2339 on `_c05` |
| T-3 `where` row | `where` return type → `FirestoreQueryBuilder<T,W,S,R>` | **Fails** — `TS2344` at `_c01`; T-1/T-2 clean; + TS2578 unused `@ts-expect-error` ×3; + TS2322 on `facadeDefaultedW` (M2′) |
| `extends` / T4 | `'where'` → `'wheer'` in `ReadOnlyQueryClauseKeys` | **Fails** — `TS2430` at `ReadOnlyQuery` interface |

Probe `04-mutations.cjs` also re-run post-implementation: **ALL 5 EXPECTATIONS HOLD**.

## Gate results

Suite counts: unit **35 / 455 → 35 / 456**; integration **37 / 548 → 37 / 548** (unchanged).

### Run 1 (pre self-review)

```
npm run test:types                         ✓
npm run lint                               ✓ (after orderRepo fix)
npm run check:format                       ✓ (after prettier on ADR + QueryBuilder)
npm run test:unit                          ✓ 35 suites / 456 tests
npm run test:integration:emulator          ✓ 37 suites / 548 tests
npm run test:unit:coverage + gate:unit     ✓ index.ts 100/100/75.76
npm run test:integration:coverage + gate   ✓ QueryBuilder 96.57/86.44/100
npm run build                              ✓
npm run check:package                      ✓
npm run check:consumer                     ✓ firebase-admin@^14.0.0 (local peer leg)
npm run check:docs                         ✓
npm run check:zod-idioms                   ✓ 191 files
npm run docs:build                         ✓; built HTML `:::` greps empty
```

### Run 2 (after F1/F3 fixes)

Same 15 legs — all ✓ again. Unit 35/456; integration 37/548. `:::` greps empty;
`terminating helpers` grep empty; `Omit<FirestoreQueryBuilder` only in
`reference/query-builder.md` explanatory sentence (acceptable per §10 step 8).

### §10 steps 5–8

5. Probes re-run: `01`/`02`/`03` → 0 diagnostics; `04` → all 5 hold; `05` → 5 PASS.
6. `grep ':::'` on patterns / security-boundary / query-builder built HTML → no matches.
7. `terminating helpers` → no matches (PASS).
8. `Omit<FirestoreQueryBuilder` → only intentional anti-pattern callout in `query-builder.md`.

## Anti-instructions checklist

| Anti-instruction | Confirmed |
| ---------------- | --------- |
| Do not commit/push unless asked | Yes — uncommitted |
| Do not touch QB / base / CollectionGroup / VectorQueryBuilder | Yes — append-only after class close |
| Do not add runtime statement to `src/index.ts` | Yes — `export type` only |
| Do not restate terminals with Parameters/ReturnType | Yes |
| Do not write bare Missing guard | Yes — AssertTrue |
| Do not derive clause keys from conditional | Yes — explicit union |
| Do not tag helper `@internal` | Yes |
| Do not drop W / @template | Yes |
| Do not simplify to Omit | Yes |
| Do not ADR-0017 / living-index / scope-and-capabilities | Yes — grepped, untouched |
| Do not create a new ADR | Yes — 0041 in place |
| Do not format website/ via prettier | Yes — hand-edited |
| Do not touch CHANGELOG / docs/2.0 | Yes |
| Do not write review.md | Yes — dispositions here |

## §11 audit

| §11 item | Result | Evidence |
| -------- | ------ | -------- |
| Branch checked out / rebased; §3.6 re-verified | PASS | `feat/issue-100-read-only-query` @ plan tip; E1 still `:2290` pre-insert |
| §6.1 in QueryBuilder, no new imports | PASS | `src/core/QueryBuilder.ts` after class `}` |
| Root + vector re-exports | PASS | `src/index.ts`, `src/vector/index.ts`; `dist/*.d.ts` |
| Type test T-1…T-12 asserted | PASS | `src/tests/types/read-only-query.type-test.ts` (+ sibling T-5 pins) |
| §8.4 mutations recorded | PASS | this notes § Mutation checks |
| packageExports 455→456 | PASS | unit output |
| facade type-test §9.5 all five | PASS | file |
| ADR-0041 + README status | PASS | Accepted (v3.x, pending merge/release) |
| types.md + query-builder `## Read-only view` | PASS | exact heading |
| patterns / queries / security-boundary | PASS | files |
| No §9.4 forbidden edits | PASS | git status / greps |
| Full §10 + steps 5–8 | PASS | Gate results above |
| No §7 violations | PASS | checklist |
| Self-review dispositioned | PASS | below |
| Plan dir removal | deferred | after external review |

## Independent adversarial review

**Reviewer:** fresh `generalPurpose` subagent (refute-first; given diff + plan + tests; **not** these
notes) · **Reviewed:** working tree pre-F1 · **Fixes in:** working tree post-F1/F3 · **Verdict after
fixes:** pass with fixes applied

### Findings fixed

1. **F1 blocker — T1 unguarded for getOne/stream/paginate/offsetPaginate/paginateWithCount** —
   Added `metadataOverloadsSurviveOmitOnSiblingTerminals` with `AssertTrue<ExpectEqual<…>>` per
   terminal. Reviewer proved restating those five left `test:types` green before the fix.
2. **F3 minor — blank line before tip closing `:::`** — Inserted blank line in `patterns.md`.
3. **F2 major — gate evidence** — Full §10 was already run; re-run after fixes and recorded as Run 2.

### Findings not treated as defects

- **F4 nit — §6.1 not character-verbatim (prettier wrap)** — Semantics identical; prettier-clean is
  the house rule. Left as-is.

### Findings deferred

- None.

### Gate re-run after fixes

Run 2 above — all 15 legs green; suite counts unchanged vs Run 1.

## Could-not-verify

Carried from plan §5:

1. `check:consumer` covers one peer major locally (`firebase-admin@^14.0.0`). CI fan-out over ^12/^13
   and pinned-firestore ^12 not run here.
2. Strict-pnpm consumer resolution not exercised (declaration emit / V8 shows no undeclared package).

## Open questions for the reviewer

None — F1 gap is closed; ready for external `review.md`.
