# Issue #103 — implementation review

**Reviewer:** Cursor Grok 4.6 (implementation-review skill) · **Round:** 1 · **Reviewed:**
`7396e163dff88fb65d99756b948954ffe686a1ad`
(`feat(repository): warn once when a subclass overrides an unenforceable write method (#103)`) ·
**Branch:** `feat/issue-103-write-override-warning` · **Plan:**
`docs/plans/issue-103-write-override-warning/PLAN.md` @ baseline
`15e07d0cf1d015f43a0cdea25cc7822b31f64d83` · **Tree:** unchanged by this review (mutations and
throwaway probes reverted; `git status --porcelain` empty)

**Verdict: APPROVE WITH FIXES** — gate is green on the committed tree; one major is the T5-class
false bypass on the transactional self-delegate (`patchInTransaction` → `this.updateInTransaction`).
Omit it from `BYPASS_PATHS.updateInTransaction` and pin it with a U-3 analogue, then re-run the
write-override unit file plus the full §10 gate.

---

## What I ran

Every claim below traces to a row here. The §10 chain completed all 14 legs (`EXIT=0`); none were
skipped.

| Check | Command | Result |
| ----- | ------- | ------ |
| Full §10 gate | 14-leg `&&` chain logged to `/tmp/issue-103-gate.log`; `echo EXIT=$?` **outside** the redirected group | `EXIT=0` — every leg ran and passed |
| 1 `test:types` | `npm run test:types` | clean |
| 2 `lint` | `npm run lint` | clean |
| 3 `check:format` | `npm run check:format` | clean |
| 4 `test:unit` | `npm run test:unit` | **36 suites / 466 tests** (baseline 35/456 — up) |
| 5 `test:integration:emulator` | `npm run test:integration:emulator` | **37 suites / 548 tests** (baseline 37/548 — stay) |
| 6–7 unit coverage + gate | `test:unit:coverage` then `test:coverage:gate:unit` | all unit path gates passed |
| 8–9 integration coverage + gate | `test:integration:coverage` then `test:coverage:gate:integration` | FirestoreRepository **lines 98.30% / branches 92.48% / fns 93.62%** (thresholds 90 / 75 / 85) |
| 10 `build` | `npm run build` | clean |
| 11 `check:package` | `npm run check:package` | 102 files, allowlist satisfied |
| 12 `check:consumer` | `npm run check:consumer` | packed ESM+CJS + express subpath OK |
| 13 `check:docs` | `npm run check:docs` | 193 doc files OK |
| 14 `docs:build` | `npm run docs:build` | Complete; `rg ':::' website/dist --glob '*.html'` empty |
| Extra (not in §10) | `npm run check:zod-idioms` | OK (193 files) — no Zod snippets added |
| Probes 01–03 | `node docs/plans/.../probes/0{1,2,3}-*.mjs` after build | all `OK` (`P01/P02/P03_EXIT=0`) |
| Probe 04 | same, `04-src-baseline.mjs` | **FAIL as expected** — `process.env hits 0`, `console.warn hits 1` at `writeOverrideWarning.ts:314` |
| Dist smoke | construct base / adds-only / UpdateOverride×2 / suppressed / TwoLevelB against `dist/` | `SMOKE_WARN_COUNT 2` names `UpdateOverride,TwoLevelB` |
| Mutation T-2 | drop `'upsert'` from type-test `Write` | `TS2344: Type 'false' does not satisfy the constraint 'true'` on `_m` (`write-override-warning.type-test.ts:78`) |
| Mutation T5 | add `'patch()'` to `BYPASS_PATHS.update` | **1 failed, 9 passed** — U-3 alone |
| Mutation D2 | comment out suppress short-circuit | **1 failed, 9 passed** — U-5 alone |
| Mutation T3/T1 (no-op body) | `return;` at top of `warnIfWriteMethodsOverridden` | **4 failed, 6 passed** — U-3, U-4, U-6, U-7 (expect 1 call, received 0) |
| Mutation M1 inverse | **remove** `'patchInTransaction()'` from `BYPASS_PATHS.updateInTransaction` | **10/10 still passed** — trap unguarded |
| Revert verified | `git checkout --` after each mutation; unit file re-run after last revert | 10/10 green; `git status --porcelain` empty |
| Unnamed: identity-drop clone | overriding `DropSource` then `subcollection` + `DropSource.withSchema` | construct warns 1; extra after factories **0**; both clones `FirestoreRepository` |
| Unnamed: empty child of overriding parent | `EmptyChild extends ParentOverride` (child adds nothing) | 1 warn naming `EmptyChild` + `update()` |
| Unnamed: suppress inheritance | grandchild with new `delete` override, parent `suppress=true` | 0 warns (`inheritedFlag: true`); redeclare `false` → 1 warn naming delete+update |
| Unnamed: QueryBuilder / call sites | grep | `warnIfWriteMethodsOverridden` is only called from `FirestoreRepository.ts:559`; QueryBuilder writes go through `commitInChunks` / `runHooks`, not `repo.update()` |
| Unnamed: `patchInTransaction` self-delegate | read `FirestoreRepository.ts:4543` + `formatWriteOverrideWarning('TxOverride', ['updateInTransaction'])` | bypass line **lists** `patchInTransaction()` — see M1 |

---

## Blockers

None. Gate green; D1–D5 and T1–T10 (as specified) hold.

---

## Major

### M1 — `BYPASS_PATHS.updateInTransaction` falsely lists `patchInTransaction()` as a bypass (`src/core/writeOverrideWarning.ts:167-175`, `src/core/FirestoreRepository.ts:4535-4546`)

This is the T5 bug on the other public self-delegate. `patch` → `this.update` is correctly omitted
from `BYPASS_PATHS.update` (U-3 pins it). `patchInTransaction` is the same shape and was not
audited:

```4543:4546:src/core/FirestoreRepository.ts
    return this.updateInTransaction(tx, id, data, {
      merge: true,
      lastUpdateTime: options?.lastUpdateTime,
    });
```

A grep of `return this.(update|patch|create|delete|upsert|bulk|recursive)` in
`FirestoreRepository.ts` returns **only** those two sites (patch→update at `:2736/:2743/:2749`,
patchInTransaction→updateInTransaction at `:4543`). The prototype — and therefore this PR — copied
the false bypass:

```167:175:src/core/writeOverrideWarning.ts
  updateInTransaction: [
    'update()',
    'patch()',
    'upsert()',
    'bulkUpdate()',
    'query().update()',
    'bulkWrite()',
    'patchInTransaction()',
  ],
```

Executed: `formatWriteOverrideWarning('TxOverride', ['updateInTransaction'])` produced

```
  - updateInTransaction() is bypassed by: update(), patch(), upsert(), bulkUpdate(), query().update(), bulkWrite(), patchInTransaction()
```

Inverse mutation (delete `'patchInTransaction()'` from that array, run
`writeOverrideWarning.unit.test.ts`): **10 passed, 0 failed**. No test fails if the lie is removed,
so T5's spirit is unguarded on this pair. Contrast: adding `'patch()'` to `BYPASS_PATHS.update`
failed **U-3 alone** (1 failed / 9 passed).

U-3's `/patch\(\)/` on the `update() is bypassed by:` line does **not** catch this — that line
already contains `patchInTransaction()`, and `patch()` is not a substring of `patchInTransaction()`.

**Failure scenario:** `class TxRepo extends FirestoreRepository { override async updateInTransaction(...) { …; return super.updateInTransaction(...); } }`. First construction warns that
`patchInTransaction()` bypasses the override. A developer then “fixes” coverage by also overriding
`patchInTransaction`, or skips calling `patchInTransaction` on the subclass under the belief it
leaks. On the same instance, `patchInTransaction()` **does** enter the `updateInTransaction`
override (identity-dropped tx clones are a separate, already-documented footgun).

**What closes it:** (1) omit `'patchInTransaction()'` from `BYPASS_PATHS.updateInTransaction` (keep
it on `BYPASS_PATHS.update` — that listing is true). (2) Add a U-3 analogue: subclass overrides
`updateInTransaction`, assert the `updateInTransaction() is bypassed by:` line does not match
`/patchInTransaction\(\)/`. Do not “simplify” by adding `patch()` to the `update` list.

---

## Minor / nits

- **N1** — `BYPASS_PATHS.bulkWrite` (`writeOverrideWarning.ts:145-156`) uses a `*InTransaction()`
  glob and omits `recursiveDeleteCollection()` (and `patch` / `upsert` / `bulkPatch` / …). That
  **understates** bypasses; it does not invent a path the way M1 does. Inherited from
  `prototype.patch`; not a T5-class lie. Optional completeness only — do not block on it.

---

## Verified and holding

- **D1 / T9** — no `process.env` in `src/core/**/*.ts` (grep empty). Probe 04: `process.env hits 0`.
  Helper has no env branch (`writeOverrideWarning.ts:296-315`).
- **D2 / U-5** — `static suppressWriteOverrideWarning = false` at `FirestoreRepository.ts:500`;
  checked `=== true` at `writeOverrideWarning.ts:306` **before** detect. Mutation: comment out that
  line → U-5 alone fails (1/9). JSDoc + `patterns.md:135-136` + `repository.md:112-113` document
  static inheritance; executed: grandchild inherits silence; redeclare `false` warns again.
- **D3 / T2 / U-9** — warn is end-of-constructor (`FirestoreRepository.ts:556-559`). Class-field
  U-9 emits 0 warns. Ctor-body assignment after `super()`: executed, **0 extra warns**. Docs state
  the limitation (`patterns.md:133`, `repository.md:111-112`, helper module JSDoc).
- **D4** — message names facade / `"Enforced denormalization"` (`writeOverrideWarning.ts:283`);
  formatter test `not.toMatch(/interceptor/i)` (`writeOverrideWarning.unit.test.ts:210`).
- **D5 / T8** — `src/index.ts` has zero matches for `writeOverride` / `REPOSITORY_WRITE_METHODS`.
  Unit tests import `../../core/writeOverrideWarning.js`. `package.json` `exports` unchanged.
- **T1** — short-circuit `Ctor === baseConstructor` then suppress then `warnedConstructors.has` then
  detect; empty detect returns **without** `add` (`writeOverrideWarning.ts:304-314`). U-1 / U-2 / U-4
  pin it. No-op body fails the four warn-firing tests only.
- **T3 / T7** — `WeakSet<object>` keyed by constructor (`writeOverrideWarning.ts:239`, `:308`). U-4:
  two instances, one warn. Dist smoke: second `UpdateOverride` silent.
- **T4 / T-1 / T-2** — asserted `Missing` / `ExtraWrite` / `ExtraNonWrite` at
  `write-override-warning.type-test.ts:75-80`. Drop `'upsert'` from `Write` → `TS2344` on `_m` line
  78. Probe 03: keyof=49, missing=[], extraWrite=[], extraNonWrite=[], write on class=19.
- **T5 (update/patch)** — `BYPASS_PATHS.update` omits `patch()` (`writeOverrideWarning.ts:53-61`).
  U-3 asserts the update bypass line `not.toMatch(/patch\(\)/)`. Mutation adding `'patch()'` fails
  **U-3 alone**. `patch` is the only `this.update` delegate (`FirestoreRepository.ts:2736-2749`).
- **T6** — existing `OverlayRepo` / `OrderRepository` / `CounterRepository` add no write overrides.
  Integration 37/548 still green; U-2 silent for adds-only.
- **T10** — identity-drop sites still `new FirestoreRepository` at
  `FirestoreRepository.ts:1017`, `:1069`, `:1174`, `:4281` (4 hardcoded allocs; probe 02 `OK`).
  Executed: overriding instance then `subcollection` / `withSchema` adds **0** warns (clones are
  base `FirestoreRepository`, identity short-circuit).
- **U-1…U-9 + formatter extra** present in `writeOverrideWarning.unit.test.ts` with JSDoc header.
  U-8: runtime list length 19 vs authoritative copy.
- **Call-site isolation** — only `FirestoreRepository.ts:559` calls the helper. `src/vector/**` has
  no `extends FirestoreRepository`. QueryBuilder `update` uses `batch.update` via `commitInChunks`
  (`QueryBuilder.ts:2204-2208`), so `query().update()` in `BYPASS_PATHS.update` is a true bypass.
- **Docs §9.4 + ADR** — `patterns.md:129-136` and `:581-584`; `docs/adr/0043-write-override-warning.md`
  (Accepted, 2026-08-24) with D1–D5, alternatives, references to #103 / ADR-0040 / ADR-0042 / audit
  H1 @ `0ef66cb`; `docs/adr/README.md:73` index row. ADR-0017 untouched. CHANGELOG untouched.
  READMEs: grep for subclass/override/denorm empty on both.
- **Anti-instructions** — no throw/seal/arrows; no barrel export; no identity-site edits; no env
  gate; no ADR-0017 living-index edits.
- **Suite counts** — unit **up** 35/456 → 36/466; integration **stay** 37/548. Matches §10.
- **`:::note` / `:::caution`** — `docs:build` green; no literal `:::` in built HTML.

**Deviations from the plan:**

1. **`Function` → `ConstructorIdentity` / `WeakSet<object>`** (`writeOverrideWarning.ts:232-239`) —
   **right.** Prototype used `Function`; `@typescript-eslint/no-unsafe-function-type` fails the lint
   leg. Behavior still keyed by constructor identity. Do not revert to `Function`.
2. **`website/.../reference/repository.md` documents the static** (`repository.md:105-113`) —
   **right.** Plan §9.4 named only `patterns.md`. The flag is a public static on
   `FirestoreRepository` (docs-api-sync trigger: observable FR contract). Notes asked whether this
   is the right completeness bar: **yes** — keep it. Patterns + reference + JSDoc F5 inheritance
   note are consistent.

---

## Not defects

- **Probe 04 FAIL** after the change — expected (`console.warn` is the feature). `process.env` stayed
  0.
- **Identity-drop clones do not re-warn** — `Ctor === baseConstructor` at
  `writeOverrideWarning.ts:304`. The warning is “you overrode a method on this class,” not “this
  factory dropped subclass identity.” T10 / ADR-0040 remain out of scope.
- **Empty child of an overriding parent warns as the child** — walk climbs (`collectOverriddenWriteMethods`
  `writeOverrideWarning.ts:253-261`). Correct; U-7 is the named 2-level case (child also overrides).
- **Suppress flag inheritance silences further subclasses** — documented JS static behavior (F5),
  not a leak of the check. Redeclare `false` to warn again (executed).
- **`const Anon = class extends …` is named `Anon`** — JS name inference. Empty-name fallback is
  pinned by the formatter unit test (`writeOverrideWarning.unit.test.ts:205-207`).
- **`writeOverrideWarning.ts` has no path-specific coverage gate** — plan §5; unit tests remain
  mandatory. Do not expand `check-coverage-gates.mjs` in this PR.
- **notes.md “not committed / tree dirty”** vs current HEAD — stale relative to `7396e16` (the feat
  commit includes `notes.md`). Ignore; do not rewrite notes except to disposition this review.
- **Optional ADR-0040 backlink skipped** — plan §9.3 “only if you touch 0040.” Correct.

---

## Round 2+ [append; do not rewrite round 1]

**Implementer disposition (Round 1 → remediated):** M1 **fixed** (omit
`patchInTransaction()` from `BYPASS_PATHS.updateInTransaction` + U-3b). N1 **fixed** (concrete
`bulkWrite` bypass list + N1 unit pin). Full §10 Run 3 green: unit **36/468**, integration
**37/548**. See `notes.md` Round 1 review dispositions.
