# Issue #103 — Warn once per class when a subclass overrides a write method it cannot enforce

**Implementer:** Cursor Cloud Agent / teammate · **Reviewer:** maintainer · **Baseline:** `main` @
`15e07d0cf1d015f43a0cdea25cc7822b31f64d83` (`chore: clean up`) · **Branch:**
`feat/issue-103-write-override-warning` — already created and pushed with this plan on it; check it
out, do not cut a new one

**Issue:** [#103](https://github.com/reggieofarrell/flintfire/issues/103) — labels `enhancement`.
This is **not** in ADR-0017's `#35–#41` parity/`v3.x` deferral set. It is an additive guardrail for
the H1 subclass-override footgun (docs already corrected in PR #101). Deferral bookkeeping
(ADR-0017 amendment blockquotes / living-index footers) does **not** apply.

> **Acceptance (derived from the issue proposal — the issue states no separate AC block):** A
> once-per-class `console.warn` from the base constructor when a subclass overrides one of the 19
> public write methods; keyed by constructor in a module-level set; zero cost for plain
> `FirestoreRepository` instances; silent for method *additions*; documented static opt-out
> `suppressWriteOverrideWarning = true`; no `NODE_ENV` gate; type-test drift guard so a new public
> method must be classified write-or-non-write; additive / non-breaking (warn, do not throw / seal).

---

## §0 How to use this plan

1. Read §1 (settled — do not re-litigate) and §4 (traps) **before** writing code.
2. §6 carries the **contract**; method bodies live in `prototype.patch` (gated for `test:types` +
   runtime smoke on this baseline — see §12). Apply the patch, replace any remaining gaps with real
   JSDoc already present in the patch, then follow §7–§10.
3. Every claim in §3 was produced by an executed probe on this baseline. Probes are in
   `docs/plans/issue-103-write-override-warning/probes/` — re-run them if you doubt one. **Do not
   trust the issue body over §3** (its line numbers are stale — see §2).
4. Prototype was scoped to the warning module + constructor wiring. Legs run: `npm run test:types`
   (clean), `npm run build`, runtime smoke against `dist` (2 warns for UpdateOverride + TwoLevelB;
   base / adds-only / suppressed / second instance silent). Full 14-leg gate was **not** run on the
   prototype — expect the implementer to run §10.
5. **Follow the `plan-execution` skill** — it owns the implementer's contract: `notes.md` written as
   you go, the mutation checks, and the independent refute-first self-review you must pass before
   declaring this ready for external review.

---

## §1 Owner-approved decisions

| Id     | Fork | Decision | Rejected alternative and why |
| ------ | ---- | -------- | ---------------------------- |
| **D1** | Gate the warning on `NODE_ENV` / other env? | **Never gate.** Always emit (once per class per process), including production. | Skipping in production suppresses the warning where a silent denorm miss is most expensive. Introducing `process.env` would be the library's first env-dependent behavior (`src/` has zero today — P12). Opt-out (D2) covers deliberate silence. |
| **D2** | Opt-out API shape | **`static suppressWriteOverrideWarning = true` on the subclass**, checked in the base constructor via `this.constructor`. Default `false` on `FirestoreRepository` itself for discoverability. | Module registry API / Symbol key: more surface for no gain when the warning is already keyed by constructor. Env-var opt-out: rejected with D1. |
| **D3** | Constructor-only vs lazy-on-write | **Constructor-time check only** in this PR. Field-style / ctor-body overrides remain a known blind spot until ADR-0040's write choke point. | Lazy-on-first-write now: no single choke point today (`runUpdate` has 2 call sites; `commitInChunks` has 5). Sealing / throwing: rejected in the issue (breaks `jest.spyOn`, `super.update()`, memory, still defeatable). |
| **D4** | Warning redirect text | Point at the **facade** pattern ("Enforced denormalization" docs). When ADR-0040 ships, only the redirect half of the string changes to "register a write interceptor." | Pointing at interceptors today would lie — ADR-0040 is still Proposed / unshipped. |
| **D5** | Public barrel export of `REPOSITORY_WRITE_METHODS`? | **Do not** re-export from `src/index.ts`. Keep the const in `src/core/writeOverrideWarning.ts`; the type-test hardcodes the same 19 names; unit tests import the module by relative path. | Exporting adds docs-api-sync / packageExports work for an internal classification list. `(derived, not asked)` |

Do not re-litigate D1–D5.

---

## §2 Scope

### In scope

| Area | Change |
| ---- | ------ |
| `src/core/writeOverrideWarning.ts` | New module: write-method list, prototype walk, message formatter, once-per-class `WeakSet`, `warnIfWriteMethodsOverridden` |
| `src/core/FirestoreRepository.ts` | Import + end-of-constructor call; `static suppressWriteOverrideWarning = false` with JSDoc |
| Unit tests | Behavior matrix for warn / silence / once / suppress / multi-override / 2-level chain |
| Type tests | Two-sided write ∪ non-write partition of `keyof FirestoreRepository<…>` (drift guard) |
| Docs | `website/.../guides/advanced/patterns.md` — document the warning + opt-out next to the existing "why not override" / custom-methods caveats |
| ADR | New Accepted ADR (claim next free number; expect 0043 on this baseline) |

### Explicitly **out** of scope

- **Fixing** override coverage / restoring subclass identity in `withSchema` / `subcollection` /
  `runInTransaction` — that is ADR-0040 / #80 territory, not this guardrail.
- **Lazy field-style / ctor-body override detection** — deferred until a write choke point exists
  (D3).
- **Sealing** methods, converting to instance arrows, or throwing on override.
- **Changing** any write method signatures or return contracts.
- **Exporting** `REPOSITORY_WRITE_METHODS` / helpers from the public barrel (D5).
- ADR-0017 living-index / amendment bookkeeping (not a deferral issue).

### Scope correction — where the issue is stale

| Issue claim | Verified on `15e07d0` |
| ----------- | --------------------- |
| `patch` → `this.update` at `:2548` | Now **2708 / 2715 / 2721** (three `return this.update(...)` sites in `patch`) — P8 |
| `new FirestoreRepository` at `:4093`, `:991`, `:809` | **`:4253`** (`txRepo`), **`:989` / `:1041`** (`withSchema`), **`:1146`** (`subcollection`) — P6 / P7 |
| Audit path `docs/audits/2026-08-23-website-docs-audit.md` | Present in git history (`0ef66cb`); not necessarily on `main` working tree — cite commit when linking |
| "19 write methods" list | Still exact vs AST public instance methods — P4 / P5 |

---

## §3 Verified facts

### 3.1 Override timing — `probes/01-override-timing.mjs`

| Id  | Expression / condition | Observed | Note |
| --- | ---------------------- | -------- | ---- |
| P1  | Method-style `async update()` on subclass proto | `['update']` on class **and** instance | Visible in base ctor |
| P2  | Class-field `update = async () => …` | `[]` on class proto; `['update']` on instance after ctor | Blind to constructor-time check |
| P3  | `this.update = …` in subclass ctor body | `[]` on class proto; `['update']` on instance after ctor | Same blind spot as P2 |
| P4  | Subclass adds `findActive()` only | `[]` | Additions must stay silent |
| P5  | 2-level chain (update on parent, delete on child) | `['delete','update']` | Walk must climb past immediate proto |
| P6  | Multi-override `update` + `bulkUpdate` | `['bulkUpdate','update']` | Sorted unique set |

### 3.2 Identity drop — `probes/02-identity-drop.mjs`

| Id  | Expression / condition | Observed | Note |
| --- | ---------------------- | -------- | ---- |
| P7  | `user.subcollection('u1','orders', schema).constructor.name` | `FirestoreRepository`; `instanceof UserRepository` → `false`; override identity → `false` | Schema arg required on current API |
| P8  | `FirestoreRepository.withSchema(...).constructor === FirestoreRepository` | `true` | |
| P9  | Source regex `const txRepo = new FirestoreRepository<…>(...txArgs)` | match at `:4253` | |
| P10 | Hard-coded `return new FirestoreRepository` + `txRepo` alloc sites | **4** | withSchema×2, subcollection, tx |

### 3.3 Public member partition — `probes/03-keyof-partition.mjs`

| Id  | Expression / condition | Observed | Note |
| --- | ---------------------- | -------- | ---- |
| P11 | `keyof FirestoreRepository<{name:string}>` cardinality | **49** | 45 methods + 4 getters |
| P12 | Write list ∩ class public methods | **19 / 19** | Issue list complete |
| P13 | `Missing` / `ExtraWrite` / `ExtraNonWrite` vs Write∪NonWrite | all empty / `never` | Drift guard is viable |
| P14 | Non-write public members | **30** | 26 methods + `schemas`/`readSchema`/`createSchema`/`updateSchema` |

Authoritative **write** list (must match `REPOSITORY_WRITE_METHODS` and the type-test `Write` union):

```
bulkCreate bulkCreateWithIds bulkDelete bulkPatch bulkUpdate bulkWrite
create createInTransaction createWithId createWithIdInTransaction
delete deleteInTransaction patch patchInTransaction
recursiveDelete recursiveDeleteCollection update updateInTransaction upsert
```

Authoritative **non-write** list (type-test `NonWrite` union — P14):

```
collectionGroup createSchema findByField fromSnapshot getAll getById getByIdOrThrow
getByIdWithUpdateTime getCollectionPath getInTransaction getMany getManyInTransaction
getOneByField getOneByFieldOrThrow getParentId id isSubcollection listenOne
listenOneDetailed newId on query readSchema runInTransaction runReadOnlyAt
safeValidate schemas subcollection updateSchema validate
```

### 3.4 Library baseline — `probes/04-src-baseline.mjs`

| Id  | Expression / condition | Observed | Note |
| --- | ---------------------- | -------- | ---- |
| P15 | `process.env` in `src/**/*.ts` excl. tests/benchmarks | **0 hits** | D1 evidence |
| P16 | `console.warn(` in same (non-comment) | **0 hits** | First warn infrastructure |

### 3.5 Self-delegation / site enumeration (`main` @ `15e07d0`)

| Id  | File | Lines | Fact |
| --- | ---- | ----- | ---- |
| P17 | `FirestoreRepository.ts` | 2708, 2715, 2721 | `patch` → `this.update` (only internal write self-delegation) |
| P18 | `FirestoreRepository.ts` | 2580 | `update` → `this.runUpdate(...)` (private — overrides of `update` do not see `upsert`'s update branch at 3000) |
| P19 | `FirestoreRepository.ts` | 478–532 | Constructor body ends after schema asserts — **insertion point** for the warn call |
| P20 | `patterns.md` | 110–131, 558–576 | Docs already say overrides do not enforce; warn must agree, not contradict |

**Authoritative edit sites:**

| File | Lines / action |
| ---- | -------------- |
| `src/core/writeOverrideWarning.ts` | **create** (see `prototype.patch`) |
| `src/core/FirestoreRepository.ts` | import (~L35); static prop before constructor (~L477); call at end of constructor (~L532) |
| `src/tests/unit/writeOverrideWarning.unit.test.ts` | **create** |
| `src/tests/types/write-override-warning.type-test.ts` | **create** |
| `website/src/content/docs/guides/advanced/patterns.md` | Custom-methods constraints + brief opt-out note under §2 "why not subclass" |
| `docs/adr/NNNN-write-override-warning.md` | **create** (next free NNNN) |
| `docs/adr/README.md` | index row |

**Deliberately NOT changed** (justify in notes if you touch them):

- `src/core/FirestoreRepository.ts:989,1041,1146,4253` — identity drop sites stay as-is; fixing them is #80 / ADR-0040 (**P7–P10** prove the footgun; this issue only warns).
- `src/vector/**` — no `extends FirestoreRepository` (**grep verified**).
- `src/index.ts` / `packageExports` — no new named export (D5).
- `README.md` / `npm-readme.md` — grepped; no subclass/override/denorm pitch to update.
- Living-index footers / ADR-0017 — not a deferral issue.
- Existing `withSchemaArgs` subclass tests — they add no write overrides (**P4**); they must remain warning-silent (trap T6).

### 3.6 Gate headroom (measured from on-disk LCOV @ planning time)

Integration gate owns `FirestoreRepository.ts` (thresholds lines 90 / branches 75 / functions 85):

| Metric | Actual | Threshold | Slack |
| ------ | ------ | --------- | ----- |
| lines | 98.29% (4646/4727) | 90 | **+8.29** |
| branches | 92.48% (492/532) | 75 | **+17.48** |
| functions | 93.62% (88/94) | 85 | **+8.62** |

The new constructor call is on the hot path (every construction) — line coverage of that statement is automatic. Branch coverage of the helper lives in `writeOverrideWarning.ts`, which is **not** in any path-specific gate today (§5). Unit tests still required.

### 3.7 Prototype gate results

| Step | Result |
| ---- | ------ |
| Apply `prototype.patch` | builds `writeOverrideWarning.ts` + FR wiring |
| `npm run test:types` | clean |
| `npm run build` + smoke | WARN_COUNT=2 (UpdateOverride, TwoLevelB); base/adds-only/suppressed/2nd instance silent |
| Full §10 | **not run** on prototype |

---

## §4 Traps

Ordered by how badly a reasonable implementer gets them wrong.

### T1 — Checking `already-warned` before detecting leaves empty subclasses unmarked, or worse, marking before detect suppresses a later… (P4)

Use: short-circuit base → suppress flag → **already-warned** → detect → if empty **return without** adding to the set → else add + warn. Marking adds-only classes is optional; do **not** mark before you know there is something to warn about if you ever change the short-circuit order. The prototype uses: check `warnedConstructors.has` **before** detect (perf), then only `add` when `overridden.length > 0`. That is correct because a class cannot grow prototype methods between instances.

### T2 — Field-style / ctor-body overrides silently evade the check (P2, P3)

Constructor-time visibility is structural. Do **not** claim complete coverage in docs/JSDoc. State the limitation (prototype/method shape only) and point at ADR-0040 for the future choke point. Test U-field documents today's non-detection (characterization), not a fix.

### T3 — Per-instance `Set` / WeakSet keyed wrong (issue + DI)

Key by **constructor function**, not instance. `runInTransaction` and DI create many instances; per-instance warning would flood stderr. Use `WeakSet<Function>` (or `WeakSet<object>` on the ctor).

### T4 — Drift guard that is a bare `type Missing = …` alias (ADR-0041 lesson)

A bare alias emits **no** diagnostic when `Missing` is a real key. Terminate in `AssertTrue<ExpectEqual<Missing, never>>` **and** the Extra side (`Exclude<Write, keyof Repo>`, `Exclude<NonWrite, keyof Repo>`). Guard: T-1 in §8.

### T5 — Warning message lists `patch` as a bypass of `update` (P17)

`patch` delegates to `this.update`, so an `update` override **is** reached by `patch()`. The bypass list for `update` must **omit** `patch()`. The prototype's `BYPASS_PATHS.update` is correct — do not "simplify" by listing all sibling writes.

### T6 — Existing subclass tests start failing / spamming (P4)

`OverlayRepo` / `CounterRepository` / type-test subclasses do not override writes. After the change they must emit **zero** warns. If a test spies `console.warn` globally, isolate. Prefer unique class names per unit test because the `WeakSet` is process-lifetime (T7).

### T7 — Reusing the same class name across unit tests under one Jest worker

`warnedConstructors` is module-global. Second `it` that constructs the same class name (same function identity if declared once in `describe` scope is fine for "once" tests; **redeclaring** `class Foo` in two tests creates two ctors). Using one class at describe scope is the right pattern for once-per-class tests. Do not export a test-only reset unless a test absolutely needs it — unique classes are enough.

### T8 — Exporting the helper from `src/index.ts` "for completeness" (D5)

Triggers docs-api-sync + `packageExports` without consumer need. Keep the import path relative in unit tests: `../../core/writeOverrideWarning.js`.

### T9 — Gating on `NODE_ENV` while implementing (D1)

Do not add `process.env` checks. Opt-out is the static flag only.

### T10 — "Fixing" identity drop while here

Tempting, out of scope. Leaves ADR-0040's design space; do not change `:989` / `:1041` / `:1146` / `:4253`.

---

## §5 Could not verify / scope bounds

- **Full 14-leg gate on the prototype** — only `test:types` + build + smoke. Implementer owns §10.
- **Emulator re-probe of the 2/9 · 1/8 · 1/7 override reachability matrix** — accepted from the audit (`0ef66cb` H1) and ADR-0040; not re-run on this baseline. Identity drop (**P7–P10**) and `patch`→`update` (**P17**) were re-verified.
- **`writeOverrideWarning.ts` path-specific coverage gate** — file is not in `check-coverage-gates.mjs`. Unit tests are still mandatory; do **not** expand the gate in this PR unless coverage of the helper becomes a review finding (keep scope minimal).
- **Serverless cold-start noise** — once per class per process is the designed bound; not measured in Lambda/Cloud Functions.
- **Anonymous class `name === ''`** — formatter falls back to `(anonymous subclass)`; smoke not run for that shape (low value).

---

## §6 API specification

### 6.1 Apply `prototype.patch` (bodies)

```bash
git apply docs/plans/issue-103-write-override-warning/prototype.patch
```

The patch is the compile-checked implementation of:

1. **`src/core/writeOverrideWarning.ts`** — `REPOSITORY_WRITE_METHODS`, `collectOverriddenWriteMethods`, `formatWriteOverrideWarning`, `warnIfWriteMethodsOverridden`, module `WeakSet`.
2. **`FirestoreRepository`** — `import { warnIfWriteMethodsOverridden }…`; `static suppressWriteOverrideWarning = false` + JSDoc; end-of-constructor call.

**Invariants the patch must preserve (do not refactor away):**

- Short-circuit `Ctor === baseConstructor` before any proto walk.
- Honor `Ctor.suppressWriteOverrideWarning === true` before warn.
- Once-per-constructor via `WeakSet`.
- Detect only own-properties on prototypes between subclass and `FirestoreRepository.prototype`.
- `BYPASS_PATHS.update` omits `patch()` (T5).
- Message prefix `[flintfire]` and mentions `static suppressWriteOverrideWarning = true`.
- Redirect text names the facade / "Enforced denormalization" — not interceptors (D4).

### 6.2 Static opt-out (contract already in patch)

```ts
static suppressWriteOverrideWarning = false;
```

Must remain a **static** on `FirestoreRepository` (subclasses override by redeclaring). Instance fields must not be used for opt-out.

### 6.3 Type-test partition (not in patch — implementer writes)

```ts
// src/tests/types/write-override-warning.type-test.ts
import { FirestoreRepository } from '../../index.js';

type User = { name: string };
type Repo = FirestoreRepository<User>;
type Keys = keyof Repo;

type ExpectEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertTrue<T extends true> = T;

type Write =
  | 'bulkCreate'
  | 'bulkCreateWithIds'
  | 'bulkDelete'
  | 'bulkPatch'
  | 'bulkUpdate'
  | 'bulkWrite'
  | 'create'
  | 'createInTransaction'
  | 'createWithId'
  | 'createWithIdInTransaction'
  | 'delete'
  | 'deleteInTransaction'
  | 'patch'
  | 'patchInTransaction'
  | 'recursiveDelete'
  | 'recursiveDeleteCollection'
  | 'update'
  | 'updateInTransaction'
  | 'upsert';

type NonWrite =
  | 'collectionGroup'
  | 'createSchema'
  | 'findByField'
  | 'fromSnapshot'
  | 'getAll'
  | 'getById'
  | 'getByIdOrThrow'
  | 'getByIdWithUpdateTime'
  | 'getCollectionPath'
  | 'getInTransaction'
  | 'getMany'
  | 'getManyInTransaction'
  | 'getOneByField'
  | 'getOneByFieldOrThrow'
  | 'getParentId'
  | 'id'
  | 'isSubcollection'
  | 'listenOne'
  | 'listenOneDetailed'
  | 'newId'
  | 'on'
  | 'query'
  | 'readSchema'
  | 'runInTransaction'
  | 'runReadOnlyAt'
  | 'safeValidate'
  | 'schemas'
  | 'subcollection'
  | 'updateSchema'
  | 'validate';

type Missing = Exclude<Keys, Write | NonWrite>;
type ExtraWrite = Exclude<Write, Keys>;
type ExtraNonWrite = Exclude<NonWrite, Keys>;
type _m = AssertTrue<ExpectEqual<Missing, never>>;
type _ew = AssertTrue<ExpectEqual<ExtraWrite, never>>;
type _en = AssertTrue<ExpectEqual<ExtraNonWrite, never>>;
```

**Compile-checked:** this exact block was verified via `probes/03-keyof-partition.mjs` (Missing/Extra empty) and mirrors the ADR-0041 asserted-guard pattern. After adding the file under `src/tests/types/`, `npm run test:types` must stay clean. A deliberate omission of e.g. `'upsert'` from `Write` without adding it to `NonWrite` must make `Missing` non-`never` and fail `test:types` — **mutation-check this** (§8).

### 6.4 Size

~3 source files touched/created (helper + FR + tests/docs/ADR), roughly **+220 / −0** in library source from the patch, plus ~150–250 lines tests, ~80–120 docs/ADR. **No runtime behavior change** for non-overriding subclasses or base instances beyond a cheap identity check.

---

## §7 Implementation sequence and anti-instructions

1. Check out `feat/issue-103-write-override-warning` — it already carries this plan. If `main` has moved past `15e07d0`, rebase onto it and **re-verify the §3 line numbers before editing**.
2. `git apply docs/plans/issue-103-write-override-warning/prototype.patch` — why first: gives a types-clean baseline so tests can be written against real symbols.
3. Add `src/tests/types/write-override-warning.type-test.ts` (§6.3). Run `npm run test:types`. Mutation-check T-1 (remove one Write member → must fail).
4. Add `src/tests/unit/writeOverrideWarning.unit.test.ts` (§8.1). Confirm each new test **fails** on unfixed baseline (`git stash` the patch / helper) for the load-bearing cases, then restore.
5. Docs §9.4 + ADR §9.2–9.3.
6. Full gate §10, `prettier --write` on touched non-exempt files, commit `notes.md`. Leave the plan directory in place for review.

### Anti-instructions

- **Do not** gate on `NODE_ENV` or any `process.env` (D1, T9).
- **Do not** export `REPOSITORY_WRITE_METHODS` / warn helpers from `src/index.ts` (D5, T8).
- **Do not** change `new FirestoreRepository` at the identity-drop sites (T10).
- **Do not** list `patch()` as a bypass of `update` (T5).
- **Do not** claim field-style overrides are detected (T2).
- **Do not** throw / seal / convert methods to arrows.
- **Do not** update ADR-0017 living-index footers.
- **Do not** hand-edit `CHANGELOG.md`.
- **Do not** commit unless asked; leave the tree clean and report the subject line (§10).

---

## §8 Test specification

### 8.1 Unit — `src/tests/unit/writeOverrideWarning.unit.test.ts`

Gate: **unit** owns pure helper logic (file itself unguarded — §5); constructor call is exercised whenever unit tests construct repos. Import helper from `../../core/writeOverrideWarning.js`. Use `createMockFirestoreDb()` from `src/tests/shared/mocks/firestore.mocks.ts`. Spy `console.warn`. Unique class per describe where needed (T7).

| Id | Asserts | Observable when it fails | Guards |
| -- | ------- | ------------------------ | ------ |
| U-1 | Base `new FirestoreRepository` → no warn | `console.warn` call count > 0 | T3 short-circuit |
| U-2 | Subclass adds method only → no warn | warn fires | T6 / P4 |
| U-3 | Subclass overrides `update` → one warn; message includes `update` and bypass list without `patch()` | 0 warns, or message contains `patch()` as bypass of update | T5 |
| U-4 | Second instance of same overriding class → still one warn total | call count === 2 | T3 |
| U-5 | `static suppressWriteOverrideWarning = true` + override → no warn | warn fires | D2 |
| U-6 | Overrides `update` + `bulkUpdate` → message names both | only one named | P6 |
| U-7 | 2-level chain → names `delete` and `update` | missing one | P5 |
| U-8 | `REPOSITORY_WRITE_METHODS` sorted copy equals the 19-name issue list | length/name drift | durability |
| U-9 | Characterization: class-field override → **no** warn (document limitation) | warn fires (would mean accidental instance walk) | T2 |

JSDoc header on the file: strategy + verification points (test-guardrails).

### 8.2 Type — `src/tests/types/write-override-warning.type-test.ts`

| Id | Asserts | Observable when it fails | Guards |
| -- | ------- | ------------------------ | ------ |
| T-1 | `Missing` / `ExtraWrite` / `ExtraNonWrite` are `never` via `AssertTrue<ExpectEqual<…>>` | `test:types` error on the assert line | T4 |
| T-2 | Mutation: drop `'upsert'` from `Write` without adding to `NonWrite` → `test:types` fails | still green | T4 durability |

### 8.3 Integration

No new integration file required: identity drop and override reachability are already documented; this change is a constructor side-effect covered by unit tests. Do **not** add an overriding subclass to the emulator suite just to see a warn (noise). If review insists on one FR-line hit beyond the always-on call, a single suppressed override subclass in an existing harness file is enough — prefer not to.

### 8.4 Trap coverage — inverse direction

| Trap | Site | Falsifying test | What it observes |
| ---- | ---- | --------------- | ---------------- |
| T1 | `warnIfWriteMethodsOverridden` order | U-2 + U-4 | adds-only silent; second instance silent |
| T2 | constructor vs field override | U-9 | field override does **not** warn |
| T3 | ctor keying | U-4 | call count stays 1 |
| T4 | type partition | T-1 / T-2 mutation | `test:types` fails on incomplete Write |
| T5 | `BYPASS_PATHS.update` | U-3 | message must not list `patch()` under update bypasses |
| T6 | existing subclasses | U-2; existing withSchemaArgs unit still green | no warn / no new failures |
| T7 | WeakSet lifetime | U-4 pattern (one class, two instances) | — |
| T8 | barrel | `packageExports` unchanged; grep `src/index.ts` for `writeOverride` empty | — |
| T9 | env gate | grep `process.env` in new files empty | — |
| T10 | identity sites | post-change `probes/02` still OK | sites untouched |

### 8.5 Coverage gates

| Changed path | Gate |
| ------------ | ---- |
| `src/core/FirestoreRepository.ts` | `test:coverage:gate:integration` |
| `src/core/writeOverrideWarning.ts` | none path-specific — unit tests still required |
| `src/tests/types/*` | `test:types` (no coverage) |

Headroom: §3.6.

---

## §9 Docs and ADR bookkeeping

### 9.1 Bookkeeping — what does **not** apply

- **Not** an ADR-0017 `#35–#41` deferral → **no** amendment blockquote in 0017, **no** living-index footer updates.
- **Not** a bugfix of a shipped contract → still deserves an ADR because it adds permanent library stderr behavior + a public static flag.

### 9.2 New ADR — claim next free number in `docs/adr/` (0043 on this baseline)

From `docs/adr/0000-template.md`. Status `Accepted`, Date = merge day, Deciders `maintainer`. Must contain:

1. **Context** — H1 override footgun; 2/9·1/8·1/7; identity drop; silent data divergence; TS2416 already rejects narrowing overrides.
2. **Decision** — once-per-class `console.warn`; constructor-time; static opt-out; no `NODE_ENV` gate; drift guard; defer field-style to ADR-0040 choke point; message points at facade until interceptors ship.
3. **Consequences** — first `console.warn` in `src/`; subclasses that override writes see stderr once; deliberate overrides set the static flag; warning remains useful after ADR-0040 (string edit only).
4. **Alternatives considered** — env gate; seal/throw; lazy-on-write now; per-instance warn; public export of write list.
5. **References** — #103, audit H1 @ `0ef66cb`, ADR-0040, ADR-0042, patterns.md enforced denormalization.

Add the row to `docs/adr/README.md`.

### 9.3 ADR bookkeeping edits

| File | Edit |
| ---- | ---- |
| `docs/adr/README.md` | Append new ADR row |
| ADR-0040 | Optional one-line Related backlink — **only if** you touch 0040; not required |

### 9.4 Website — 1 page

| Page | Approx. locus | Change |
| ---- | ------------- | ------ |
| `website/src/content/docs/guides/advanced/patterns.md` | Custom repository methods constraints (~L129–131) and/or §2 "Why not subclass" (~L558) | Note that overriding a listed write method emits a once-per-class warning; show `static suppressWriteOverrideWarning = true` for deliberate partial overrides; restate field-style limitation in one sentence |

`website/**/*.md` is prettier-exempt — match style by hand. If you add a `:::note` / `:::caution`, run `npm run docs:build` and grep the built HTML for a leaked literal `:::`.

No new sidebar entry (existing page).

### 9.5 READMEs

Grepped both `README.md` and `npm-readme.md` — neither mentions subclass overrides / denormalization. **Unaffected.** Say so in the PR body.

### 9.6 Follow-up (optional, do not block)

Title: `chore: extend write-override warning to field-style overrides via ADR-0040 choke point`. Body: cite P2/P3; depends on #80. Labels: `enhancement`. Only open if the owner wants it tracked separately — ADR text can carry the deferral alone.

---

## §10 Gate and commit

```bash
npm run test:types && npm run lint && npm run check:format && npm run test:unit && npm run test:integration:emulator && npm run test:unit:coverage && npm run test:coverage:gate:unit && npm run test:integration:coverage && npm run test:coverage:gate:integration && npm run build && npm run check:package && npm run check:consumer && npm run check:docs && npm run docs:build
```

Fourteen legs. Report failures with output — never claim a leg passed that you did not execute.

Baseline before your change (measured on `15e07d0`, clean tree):

- unit **35 suites / 456 tests** — must go **up** (new unit file)
- integration **37 suites / 548 tests** — must **stay** (no new integration file)

Watch **integration** coverage gate for `FirestoreRepository` (§3.6 slack is comfortable).

Re-run probes against the finished code:

```bash
npm run build
node docs/plans/issue-103-write-override-warning/probes/01-override-timing.mjs
node docs/plans/issue-103-write-override-warning/probes/02-identity-drop.mjs
node docs/plans/issue-103-write-override-warning/probes/03-keyof-partition.mjs
# probe 04 will FAIL after the change (console.warn now exists) — that is expected; do not treat as regression
```

**Commit subject** (Conventional Commits; commitlint runs on `commit-msg`):

```
feat(repository): warn once when a subclass overrides an unenforceable write method (#103)
```

**Is it breaking?** **No.** Additive warning + optional static flag; no signature or return-contract changes. Folds into unreleased `3.0.0` as a non-breaking `feat`.

---

## §11 Definition of done

| #  | Item |
| -- | ---- |
| 1  | D1–D5 honored (no env gate; static opt-out; constructor-only; facade redirect; no barrel export) |
| 2  | `prototype.patch` applied (or equivalent) with invariants from §6.1 |
| 3  | Type-test drift guard green; T-2 mutation confirmed |
| 4  | Unit tests U-1…U-9 present; load-bearing ones fail on unfixed baseline |
| 5  | Docs §9.4 + ADR + README index; READMEs declared unaffected |
| 6  | Nothing in the §7 anti-instruction list violated |
| 7  | Full gate green (§10) with real output; suite counts as predicted |
| 8  | `notes.md` committed: deviations, unverified items, adversarial self-review |
| 9  | Assertion probes promoted to committed tests (§8), not left only in `probes/` |
| 10 | `git rm -r docs/plans/issue-103-write-override-warning/` — plan directory removed in this PR **after** review |

---

## §12 Pre-handoff verification

| Check | Command / method | Result |
| ----- | ---------------- | ------ |
| §6 blocks compile as written | Applied prototype under `src/` + `npm run test:types` | **clean**; then reverted; patch saved |
| Every `from '…'` specifier §6 uses | `./writeOverrideWarning.js` from FR; type-test from `../../index.js` | resolved |
| Declaration emit | No new public type exported from barrel | N/A — static flag is on existing class; helper not public |
| Every §9 / §10 shell command | Probes 01–04 run; unit+integration counts measured; LCOV parsed | see below |
| Baseline suite counts | `npm run test:unit` / `test:integration:emulator` | **35/456** unit, **37/548** integration |
| Gate headroom | LCOV vs thresholds | §3.6 |
| Unresolved conditionals | re-read §§2–9 | none — D1/D2 settled by owner; integration test optional resolved to "prefer not" |
| Trap coverage inverse walk | §4 ↔ §8.4 | every trap × site has a falsifying observable |

Probe command results (expected):

| Probe | Expected |
| ----- | -------- |
| 01 | prints matrix + `OK` |
| 02 | identity drop assertions + `OK` |
| 03 | keyof=49, missing=[], write on class=19, `OK` |
| 04 | env=0, warn=0, `OK` on **unfixed** baseline only |

Runtime smoke on prototype (expected): `WARN_COUNT 2`; messages for `UpdateOverride` and `TwoLevelB`.

---

## Appendix — probe inventory (`probes/`, beside this file)

| File | What it proves |
| ---- | -------------- |
| `01-override-timing.mjs` | P1–P6 timing / chain / additions |
| `02-identity-drop.mjs` | P7–P10 factory + tx identity drop |
| `03-keyof-partition.mjs` | P11–P14 drift-guard viability |
| `04-src-baseline.mjs` | P15–P16 no env / no warn in src today |
| `prototype.patch` | Compile-checked implementation bodies for §6 |
