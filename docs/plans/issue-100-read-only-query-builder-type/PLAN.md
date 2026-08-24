# PLAN — issue #100: export a `ReadOnlyQuery` builder type

> **Read this first.** This is a **handoff contract**, not a to-do list: it is written for an
> implementer who has none of the investigation that produced it. The plan is exhaustive; the change
> it prescribes is **minimal and type-only**. If you find a second defect while implementing, defer
> it, pin today's behavior with a test, and open a follow-up issue — do not fold it in.

| | |
| --- | --- |
| **Implementer** | Cursor Cloud Agent, fresh clone (Node 24 per `.nvmrc`; JDK present for the emulator) |
| **Reviewer** | Reggie O'Farrell (or the `implementation-review` skill → `review.md`) |
| **Baseline** | `main` @ `b999f40` — *docs: use zod 4 top-level formats in npm README and add an idiom gate (#106)*. Every §3 fact was verified on `05c02cf`, the pre-merge tip of the branch that landed as `b999f40`; `git diff --stat 05c02cf..b999f40 -- src/ website/ docs/adr/ scripts/ package.json` is **empty**, so every line number and every fact below holds verbatim against this baseline. |
| **Branch** | `feat/issue-100-read-only-query`, cut from `main`, **already pushed with this plan on it** |
| **Issue** | <https://github.com/reggieofarrell/flintfire/issues/100> · label: `enhancement` (**not** `parity`/`v3.x`) |
| **Acceptance criteria** | The issue states none as a checklist. Its "Proposed work" is treated as the spec and is corrected in §2. |
| **ADR** | `docs/adr/0041-read-only-query-builder-type.md` already exists, status **Proposed**. It is edited in place (§9.1) — not amended — because ADR-README's immutability rule binds only `Accepted` records. |

---

## §0 — How to use this plan

1. **Read order:** §1 (settled) → §2 (scope, incl. where the issue and ADR are wrong) → §4 (traps) →
   §6 (the code) → §7 (sequence) → §8 (tests) → §9 (docs) → §10 (gate) → §11 (done).
2. **Step 1 of §7 is `git checkout feat/issue-100-read-only-query` and rebase onto `main`.** Do not
   cut a new branch. Re-run the §3.6 enumeration after rebasing and fix any drifted line numbers
   before editing.
3. **Copy-verbatim:** the whole of §6 and §8.1. They were compiled as written and are
   prettier-clean (§12). Do not reformat them by hand; `npm run format` is a no-op on them.
4. **Re-run the probes** — all five, from the repo root (cwd matters; the harness mounts a virtual
   `src/` file relative to it). Nothing to install: the harness resolves the repo's own `typescript`.

   ```bash
   P=docs/plans/issue-100-read-only-query-builder-type/probes
   for p in 01-member-sets 02-parameters-collapse 03-readonly-query; do node $P/harness.cjs $P/$p.ts; done
   node $P/04-mutations.cjs        # self-checking: exits non-zero if a guard stops firing
   node $P/05-declaration-emit.cjs # self-checking: exits non-zero on an undeclared package
   ```

   Expected: `01`/`02`/`03` print `DIAGNOSTICS (0)`; `04` prints `ALL 5 EXPECTATIONS HOLD`; `05`
   prints five `PASS` lines. For `03`, **0 diagnostics is the whole result** — it contains
   `@ts-expect-error` directives, so a clean run means each one was genuinely needed.
   `docs/plans/**` is outside `tsconfig` `include`, inside `eslint.config.js` `ignores`, and inside
   `.prettierignore`, so probes can never break a gate.
5. **Leave notes in `notes.md`** in the plan directory, committed on this branch: every deviation,
   every unverified item, and the disposition of your own refute-first self-review. Do **not** write
   `review.md` — that slot belongs to an external reviewer.

---

## §1 — Owner-approved decisions (settled; do not re-litigate)

| id | Fork | Decision | Rejected alternative, and why |
| --- | --- | --- | --- |
| **D1** | `interface` or `type` alias? | **`interface ReadOnlyQuery … extends Omit<…>`.** | A recursive `type` alias compiles and behaves *identically* (V1–V6 hold for both) but every hover and every error message prints a ~3 000-character intersection instead of `ReadOnlyQuery<Order, …>` (V7). For a type whose whole job is producing a legible compile error, that is disqualifying. |
| **D2** | Type-parameter list | **`ReadOnlyQuery<T, W = T, S = T, R = FirestoreDocument<T>>`** — positionally identical to `FirestoreQueryBuilder<T, W, S, R>`. `W` is a documented phantom (V4). | Dropping `W` (`<T, S, R>`) removes the phantom but makes `ReadOnlyQuery<Order, Order, Order>` — the exact three-argument form the ADR, the docs and the existing type test all use — silently bind `S = Order`, `R = Order`. `.get()` then returns `Order[]` with no `id`, and it compiles. That is the same class of silent failure this issue exists to close. |
| **D3** | How the read terminals are carried | **Inherited verbatim through `Omit`.** Only the 13 clause members are re-declared, and only their return type. | Restating terminals as `(...a: Parameters<QB[k]>): ReturnType<QB[k]>` — which is how ADR-0041 decision 3 reads if applied uniformly — **breaks three of them** (N1–N3). See §2 scope correction. |
| **D4** | Docs blast radius | **Facade exposes it, plus a guides sweep.** `patterns.md`'s facade gains `query(): ReadOnlyQuery<Order>`, its caveat aside is deleted, and `queries.md` + `security-boundary.md` gain cross-links. | "Document the type only" would leave audit finding H1's caveat on the shelf, which ADR-0041 Consequences explicitly says should be **deleted** rather than maintained. |
| **D5** | Export the existing `FirestoreQueryBuilderBase` as well? | **No.** Out of scope. | ADR-0041 Alternatives already rules it lossy (five read members live on the concrete class) and says "additionally as a documented minimal read surface remains possible later". Later is not now. |
| **D6** | Ship a `ReadOnlyQueryOf<Repo>` convenience helper? | **No.** `ReadOnlyQuery<DataOf<typeof repo>>` was verified to work with no cast (V3), so the helper is sugar, not a fix. | Adding a second public name in the same PR widens the forward compatibility commitment for no verified need. Note it as a follow-up if consumers ask. |
| **D7** | Runtime `Proxy` enforcement | **No** — ADR-0041 decision 5, unchanged. | A cast defeats it anyway; the guarantee is compile-time. |

---

## §2 — Scope

**In scope**

- One new exported type-only symbol, `ReadOnlyQuery`, in `src/core/QueryBuilder.ts`, plus its local
  helper `ReadOnlyQueryClauseKeys`.
- Root re-export (`src/index.ts`) and `/vector` subpath re-export (`src/vector/index.ts`).
- A new type test, `src/tests/types/read-only-query.type-test.ts`, with **asserted** two-sided drift
  guards and per-site leak guards.
- One added assertion in `src/tests/unit/packageExports.unit.test.ts` (type-only export is not a
  runtime value).
- Updates to the existing `src/tests/types/enforced-denormalization-facade.type-test.ts`.
- Docs: ADR-0041 in place + ADR index status, `reference/types.md`, `reference/query-builder.md`,
  `guides/advanced/patterns.md`, `guides/working-with-data/queries.md`,
  `guides/designing/security-boundary.md`.

**Explicitly out of scope**

- Any change to `FirestoreQueryBuilder`, `FirestoreQueryBuilderBase`, `CollectionGroup.ts`,
  `VectorQueryBuilder`, or any runtime code anywhere. **This PR adds zero executable statements.**
- Exporting `FirestoreQueryBuilderBase` (D5); a `ReadOnlyQueryOf<R>` helper (D6); a runtime
  `Proxy` (D7).
- ADR-0017 amendment, living-index footer edits, and the `scope-and-capabilities.md` "Deferred to
  v3.x" table — see §9.4, all three are **deliberately not touched**.
- The `docs/2.0/` frozen archive.

### §2.1 — Where the issue body and ADR-0041 are stale or wrong

| Source | Claim | Correction |
| --- | --- | --- |
| Issue "Proposed work" ①, ADR-0041 decision 3 | "Derive parameters from the real builder so only return types are overridden and parameter drift is impossible: `where(...a: Parameters<QB['where']>)`." | **True for the 13 clause members, false as a general rule.** `Parameters<>` resolves an overloaded member to its **last** signature and erases type parameters. Applied to `whereId` it deletes the comparison overload (N1); applied to `get`/`getOne`/`stream`/`paginate`/`offsetPaginate`/`paginateWithCount` it deletes the `{ withMetadata: true }` overload (N2); applied to `aggregate`/`distinctValues` it erases the generic and returns `AggregationResult<AggregationSpec<S>>` / `Promise<unknown[]>`-shaped results (N3). The fix is D3: terminals are inherited through `Omit`, and `whereId` is hand-written as two overloads. |
| Issue "Proposed work" ②, ADR-0041 decision 4 | "`type Missing = Exclude<keyof QB, keyof ReadOnlyQuery<…> \| 'update' \| 'delete'>; // must be never` … Confirmed to fire on a deliberately incomplete `ReadOnlyQuery`." | **A bare alias does not fire.** Mutation M1 removed `orderById` from the interface: `Missing` resolved to `"orderById"` and `tsc` emitted **zero** diagnostics. It only fires when *asserted* — `AssertTrue<ExpectEqual<Missing, never>>` → TS2344 (M1′). The guard must be written asserted, and it must be **two-sided** (`Extra` as well), or a stray/misspelled member goes unnoticed. |
| Issue "Also consider…", ADR-0041 "Scope left open" | "Whether the collection-group builder wants the same treatment — it may need nothing." | **Resolved: it needs nothing.** `keyof FirestoreCollectionGroupQueryBuilder<O, O>` is 31 members and contains neither `update` nor `delete` (P2). Same for `VectorQueryBuilder` (P3). Recorded in §3.7 and in the ADR (§9.1). |
| `src/tests/types/enforced-denormalization-facade.type-test.ts:21,130` | "If ADR-0041 lands a self-returning read-only type, the second assertion here starts failing — which is the signal to update the guide." | **It will not start failing.** `omitNarrowingLeakIsReal` asserts that `Omit<FirestoreQueryBuilder, 'update'\|'delete'>` still leaks — and it still does; nothing about `Omit` changes. The comment mis-states its own trigger. §9.5 fixes the comment and adds the guard that *does* belong there. |

---

## §3 — Verified facts

All facts below were produced by executing code, not by reading. Method: a virtual-file
`ts.createProgram` over the repo's own `tsconfig.typecheck.json` options and real module resolution
(`probes/harness.cjs`), which resolves types with `checker.typeToString` rather than inferring from
error text. TypeScript **5.9.3** (`node_modules/typescript`).

### §3.1 — Member enumeration (`probes/01-member-sets.ts`)

**P1 — `keyof FirestoreQueryBuilder<O, O, O>` is exactly 33 members.** `keyof` yields public
members only, which is the right set for a structural read-only view.

`aggregate`, `average`, `collectionCount`, `count`, **`delete`**, `distinctValues`, `endAt`,
`endBefore`, `exists`, `explain`, `explainStream`, `get`, `getOne`, `getUnderlyingQuery`, `limit`,
`limitToLast`, `offset`, `offsetPaginate`, `onSnapshot`, `onSnapshotDetailed`, `orderBy`,
`orderById`, `paginate`, `paginateWithCount`, `select`, `startAfter`, `startAt`, `stream`, `sum`,
**`update`**, `where`, `whereFilter`, `whereId`.

`update` and `delete` are the only write members. Protected/private members (`toResult`,
`applyCompositeFilter`, `commitInChunks`, `sanitizeUpdateData`, …) are absent from `keyof` and
therefore irrelevant — confirmed by contrast with `checker.getPropertiesOfType`, which returns 60.

**P4 — the 33 split into 13 clause members and 20 non-clause members.**

| Group | Members | Return type | Declared at |
| --- | --- | --- | --- |
| Clause, base class, returns `this` | `where`, `orderBy`, `limit`, `startAt`, `startAfter`, `endAt`, `endBefore`, `offset`, `limitToLast` | `this` | `QueryBuilder.ts:656`, `:690`, `:723`, `:752`, `:765`, `:776`, `:787`, `:806`, `:829` |
| Clause, concrete class, returns `this` | `whereFilter`, `whereId`, `orderById` | `this` | `:1997`, `:2068`, `:2093` |
| Clause, concrete class, re-parameterizes | `select` | `FirestoreQueryBuilder<T, W, S, FirestoreDocument<DeepPartial<T>>>` | `:2024` |
| Terminal reads (18) | `count`, `paginate`, `offsetPaginate`, `getOne`, `exists`, `sum`, `average`, `aggregate`, `distinctValues`, `stream`, `onSnapshot`, `onSnapshotDetailed`, `paginateWithCount`, `getUnderlyingQuery`, `get`, `explain`, `explainStream`, `collectionCount` | various | `:858` … `:1797`, `:2112` |
| Writes (2) | `update`, `delete` | `Promise<number>` | `:2152`, `:2243` |

13 + 18 + 2 = 33 ✓. **No terminal returns `this`** — verified by reading each declaration — so
inheriting them through `Omit` cannot leak a builder.

**P2 — `keyof FirestoreCollectionGroupQueryBuilder<O, O>` is 31 members and contains neither
`update` nor `delete`.** It adds `groupCount`, `wherePath`, `orderByPath` and omits
`collectionCount`, `whereId`, `orderById`, `update`, `delete`.

**P3 — `keyof VectorQueryBuilder<O, O>` is 10 members:** `explain`, `findNearest`, `get`, `getOne`,
`onSnapshot`, `orderBy`, `select`, `stream`, `where`, `whereFilter`. No writes.

### §3.2 — Why the terminals must **not** be re-derived (`probes/02-parameters-collapse.ts`)

`QB = FirestoreQueryBuilder<O, O, O>` where `O = { a: string; n: number }`.

| id | Expression | Observed | Consequence |
| --- | --- | --- | --- |
| **N1** | `Parameters<QB['whereId']>` | `[op: "in" \| "not-in", value: readonly string[]]` | The comparison overload (`:2068`) is **gone**. A derived `whereId` would reject `whereId('==', id)`. |
| **N2a** | `Parameters<QB['get']>` | `[options?: { withMetadata?: false \| undefined } \| undefined]` | The `{ withMetadata: true }` overload is **gone**. |
| **N2b** | `ReturnType<QB['get']>` | `Promise<(Omit<O, "id"> & { readonly id: string })[]>` | So is `Promise<WithMetadata<R>[]>`. Same collapse applies to `getOne`, `stream`, `paginate`, `offsetPaginate`, `paginateWithCount`. |
| **N3a** | `Parameters<QB['aggregate']>` / `ReturnType<…>` | `[spec: AggregationSpec<O>]` / `Promise<AggregationResult<AggregationSpec<O>>>` | The `Spec` type parameter is **erased** — every alias would resolve to `number \| null` instead of the per-kind result. |
| **N3b** | `Parameters<QB['distinctValues']>` / `ReturnType<…>` | `[field: keyof O]` / `Promise<(string \| number)[]>` | `K` erased, so the result widens to the union of *all* the model's value types instead of the selected field's. `distinctValues('status')` would type as `(string \| number)[]` rather than `('pending' \| 'shipped')[]`. |
| **N4** | `Parameters<QB['startAt']>` | `unknown[]` | The last overload is the permissive rest, which also accepts the `DocumentSnapshot` form — so deriving `startAt`/`startAfter`/`endAt`/`endBefore` is **lossless**. Same for `where`, `orderBy`, `whereFilter`, `limit`, `limitToLast`, `offset`, `orderById`, `select` (all single-signature: verified, exact parameter tuples recorded in the probe output). |
| **N5** | `ReturnType<QB['select']>` | `FirestoreQueryBuilder<O, O, O, Omit<{a?: …; n?: …}, "id"> & { readonly id: string }>` | Not `this` — so `select` must be re-declared re-parameterized on `ReadOnlyQuery`, not inherited. |

**`Omit` is a homomorphic mapped type: it copies the property type verbatim**, so overloads and
generics survive it (V5 proves this end-to-end). That asymmetry — `Omit` preserves, `Parameters`
collapses — is the whole design.

### §3.3 — The prescribed shape, verified (`probes/03-readonly-query.ts`)

Probe `03` contains §6's block **verbatim** plus the assertions below. **0 diagnostics.**

| id | Assertion | Observed |
| --- | --- | --- |
| **V1** | `Exclude<keyof QB, keyof RO \| 'update' \| 'delete'>` | `never` |
| **V1′** | `Exclude<keyof RO, keyof QB>` | `never` |
| **V1″** | `keyof RO` | the 31 P1 members minus `update`/`delete` |
| **V2** | `FirestoreQueryBuilder<O, O, O> extends ReadOnlyQuery<O, O, O>` | `"YES"` — assignable, **no cast** |
| **V3** | Real schema repo: `function facade(): ReadOnlyQuery<Order> { return repo.query(); }` where `Order = DataOf<typeof repo>`, `repo = FirestoreRepository.withSchema(db, 'orders', z.object({…}))` | compiles clean; also clean with `z.output<typeof schema>` in place of `DataOf<…>` |
| **V4** | `declare const rawRepo: FirestoreRepository<Read, Write, Read>` (Write ≠ Read): `rawRepo.query()` returned from `(): ReadOnlyQuery<Read, Write, Read>` **and** from `(): ReadOnlyQuery<Read>` | both compile → `W` is a phantom; it constrains nothing (basis for D2) |
| **V5a** | `ro.get({ withMetadata: true })` | `Promise<WithMetadata<Omit<Order,"id"> & {readonly id: string}>[]>` — overload survived |
| **V5b** | `ro.aggregate({ n: {kind:'count'}, s: {kind:'sum', field:'score'} })` | `Promise<AggregationResult<{ n: { kind: "count" }; s: { kind: "sum"; field: "score" } }>>` — generic survived |
| **V5c** | `ro.distinctValues('status')` | `Promise<("pending" \| "shipped")[]>` — generic survived |
| **V5d** | `ro.whereId('==', 'x')` and `ro.whereId('in', ['a','b'])` | both `ReadOnlyQuery<…>` — both overloads present |
| **V5e** | `facade().where('status','==','p').select('status').orderBy('score').limit(2).get()` | `Promise<(Omit<{userId?: …; status?: …; …}, "id"> & {readonly id: string})[]>` — `DeepPartial` narrowing survived a 4-deep chain |
| **V6** | 6 `@ts-expect-error` sites: `.update()` / `.delete()` immediately, after `.where()`, after `.orderBy()`, after `.select().where()`, and after `.whereId().orderById().startAt().endBefore().limit()` | all 6 fire (0 diagnostics ⇒ every expectation was satisfied) |
| **V7** | `checker.typeToString` of the alias form vs the interface form | alias: a ~3 000-char `Omit<…> & { where(…): …; whereFilter(…): …; … }` dump at every mention. interface: `ReadOnlyQuery<Order, Order, Order, Omit<Order,"id"> & {readonly id: string}>`. Basis for D1. |
| **V8** | `tsc --declaration --emitDeclarationOnly` on the block | 0 diagnostics. Emitted `.d.ts` references only `./core/QueryBuilder.js`, `./core/DocumentId.js`, `./utils/pathTypes.js`. **No `@google-cloud/firestore`**, no undeclared package. `ReadOnlyQueryClauseKeys` is emitted as a local (non-exported) alias in the same `.d.ts` — legal and self-contained. |
| **V9** | `npx prettier --parser typescript --config .prettierrc --check` on §6 | "All matched files use Prettier code style!" |

### §3.4 — Mutation checks: the guards actually fire (`probes/04-mutations.ts`)

| id | Mutation | Result |
| --- | --- | --- |
| **M1** | `orderById` removed from the interface (still in `ReadOnlyQueryClauseKeys`), guard written as a **bare** `type Missing = Exclude<…>` | `Missing` resolves to `"orderById"` and **`tsc` emits 0 diagnostics**. The bare form is inert. |
| **M1′** | Same mutation, guard written as `AssertTrue<ExpectEqual<Missing, never>>` | **TS2344** `Type 'false' does not satisfy the constraint 'true'` |
| **M2** | `where()` re-declared returning `FirestoreQueryBuilder<T,W,S,R>` (the copy-paste slip) | **5 diagnostics**, and `Missing`/`Extra` **both stay `never`** — the key guards are structurally blind to this, which is exactly why §8.1 needs the per-site `NoWrites` matrix. What does fire: **TS2344** on `AssertTrue<NoWrites<ReturnType<RO['where']>>>`, plus **3× TS2578** "Unused '@ts-expect-error' directive" on the leak guards (the writes became reachable again), plus **TS2322** — see M2′. |
| **M2′** | (same mutation, incidental finding) | The W-phantom property is **conditional on no member exposing the concrete class.** With `where` leaking `FirestoreQueryBuilder`, `facadeDefaultedW` — `rawRepo.query()` returned as `ReadOnlyQuery<Read>` where the repo's `W` is `Write` — starts failing **TS2322** on `where(...).validateUpdate`: comparing two instantiations of the same class compares its *private* members, and `validateUpdate` is typed on `W`. So V4 holds only while every clause member returns `ReadOnlyQuery`. A useful extra tripwire, and further support for D2. |
| **M3** | `'where'` misspelled `'wheer'` in `ReadOnlyQueryClauseKeys` (so `where` is inherited *and* re-declared) | **TS2430** `Interface 'ReadOnlyQuery<T, W, S, R>' incorrectly extends interface 'Omit<FirestoreQueryBuilder<…>, …>'. The types returned by 'where(...)' are incompatible between these types. Type 'ReadOnlyQuery<T, W, S, R>' is missing the following properties from type 'FirestoreQueryBuilder<T, W, S, R>': collectionRef, commitInChunks, runHooks, toResult, and 24 more.` |

`probes/04-mutations.cjs` asserts all five expectations and **exits non-zero if any stops holding**,
so it is a self-check rather than a transcript: re-running it after the implementation is a one-command
confirmation that the guards still guard.

### §3.5 — Gate headroom and baselines (measured, not reasoned)

Parsed from the LCOV already on disk (`coverage/{unit,integration}/lcov.info`) against
`scripts/check-coverage-gates.mjs`.

| Gate | File | lines | branches | functions | Required | Slack |
| --- | --- | --- | --- | --- | --- | --- |
| Integration · `QueryBuilder (emulator)` (`:146`) | `src/core/QueryBuilder.ts` | 96.39 | 86.50 | 100.00 | 90 / 75 / 95 | +6.39 / +11.50 / +5.00 |
| Unit · `Package entry exports` (`:132`) | `src/index.ts` | 100.00 | 100.00 | 75.76 | **100 / 100** / 65 | **+0.00 / +0.00** / +10.76 |

**C3 — the change adds zero runtime statements and zero functions**, so all six numbers are
unchanged. That matters specifically because `src/index.ts` has **zero lines and branches slack**:
an `export type { … }` erases completely and is safe, but any *value* export or statement added
there would fail the unit gate outright. `src/core/CollectionGroup.ts` and `src/vector/**` are not
touched.

**C4 — baseline suite counts on a clean tree** (`npm run test:unit`,
`npm run test:integration:emulator`, both green):

- Unit: **35 suites / 455 tests**
- Integration: **37 suites / 548 tests**

`src/tests/types/*.type-test.ts` files are checked by `tsc` and **never run under jest**, so a new
type test moves neither count.

### §3.6 — Authoritative site enumeration (line numbers current as of `05c02cf`)

| id | File:line | What is there now | Change |
| --- | --- | --- | --- |
| **E1** | `src/core/QueryBuilder.ts:2290` | closing `}` of `class FirestoreQueryBuilder` | insert §6.1 immediately after, **before** the `getQueryRef` JSDoc at `:2292` |
| **E2** | `src/core/QueryBuilder.ts:4` | `import { FirestoreDocument, asFirestoreDocument } from './DocumentId.js';` | **no change** — `FirestoreDocument` is already imported |
| **E3** | `src/core/QueryBuilder.ts:12–19` | `import { DeepPartial, FieldPaths, … } from '../utils/pathTypes.js';` | **no change** — `DeepPartial` is already imported. §6 needs **no new imports.** |
| **E4** | `src/index.ts:22–27` | `export type { PaginatedResult, QueryFilterFactory, QueryExplainResult, QueryExplainStreamResult } from './core/QueryBuilder.js';` | add `ReadOnlyQuery` to the list |
| **E5** | `src/vector/index.ts:22–24` | comment + `export type { QueryExplainResult } from '../core/QueryBuilder.js';` | add `ReadOnlyQuery` to the same statement and extend the comment |
| **E6** | `src/tests/types/read-only-query.type-test.ts` | does not exist | create (§8.1) |
| **E7** | `src/tests/types/enforced-denormalization-facade.type-test.ts:18–21, :47–83, :124–125, :128–144` | header bullet 4; `OrderService`; `everyWritePathIsBlocked`'s final guard; `omitNarrowingLeakIsReal`'s JSDoc | update (§9.5) |
| **E8** | `src/tests/unit/packageExports.unit.test.ts:67–75` | the `WriteMetadata` type-only-export test | add a sibling assertion (§8.2) |
| **E9** | `docs/adr/0041-read-only-query-builder-type.md` | Status `Proposed`; decisions 3 & 4 as filed; "Scope left open" | edit in place (§9.1) |
| **E10** | `docs/adr/README.md:71` | the index row for ADR-0041, whose Status cell reads `Proposed` (date `2026-08-23`) | flip status (§9.1) |
| **E11** | `website/src/content/docs/reference/types.md:167–168` | the `QueryExplainStreamResult<R>` bullet, last in the query cluster | insert a `ReadOnlyQuery` bullet after it (§9.2) |
| **E12** | `website/src/content/docs/reference/query-builder.md:16–18, :272–284` | the "Chainable clause methods … return `this`" sentence; `## Query-level writes` | amend the sentence; add `## Read-only view` after `## Query-level writes` (§9.2) |
| **E13** | `website/src/content/docs/guides/advanced/patterns.md:505, :545–559` | "Reads: terminating helpers (see the note below…)"; the `:::note[Why reads are terminating helpers rather than a query builder]` aside | rewrite (§9.3) |
| **E14** | `website/src/content/docs/guides/working-with-data/queries.md:302–313, :476–480` | "Read-only, and the rest of the surface"; `## Bulk query operations` | cross-link (§9.3) |
| **E15** | `website/src/content/docs/guides/designing/security-boundary.md:67` | `## Out of scope` | insert a new section **before** it (§9.3) |

### §3.7 — Deliberately NOT changed (each entry proved, not assumed)

| Surface | Why it is safe to leave alone | Fact |
| --- | --- | --- |
| `src/core/CollectionGroup.ts` — `FirestoreCollectionGroupQueryBuilder` | Declares no write terminal at all, so no leak exists to close. Resolves ADR-0041's "Scope left open". | **P2** |
| `src/vector/VectorQueryBuilder.ts` | Ten public members, no `update`/`delete`. | **P3** |
| `src/core/QueryBuilder.ts` — `FirestoreQueryBuilderBase` | Stays unexported. | **D5** |
| `FirestoreQueryBuilder` itself, and every runtime file | The type is purely structural; `repo.query()` is assignable with no cast and no construction seam. | **V2, V3** |
| `getUnderlyingQuery(): Query<any>` stays on the read surface | An Admin SDK `Query` has no write member — it is not an escape hatch to a write. Inherited through `Omit` unchanged. | **P1** (return type read at `QueryBuilder.ts:1661`) |
| `docs/adr/0017-v3-core-operations-scope.md` — no amendment | #100 is labeled `enhancement`, not `parity`/`v3.x`, and is not in ADR-0017's deferral set. The set is down to **`(#41)`** alone (Enterprise Pipeline). | grep of `#41)` across `docs/adr/*.md`: 10 feature-ADR footers, all reading `(#41)`; ADR-0017's amendment blockquotes end at `(#40–#41)` |
| Living-index footers in ADRs 0023–0033 — no decrement | Same reason; no deferral closes here. ADRs 0039–0042 carry no footer at all. | same grep |
| `website/.../reference/scope-and-capabilities.md` | Its "Deferred to v3.x (tracked)" table (`:55–57`) contains only #41, and its "Supported (first-class)" table lists Firestore *capabilities*, not type-level ergonomics. Nothing to move. | file read at `:50–58` |
| `README.md` and `npm-readme.md` — **both grepped and unaffected** | No install, peer-dep, pitch, quick-start or migration change. `grep -n "query()\|QueryBuilder\|facade\|Omit<"` returns: `npm-readme.md:130` (a `.query()` inside the quick-start snippet, unrelated), `README.md:117` (the coverage-gate table), `README.md:173` (test-routing guidance). None describe the facade or the leak. So the `readme-sync` skill is **not** triggered. | grep output above |
| `src/express/index.ts` | No new error class, no status mapping. | §2 |
| `CHANGELOG.md` | Generated from Conventional Commits. | §10 |

---

## §4 — Traps

Ordered by how badly a competent implementer gets it wrong.

**T1 — Re-deriving a terminal with `Parameters`/`ReturnType` silently deletes an overload or a
generic (N1, N2, N3).** The obvious reading of ADR-0041 decision 3 is "do this for every member",
and it *compiles*. What breaks is downstream and quiet: `get({ withMetadata: true })` starts
returning `Promise<R[]>` instead of `Promise<WithMetadata<R>[]>`; `aggregate({ n: {kind:'count'} })`
returns `AggregationResult<AggregationSpec<S>>`, so every alias types as `number | null`;
`distinctValues('status')` loses its literal union. There is **no error at the declaration site** —
the failure appears in consumer code that does not exist yet. Terminals are inherited through
`Omit` and nothing else. Guarded by V5a–V5c, promoted into tests **T-5/T-6/T-7** in §8.1.

**T2 — A bare `type Missing = Exclude<…>` guards nothing (M1).** ADR-0041 decision 4 and the issue
body both show the guard unasserted, and the ADR even calls it out as "looks like inert type noise.
It is not". Measured: it *is*. Removing `orderById` from the interface produced `Missing =
"orderById"` and **zero diagnostics**. Silent-failure mode: a future read method is added to
`FirestoreQueryBuilder`, `ReadOnlyQuery` falls behind, CI stays green, and consumers discover it.
Every guard in §8.1 must terminate in `AssertTrue<…>`, and there must be **two** of them (`Missing`
*and* `Extra`). Guarded by **T-1/T-2**.

**T3 — Key-set guards are blind to a wrong return type (M2).** A clause member accidentally typed
`): FirestoreQueryBuilder<T, W, S, R>` keeps `Missing` and `Extra` both `never` — the member exists,
its name is right, only the chain leaks. This is the single most likely copy-paste slip in a block
with 14 near-identical lines, and it reopens exactly the defect #100 exists to close. It needs a
**per-clause-member** assertion, not one chained example: 13 sites, 13 rows. Guarded by **T-3** (the
`NoWrites` matrix) — see §8.3.

**T4 — Omitting a key from `ReadOnlyQueryClauseKeys` fails loudly, but only if the member is also
declared (M3).** `Omit<T, K>` accepts any `K extends keyof any`, so a typo is not itself an error.
The typo is caught (TS2430) *because* the interface re-declares the member and the inherited one
disagrees. Corollary: never "clean up" by deleting a re-declaration you think is redundant — that
converts a loud TS2430 into a silent leak. Guarded by **T-3** at that member's site.

**T5 — Marking the helper `@internal` breaks declaration emit.** `tsconfig.json` sets
`stripInternal: true`. `ReadOnlyQueryClauseKeys` is referenced by the exported interface's `extends`
clause and is emitted into the `.d.ts` (V8). An `@internal` tag would strip the declaration and
leave a dangling reference in the published types — invisible to `test:types`, visible only to
consumers and to `check:consumer`. Do not tag it. Guarded by the §10 `build` + `check:package` +
`check:consumer` legs and by §12's declaration-emit row.

**T6 — Dropping `W` "because it is unused" (V4, D2).** It is a phantom, and removing it is the
tempting simplification. It also silently re-binds `R` for every three-argument use — including the
one the docs, the ADR and the existing type test all write. Silent: `.get()` returns rows without
`id` and compiles. The `@template W` JSDoc in §6 exists to stop this; do not delete it.

**T7 — A Starlight `:::note` / `:::caution` whose closing fence lands on a content line renders as
literal `:::` on the published page, and neither `check:docs` nor `docs:build` catches it.** §9.3
deletes one aside and adds another; this shipped live twice (#33, #34). `website/**/*.md` is also
**prettier-exempt** (`.prettierignore`), so match surrounding style by hand — `npm run format` will
not fix indentation there. Verification is the grep in §10 step 6, against the **built HTML**.

**T8 — `check:docs` validates `#anchor` fragments against real heading slugs.** §9.2 adds
`## Read-only view` to `reference/query-builder.md`, and §9.3 links to it. If the heading text and
the link fragment disagree by one character, `check:docs` fails — which is the good outcome, but
only if you run it. It is leg 13 of §10.

---

## §5 — Could not verify / bounds

1. **`npm run check:consumer` covers one peer major locally.** It defaults to the dev
   `firebase-admin`; CI fans out over `^12` / `^13` / `^14` plus a pinned-firestore `^12` leg via
   `FLINTFIRE_ADMIN_VERSION` / `FLINTFIRE_FIRESTORE_VERSION`. Claim only the leg you ran. (The risk
   is genuinely low here — the emitted `.d.ts` references no `firebase-admin` type that
   `FirestoreQueryBuilder` does not already reference, V8 — but "low" is not "verified".)
2. **§6 was compiled through a virtual-file program using `tsconfig.typecheck.json`'s options and
   real module resolution, not by running `npm run test:types` on a file physically in `src/`.** The
   options and resolution are identical; the invocation is not. The implementer must run the real
   gate. Recorded honestly in §12.
3. **`npm run docs:build` was not run** — no website file was modified during planning.
4. **Strict-pnpm consumer resolution was not exercised.** V8 shows no undeclared package in the
   emitted `.d.ts`, which is the mechanism that breaks pnpm consumers, but no pnpm install was run.
5. **Carried over and still deferred:** exporting `FirestoreQueryBuilderBase` as a documented
   minimal read surface (D5), a `ReadOnlyQueryOf<Repo>` helper (D6), and runtime `Proxy`
   enforcement (D7). None is a prerequisite for anything here.

---

## §6 — API specification

Copy-verbatim. Compiled as written and prettier-clean (§12). **No new imports** — `FirestoreDocument`
(`QueryBuilder.ts:4`) and `DeepPartial` (`:12`) are already in scope (E2, E3).

### §6.1 — `src/core/QueryBuilder.ts`, inserted after line 2290 (the class's closing `}`), before the `getQueryRef` JSDoc

```typescript
/**
 * The chainable clause members of {@link FirestoreQueryBuilder} — every member whose declared return
 * type is `this`, plus `select`, which returns a re-parameterized builder. This is exactly the set
 * {@link ReadOnlyQuery} must re-declare: an `Omit` keeps the member but leaves its return type
 * pointing at the full builder, which is the leak ADR-0041 exists to close.
 *
 * Do NOT replace this with a conditional type that derives the set from `keyof`. The list is short,
 * `src/tests/types/read-only-query.type-test.ts` checks it from both sides, and a derived version
 * reads as clever while catching nothing extra.
 */
type ReadOnlyQueryClauseKeys =
  | 'where'
  | 'whereFilter'
  | 'whereId'
  | 'orderBy'
  | 'orderById'
  | 'limit'
  | 'limitToLast'
  | 'offset'
  | 'startAt'
  | 'startAfter'
  | 'endAt'
  | 'endBefore'
  | 'select';

/**
 * A **read-only view** of {@link FirestoreQueryBuilder}: the entire read surface — filtering,
 * composite filters, document-name queries, ordering, projection, bounds, aggregation, pagination,
 * streaming, listeners, explain — with `update()` and `delete()` absent **at every chain depth**
 * (ADR-0041).
 *
 * Hand this out from a facade that owns its own write paths. `repository.query()` is assignable with
 * **no cast** — annotate the return type and you are done. There is no wrapper object and no runtime
 * cost; this type erases completely.
 *
 * @example
 * class OrderService {
 *   constructor(private readonly orders: typeof orderRepo) {}
 *   query(): ReadOnlyQuery<Order> {
 *     return this.orders.query(); // structural — no cast
 *   }
 * }
 *
 * await svc.query().where('status', '==', 'pending').orderBy('updatedAt').get(); // ✓
 * await svc.query().where('status', '==', 'pending').update({ status: 'shipped' }); // ✗ TS2339
 *
 * @remarks
 * **Why not `Omit<FirestoreQueryBuilder<…>, 'update' | 'delete'>`?** TypeScript resolves a `this`
 * return type against the *declared* type of the receiver. The `Omit` blocks the immediate call and
 * then hands the full builder back from the first `.where(...)`, so the narrowing survives exactly
 * one expression. Every clause member below returns `ReadOnlyQuery` instead, so it survives
 * transitively. Never "simplify" this back to an `Omit`: that reintroduces the leak *silently*,
 * because the blocked immediate call still looks like proof.
 *
 * **Type-level only.** A deliberate cast back to `FirestoreQueryBuilder` still reaches `update()`.
 * The purpose is compile-time enforcement of an application's own boundary (ADR-0041, decision 5).
 *
 * @template T - **read data** (no `id`) — same meaning as on {@link FirestoreQueryBuilder}.
 * @template W - **write model.** Accepted for positional parity with
 *   {@link FirestoreQueryBuilder}`<T, W, S, R>`, so a signature can be copied across without
 *   silently re-binding `S` / `R`. No read member references it, so it does not affect assignability.
 * @template S - **stored data** — the source of query FIELD PATHS.
 * @template R - the current result shape of terminal reads; `select(...)` narrows it exactly as on
 *   the concrete builder.
 */
export interface ReadOnlyQuery<
  T extends object,
  W extends object = T,
  S extends object = T,
  R = FirestoreDocument<T>,
> extends Omit<FirestoreQueryBuilder<T, W, S, R>, 'update' | 'delete' | ReadOnlyQueryClauseKeys> {
  // Every terminal read (`get`, `getOne`, `count`, `exists`, `sum`, `average`, `aggregate`,
  // `distinctValues`, `paginate`, `offsetPaginate`, `paginateWithCount`, `stream`, `onSnapshot`,
  // `onSnapshotDetailed`, `explain`, `explainStream`, `collectionCount`, `getUnderlyingQuery`) is
  // INHERITED from the `Omit` above and must stay that way. Restating one as
  // `(...a: Parameters<QB[k]>): ReturnType<QB[k]>` breaks it silently: `Parameters` / `ReturnType`
  // resolve an overloaded member to its LAST signature and erase type parameters, so
  // `get({ withMetadata: true })` would lose its `WithMetadata` overload and `aggregate` /
  // `distinctValues` would lose their generics. `Omit` is a homomorphic mapped type and copies the
  // property type verbatim, overloads and generics included.
  //
  // Only the clause members below are re-declared, and only their RETURN type is written by hand;
  // parameters are derived from the real builder so they cannot drift (ADR-0041, decision 3).
  where(...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['where']>): ReadOnlyQuery<T, W, S, R>;
  whereFilter(
    ...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['whereFilter']>
  ): ReadOnlyQuery<T, W, S, R>;
  // Spelled out rather than derived: `whereId` is overloaded, and `Parameters<…>` collapses it to
  // the last signature — which would leave only `in` / `not-in` and reject `whereId('==', id)`.
  whereId(op: '<' | '<=' | '==' | '!=' | '>=' | '>', value: string): ReadOnlyQuery<T, W, S, R>;
  whereId(op: 'in' | 'not-in', value: readonly string[]): ReadOnlyQuery<T, W, S, R>;
  orderBy(...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['orderBy']>): ReadOnlyQuery<T, W, S, R>;
  orderById(
    ...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['orderById']>
  ): ReadOnlyQuery<T, W, S, R>;
  limit(...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['limit']>): ReadOnlyQuery<T, W, S, R>;
  limitToLast(
    ...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['limitToLast']>
  ): ReadOnlyQuery<T, W, S, R>;
  offset(...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['offset']>): ReadOnlyQuery<T, W, S, R>;
  // The four bound members are overloaded too, but their LAST overload is the permissive
  // `(...fieldValues: unknown[])`, which also accepts the `DocumentSnapshot` form — so deriving is
  // lossless here and keeps them drift-proof.
  startAt(...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['startAt']>): ReadOnlyQuery<T, W, S, R>;
  startAfter(
    ...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['startAfter']>
  ): ReadOnlyQuery<T, W, S, R>;
  endAt(...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['endAt']>): ReadOnlyQuery<T, W, S, R>;
  endBefore(
    ...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['endBefore']>
  ): ReadOnlyQuery<T, W, S, R>;
  // Mirrors the concrete builder's projection narrowing, re-parameterized on ReadOnlyQuery so the
  // read-only guarantee survives a `select()` too.
  select(
    ...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['select']>
  ): ReadOnlyQuery<T, W, S, FirestoreDocument<DeepPartial<T>>>;
}
```

### §6.2 — `src/index.ts` (E4), replacing lines 22–27

```typescript
export type {
  PaginatedResult,
  QueryFilterFactory,
  QueryExplainResult,
  QueryExplainStreamResult,
  ReadOnlyQuery,
} from './core/QueryBuilder.js';
```

### §6.3 — `src/vector/index.ts` (E5), replacing lines 22–24

```typescript
// Re-exported so /vector consumers can name explain()'s return type and the read-only query view
// without importing the main entry (QueryBuilder has no export-map subpath) — same rationale as
// VectorValueLike above. `withVectorSearch` proxies `query()` unchanged, so a facade over a
// vector-enabled repository needs `ReadOnlyQuery` from this specifier (ADR-0041).
export type { QueryExplainResult, ReadOnlyQuery } from '../core/QueryBuilder.js';
```

### §6.4 — Size estimate

| Area | Files | ±lines |
| --- | --- | --- |
| `src/core/QueryBuilder.ts` | 1 | +117 / −0 |
| `src/index.ts`, `src/vector/index.ts` | 2 | +5 / −2 |
| Tests (`read-only-query.type-test.ts` new; 2 edited) | 3 | +150 / −25 |
| Docs (2 ADR files, 5 website pages) | 7 | +115 / −25 |
| Plan-directory removal (§11) | — | −(the whole directory) |
| **Total (excl. plan removal)** | **13** | **≈ +387 / −52**, **zero executable statements** |

---

## §7 — Implementation sequence

Order matters where stated.

1. `git fetch && git checkout feat/issue-100-read-only-query && git rebase origin/main`. Re-run the
   §3.6 enumeration (`grep -n` the anchors in E1–E15) and fix any drifted line numbers in your own
   working notes before editing. Do **not** cut a new branch.
2. **§6.1 into `src/core/QueryBuilder.ts` first**, then `npm run test:types`. This must be clean
   before anything else — every later step assumes the type resolves.
3. §6.2 and §6.3 (the two re-exports). `npm run test:types` again.
4. **§8.1: create `src/tests/types/read-only-query.type-test.ts`, then mutation-check it before
   moving on.** Order matters: a guard written after the implementation is done tends to be written
   to pass. Run the three checks in §8.4 and record the exact diagnostics in `notes.md`. A guard that
   does not fail on its mutation is not a guard — fix it now, not later.
5. §8.2 (the `packageExports` assertion) and §9.5 (the facade type-test update). `npm run test:unit`
   and `npm run test:types`.
6. §9.1 (ADR-0041 in place + index status) — do this **before** the website pages, so the website
   prose can cite the ADR's final wording rather than the filed wording.
7. §9.2 (`reference/types.md`, `reference/query-builder.md`) — the `## Read-only view` heading must
   exist before §9.3 links to its anchor (T8).
8. §9.3 (`patterns.md`, `queries.md`, `security-boundary.md`). Then `npm run check:docs`.
9. Full §10 gate, honestly reported.
10. Write up the refute-first self-review in `notes.md`; commit it on the branch.
11. **Only after review:** §11's `git rm -r docs/plans/issue-100-read-only-query-builder-type/` as a
    separate final commit.

### Anti-instructions — do NOT

- **Do not commit or push unless asked.** Stage and report; the owner decides.
- **Do not touch `FirestoreQueryBuilder`, `FirestoreQueryBuilderBase`, `CollectionGroup.ts`, or
  `src/vector/VectorQueryBuilder.ts`.** P2/P3 prove the group and vector builders have no write
  terminals, and the whole point of D-1/V2 is that the concrete builder needs no change to be
  assignable.
- **Do not add a runtime statement to `src/index.ts`.** Its unit gate requires 100 % lines *and*
  100 % branches with **zero slack** (C2). `export type { … }` erases; anything else does not.
- **Do not restate a terminal read with `Parameters`/`ReturnType`** (T1). Not `get`, not `getOne`,
  not `stream`, not `paginate`, not `aggregate`, not `distinctValues`. They are inherited.
- **Do not write a drift guard as a bare `type Missing = …`** (T2). Every guard ends in
  `AssertTrue<…>`.
- **Do not derive `ReadOnlyQueryClauseKeys` from a conditional type.** It is checked from both
  sides; a derived version catches nothing extra and reads as clever.
- **Do not tag `ReadOnlyQueryClauseKeys` `@internal`** (T5) — `stripInternal: true` would strip a
  declaration the exported `.d.ts` references.
- **Do not drop the `W` type parameter or its `@template` note** (T6).
- **Do not "simplify" `ReadOnlyQuery` to `Omit<FirestoreQueryBuilder<…>, 'update' | 'delete'>`.**
  That is the defect.
- **Do not add an ADR-0017 amendment, decrement any `(#41)` living-index footer, or move a row in
  `scope-and-capabilities.md`.** #100 is an `enhancement`, not a deferral (§3.7). Copying the
  deferral bookkeeping pattern onto a non-deferral issue is a known failure mode here.
- **Do not create a new ADR.** ADR-0041 already exists and is `Proposed`; it is edited in place.
- **Do not run `npm run format` over `website/`** — it is prettier-exempt (T7); match style by hand.
- **Do not touch `CHANGELOG.md`** (generated) or `docs/2.0/` (frozen archive).
- **Do not write `review.md`.** Your self-review goes in chat + `notes.md`.

---

## §8 — Test specification

Every test below must **fail on the unfixed baseline**. §8.4 is how you prove it, and it is not
optional.

### §8.1 — `src/tests/types/read-only-query.type-test.ts` (new) — gate: `test:types`

Follows the house pattern in `snapshot-metadata.type-test.ts:25–27` / `write-metadata.type-test.ts:21–23`:
local `ExpectEqual` + `AssertTrue`, `type _x = AssertTrue<…>` (the `_` prefix satisfies
`@typescript-eslint/no-unused-vars`'s `varsIgnorePattern: '^_'`; type-test files **are** linted —
`eslint.config.js` ignores `**/*.test.ts`, which `*.type-test.ts` does not match).

Add a JSDoc header describing the strategy and the verification points, per the test guardrails.

| id | Asserts | The observable that differs when it fails | Guards |
| --- | --- | --- | --- |
| **T-1** | `AssertTrue<ExpectEqual<Exclude<keyof QB, keyof RO \| 'update' \| 'delete'>, never>>` | TS2344 `Type 'false' does not satisfy the constraint 'true'` — a read member exists on the builder and not on `ReadOnlyQuery` | T2 |
| **T-2** | `AssertTrue<ExpectEqual<Exclude<keyof RO, keyof QB>, never>>` | same TS2344 — `ReadOnlyQuery` grew a member the builder does not have (a misspelling, or a member kept after a builder removal) | T2 |
| **T-3** | 13 rows of `AssertTrue<NoWrites<ReturnType<RO[k]>>>` for every `k` in `ReadOnlyQueryClauseKeys`, where `type NoWrites<X> = 'update' extends keyof X ? false : 'delete' extends keyof X ? false : true` | TS2344 at the offending member's row — names exactly which clause leaks | T3, T4 |
| **T-4** | `@ts-expect-error` on `.update(…)` / `.delete()` at five chain depths: immediate; after `.where()`; after `.orderBy()`; after `.select().where()`; after `.whereId().orderById().startAt().endBefore().limit()` | the `@ts-expect-error` stops being satisfied → TS2578 "Unused '@ts-expect-error' directive" | T3 |
| **T-5** | `AssertTrue<ExpectEqual<typeof ro.get({ withMetadata: true }), Promise<WithMetadata<FirestoreDocument<Order>>[]>>>` and the plain-`get` counterpart | TS2344 — an overload was lost | T1 |
| **T-6** | `AssertTrue<ExpectEqual<Awaited<ReturnType<…aggregate({ n: {kind:'count'}, s: {kind:'sum', field:'score'} })>>, { n: number; s: number }>>` | TS2344 — the `Spec` generic was erased and the aliases widened | T1 |
| **T-7** | `AssertTrue<ExpectEqual<Awaited<…distinctValues('status')>, ('pending' \| 'shipped')[]>>` | TS2344 — `K` was erased | T1 |
| **T-8** | `ro.whereId('==', 'x')` and `ro.whereId('in', ['a','b'])` both compile un-annotated | a plain type error on whichever overload was collapsed away | T1 |
| **T-9** | No-cast assignability from a real schema repo: `function facade(): ReadOnlyQuery<Order> { return repo.query(); }` where `Order = DataOf<typeof repo>`; **and** the W ≠ T case from V4 | TS2322 at the `return` — the structural contract broke | T6, D2 |
| **T-10** | `AssertTrue<ExpectEqual<Awaited<…select('status').get()>, (Omit<DeepPartial<Order>, 'id'> & { readonly id: string })[]>>` | TS2344 — `select`'s re-parameterization was lost, or it returned the full builder | T3 |
| **T-11** | `ReadOnlyQuery` is importable from the **root** specifier (`from '../../index.js'`) — this is the only compile-time proof of E4 | TS2305 "Module … has no exported member 'ReadOnlyQuery'" | E4 |
| **T-12** | `ReadOnlyQuery` is importable from the **`/vector` barrel** (`from '../../vector/index.js'`) | TS2305 | E5 |

`QB` / `RO` are instantiated from a real `FirestoreRepository.withSchema(db, 'orders', z.object({…}))`,
not a hand-written interface — V3 showed the schema path is where the real assignability question
lives.

### §8.2 — `src/tests/unit/packageExports.unit.test.ts` (edit) — gate: `test:coverage:gate:unit`

One new `it(...)` beside the existing `WriteMetadata` case (E8), same shape and same rationale:

- Asserts `(orm as Record<string, unknown>).ReadOnlyQuery` is `undefined` — a type-only export must
  not be emitted as a runtime value.
- Failure observable: the assertion fails if someone converts the `export type` to a value export.
- Compile-time root-import coverage is **T-11**, not this test; say so in the comment (the
  `WriteMetadata` case sets that precedent verbatim).
- Effect on counts: unit **455 → 456 tests**, suites **35 → 35**.

### §8.3 — Trap-coverage matrix (the inverse direction)

One row per trap **per site the trap can occur at**.

| Trap | Site | Test that fails | Observable |
| --- | --- | --- | --- |
| T1 | `get` | T-5 | `Promise<R[]>` instead of `Promise<WithMetadata<R>[]>` → TS2344 |
| T1 | `getOne` / `stream` / `paginate` / `offsetPaginate` / `paginateWithCount` | T-1 + T-5's pattern | if any is restated, its `{ withMetadata: true }` call in the file fails to compile |
| T1 | `aggregate` | T-6 | aliases resolve to `number \| null` instead of `number` → TS2344 |
| T1 | `distinctValues` | T-7 | `unknown[]` / widened union instead of `('pending' \| 'shipped')[]` → TS2344 |
| T1 | `whereId` | T-8 | `whereId('==', 'x')` fails to compile (TS2769) |
| T2 | the `Missing` guard | T-1 (asserted form) | TS2344 — proven by M1 vs M1′ |
| T2 | the `Extra` guard | T-2 | TS2344 |
| T3 | each of the 13 clause members | T-3, that member's row | TS2344 naming the member; key guards stay `never` (M2) |
| T3 | 5 chain depths incl. post-`select` | T-4 | TS2578 unused `@ts-expect-error` |
| T4 | a clause key dropped from `ReadOnlyQueryClauseKeys` | T-3 + `test:types` | TS2430 at the `extends` clause (M3) |
| T5 | `@internal` on the helper | §10 `build` + `check:package` + `check:consumer` | emitted `.d.ts` references a stripped declaration |
| T6 | `W` dropped | T-9 (W ≠ T leg) + T-10 | `ReadOnlyQuery<Order, Order, Order>` binds `R = Order`; T-10's `DeepPartial` equality fails |
| T7 | the two `:::` asides in `patterns.md` | §10 step 6 grep of the built HTML | literal `:::` in `website/dist/**/*.html` |
| T8 | the `#read-only-view` anchor | `npm run check:docs` | "broken anchor" for `reference/query-builder/#read-only-view` |

**Gate ownership.** `src/core/QueryBuilder.ts` → integration gate; `src/index.ts` → unit gate.
Neither moves, because the change adds zero executable statements (C3). `src/vector/index.ts` is in
**neither** gate's matcher list — flagged here so nobody looks for a threshold that does not exist;
`src/tests/types/**` is excluded from coverage entirely (`jest.config.base.js:30`).
Measured headroom: §3.5.

### §8.4 — Mutation checks (required, before step 5 of §7)

Run each, record the exact diagnostic in `notes.md`, then revert (`git checkout -- src/`).

1. Delete the `orderById(...)` declaration from §6.1's interface (leave `'orderById'` in
   `ReadOnlyQueryClauseKeys`). **Expect: TS2344 on T-1.** If you get zero diagnostics, your guard is
   unasserted — that is exactly M1.
2. Change `where`'s return type to `FirestoreQueryBuilder<T, W, S, R>`. **Expect: TS2344 on T-3's
   `where` row, and T-1/T-2 still clean.**
3. Misspell `'where'` as `'wheer'` in `ReadOnlyQueryClauseKeys`. **Expect: TS2430 at the `extends`
   clause.**

---

## §9 — Docs and ADR bookkeeping

### §9.1 — ADR-0041 (`docs/adr/0041-read-only-query-builder-type.md`) — edited **in place**

Legitimate because ADR-README's immutability rule (`README.md:12`) binds `Accepted` records, and
0041 is `Proposed`. No `> Amendment` blockquote — those are for shipped decisions.

1. **`- **Status:**`** (line 3): `Proposed` → `Accepted (v3.x, pending merge/release)` — matching the
   phrasing used by ADRs 0025–0038.
2. **Decision 3** — keep the `Parameters<…>` rule but scope it: it applies to the **clause** members
   only, because `Parameters`/`ReturnType` resolve an overloaded member to its last signature and
   erase type parameters (cite the three casualties: `whereId`'s comparison overload, the
   `{ withMetadata: true }` overloads, `aggregate` / `distinctValues` generics). State that the read
   terminals are inherited verbatim through `Omit`, which is homomorphic and copies overloads and
   generics unchanged, and that `whereId` is hand-written as two overloads.
3. **Decision 4** — correct the guard: it must be **asserted**
   (`AssertTrue<ExpectEqual<Missing, never>>`), because a bare alias emits no diagnostic (measured);
   and it must be **two-sided** (`Missing` and `Extra`). Replace "Confirmed to fire on a deliberately
   incomplete `ReadOnlyQuery`" with the accurate statement.
4. **New decision 7** — the exported symbol is an **`interface`**, not a type alias: both compile
   identically, but the alias prints a multi-thousand-character intersection in every hover and
   error, which defeats the purpose of a type whose product is a legible compile error.
5. **New decision 8** — the parameter list is `<T, W = T, S = T, R = FirestoreDocument<T>>`,
   positionally identical to `FirestoreQueryBuilder`. `W` is a documented phantom; dropping it makes
   the ubiquitous three-argument form silently re-bind `R`.
6. **"Scope left open"** — replace with the resolution: the collection-group builder needs nothing
   (`keyof` contains no write member), and neither does `VectorQueryBuilder`. Note that
   `ReadOnlyQuery` is nonetheless re-exported from the `/vector` barrel, because `withVectorSearch`
   proxies `query()` unchanged and `core/QueryBuilder` has no export-map subpath.
7. **The "maintenance note for future readers"** — keep it, but make the asserted form the thing it
   warns about deleting.
8. **References** — add `src/tests/types/read-only-query.type-test.ts`.
9. **`docs/adr/README.md:71`** — update the Status cell to match item 1.

### §9.2 — Reference pages

- **`website/src/content/docs/reference/types.md`**, after the `QueryExplainStreamResult<R>` bullet
  (ends line 168), before the closing paragraph at line 170: a
  **`ReadOnlyQuery<T, W = T, S = T, R = FirestoreDocument<T>>`** bullet — the read-only view of the
  query builder; every clause returns `ReadOnlyQuery` so `update()` / `delete()` stay absent at any
  chain depth; `repo.query()` is assignable with no cast; type-level only. Link to
  `/flintfire/reference/query-builder/#read-only-view`. Match the bullet style of the neighbouring
  `ReadOnlyTransactionalRepository` entry (`:123`), which is the closest precedent in tone.
- **`website/src/content/docs/reference/query-builder.md:16–18`** — the sentence "Chainable clause
  methods (`where`, `whereFilter`, `whereId`, `orderBy`, `orderById`, `limit`) return `this`;
  `select()` returns a **new** builder (see below)." Add: and see
  [Read-only view](#read-only-view) for handing the builder across a boundary without its write
  terminals.
- **`website/src/content/docs/reference/query-builder.md`**, new `## Read-only view` section
  immediately after `## Query-level writes` (which ends line 284) and before
  `## Collection-group query builder` (line 285). Content: the `ReadOnlyQuery` signature; the facade
  example from §6.1's `@example`; the one-line explanation of why `Omit` does not work; a note that
  the collection-group builder needs no equivalent because it declares no write terminals (link to
  the existing section below); and the type-level-only caveat. **The heading text must be exactly
  `## Read-only view`** so the `#read-only-view` slug resolves (T8).

### §9.3 — Guides

- **`website/src/content/docs/guides/advanced/patterns.md`** (E13):
  - `:505` — the comment "`// Reads: terminating helpers (see the note below on why the query builder
    is not exposed).`" becomes a comment introducing the read surface, with the builder now exposed.
  - Add a `query(): ReadOnlyQuery<Order> { return this.orders.query(); }` member to `OrderService`,
    and add `ReadOnlyQuery` to the `import type { DataOf, ID, UpdateInput } from 'flintfire';` line
    at `:492`. Keep `countByStatus` / `listByStatus` — they are still good facade design, and
    §9.5 keeps pinning them.
  - `:545–559` — **delete** the whole
    `:::note[Why reads are terminating helpers rather than a query builder]` aside, including its
    fenced snippet, and replace it with a short `:::tip[Handing out the query builder safely]` (or
    plain prose) stating that `ReadOnlyQuery` makes the write terminals absent at every chain depth,
    that `Omit` does not (one sentence on the `this` mechanism), and that it is compile-time only.
    **Verify the closing `:::` sits on its own line with a blank line before it** (T7).
- **`website/src/content/docs/guides/working-with-data/queries.md`** (E14):
  - `:302–313` ("Read-only, and the rest of the surface") — one sentence: the group builder's absent
    write surface is structural; for the *single-collection* builder, `ReadOnlyQuery` gives the same
    guarantee at the type level. Link to `/flintfire/reference/query-builder/#read-only-view`.
  - `:476–480` (`## Bulk query operations`) — one sentence after the opening paragraph: to hand a
    query builder across a trust boundary with `update()` / `delete()` withheld, annotate it as
    `ReadOnlyQuery`. Same link.
- **`website/src/content/docs/guides/designing/security-boundary.md`** (E15) — new section inserted
  **before** `## Out of scope` (line 67): withholding the query builder's write terminals. Two
  sentences plus a three-line snippet (the facade `query()` accessor), cross-linking
  `/flintfire/guides/advanced/patterns/#enforced-denormalization` and the reference anchor. This page
  currently has no `:::` asides — do not introduce one.

### §9.4 — Explicitly NOT part of the docs sweep

No new ADR (0041 exists). **No ADR-0017 amendment, no living-index footer decrement, no
`scope-and-capabilities.md` row move** — #100 is labeled `enhancement`, and ADR-0017's remaining
deferral set is `(#41)` alone (§3.7). **No `README.md` / `npm-readme.md` change** — both grepped,
both unaffected, so the `readme-sync` skill does not fire (§3.7). No `CHANGELOG.md` edit. No
`docs/2.0/` edit. No `docs/development/` edit (no test infrastructure added — one new file in an
existing suite directory, no new harness, factory, mock, script or gate).

### §9.5 — `src/tests/types/enforced-denormalization-facade.type-test.ts` (E7)

This file pins the published guide, so §9.3's rewrite must land here too.

1. **Header bullet 4 (`:18–21`)** — currently claims the facade "does NOT hand back a query builder"
   and that landing ADR-0041 makes `leakIsReal` "fail loudly". Both are now wrong: the facade *does*
   hand one back, and `omitNarrowingLeakIsReal` will keep passing because nothing about `Omit`
   changed (§2.1). Rewrite to state that the facade hands back a `ReadOnlyQuery`, that the `Omit`
   leak is still real and still pinned as the reason `ReadOnlyQuery` exists, and point at
   `read-only-query.type-test.ts` for the read-only contract itself.
2. **`OrderService`** — add `query(): ReadOnlyQuery<Order> { return this.orders.query(); }`,
   mirroring §9.3's guide edit verbatim, and import `ReadOnlyQuery` from `'../../index.js'`.
3. **`documentedSurfaceCompiles`** — exercise the new accessor:
   `orders.query().where('status','==','pending').orderBy('updatedAt').get()`.
4. **`everyWritePathIsBlocked`** — the final guard `// @ts-expect-error … await orders.query()`
   (`:124–125`) **must be removed**: `orders.query()` now exists, so the directive becomes unused and
   fails with TS2578. Replace it with two guards that still hold —
   `@ts-expect-error` on `orders.query().update({ … })` and on
   `orders.query().where('status','==','pending').delete()` — which is the guard that actually
   belongs here now.
5. **`omitNarrowingLeakIsReal`** — keep it, unchanged in behavior, and correct its JSDoc: it pins
   *why* `ReadOnlyQuery` exists, not a signal that will start failing.

---

## §10 — Gate and commit

Run the full gate. Report real output; if a leg fails, say so with the output rather than
re-characterising it.

```bash
npm run test:types && npm run lint && npm run check:format && npm run test:unit && npm run test:integration:emulator && npm run test:unit:coverage && npm run test:coverage:gate:unit && npm run test:integration:coverage && npm run test:coverage:gate:integration && npm run build && npm run check:package && npm run check:consumer && npm run check:docs && npm run check:zod-idioms && npm run docs:build
```

Fifteen legs — the skill's canonical fourteen plus `check:zod-idioms`, which landed on this baseline
with `b999f40`. It must be run even though this change introduces no Zod snippet: it scans every
doc, and §9 edits five website pages. `npm run rules:check` is **not** a leg — nothing under
`.rulesync/` changes — but the pre-push hook runs it anyway, so keep it that way.
`npm run release:verify` is the release-time superset (adds `check:manifest`, `check:audit`).

**Expected counts on your rebased baseline** — measure them yourself before editing and compare:

| Suite | Baseline (measured at `05c02cf`) | After | Why |
| --- | --- | --- | --- |
| Unit | 35 suites / 455 tests | 35 suites / **456** tests | one `it(...)` added to an existing suite (§8.2) |
| Integration | 37 suites / 548 tests | 37 suites / 548 tests — **unchanged** | type-only change; no emulator behavior to test. Do not manufacture an integration test to make a number move. |

Type tests are checked by `tsc`, never run by jest, so `read-only-query.type-test.ts` moves neither
count. Coverage percentages for `src/core/QueryBuilder.ts` and `src/index.ts` must be **identical**
to §3.5 — the change adds zero executable statements. If either moved, something runtime slipped in.

**Additional verification steps beyond the 14 legs:**

5. Re-run all four probes from `docs/plans/issue-100-read-only-query-builder-type/probes/` on the
   rebased tree and confirm the §3 tables still hold. Expected: `01` prints 33 / 31 / 10 members;
   `02` prints the five collapses; `03` prints `0 diagnostics`; `04` prints TS2344 / TS2344 / TS2430.
6. **Grep the built HTML for the aside hazard (T7)** — after `npm run docs:build`:
   `grep -rn ':::' website/dist/guides/advanced/patterns/index.html` — **expected result: no
   matches.** A match means a `:::` fence rendered literally. Run the same grep on
   `website/dist/guides/designing/security-boundary/index.html` and
   `website/dist/reference/query-builder/index.html`; both must also be empty.
7. **Grep that no stale caveat survives:**
   `grep -rn "terminating helpers" website/src/content/docs/ | grep -v '/2.0/'` — **expected result:
   no matches.** The phrase occurs on exactly three lines today — `patterns.md:505` (the code
   comment), `:545` (the aside title) and `:557` (the prose) — and §9.3 removes all three. "No rows"
   is the pass here, so confirm the grep is well-formed by running it on the unmodified tree first,
   where it must return exactly those three lines.
8. **Grep that the leak text is gone from the v3 tree:**
   `grep -rn "Omit<FirestoreQueryBuilder" website/src/content/docs/ | grep -v '/2.0/'` — the only
   acceptable remaining match is inside §9.3's new explanatory sentence, if you chose to name the
   anti-pattern there. `src/tests/types/enforced-denormalization-facade.type-test.ts` keeps its
   occurrence on purpose (§9.5.5).

**Commit** (Conventional Commits; commitlint runs on `commit-msg`):

```
feat(query): export a ReadOnlyQuery builder type so write terminals cannot leak through a fluent chain
```

Body: the `this`-resolves-against-the-declared-receiver mechanism, `Closes #100`, `ADR-0041`. Plan
removal is a separate final commit: `chore: remove issue-100 implementation plan`.

**Breaking or not: NOT breaking.** One additive type-only export; no existing signature, return
contract or runtime behavior changes (§2, §3.7, C3). `src/tests/types/enforced-denormalization-facade.type-test.ts`
changes, but a test is not a public contract. It folds into the unreleased `3.0.0` as a `feat`.
Forward commitment worth noting in the PR body: once consumers annotate facades with
`ReadOnlyQuery`, removing a member from it *is* breaking.

---

## §11 — Definition of done

- [ ] Branch checked out and rebased onto `main`; §3.6 enumeration re-verified (§7.1)
- [ ] §6.1 in `src/core/QueryBuilder.ts` verbatim, after the class's closing `}`, no new imports (E1–E3)
- [ ] `ReadOnlyQuery` exported from `src/index.ts` (§6.2 / E4) and `src/vector/index.ts` (§6.3 / E5)
- [ ] `src/tests/types/read-only-query.type-test.ts` created with T-1 … T-12, JSDoc header, every guard **asserted** (§8.1)
- [ ] All three §8.4 mutation checks run, diagnostics recorded in `notes.md`, tree reverted
- [ ] `packageExports.unit.test.ts` assertion added; unit count 455 → 456 (§8.2)
- [ ] `enforced-denormalization-facade.type-test.ts` updated — all five items, including removing the now-unused `@ts-expect-error` on `orders.query()` (§9.5)
- [ ] ADR-0041 edited in place: status + decisions 3, 4, new 7, new 8, "Scope left open" resolved, References (§9.1); `docs/adr/README.md:71` status matches
- [ ] `reference/types.md` bullet; `reference/query-builder.md` sentence + `## Read-only view` section with that exact heading (§9.2)
- [ ] `patterns.md` facade accessor + caveat aside replaced; `queries.md` two cross-links; `security-boundary.md` new section (§9.3)
- [ ] **No** ADR-0017 amendment, **no** `(#41)` footer edit, **no** `scope-and-capabilities.md` row, **no** README change, **no** `CHANGELOG.md` edit (§9.4)
- [ ] All 15 §10 legs run and reported honestly; coverage for `QueryBuilder.ts` / `index.ts` identical to §3.5
- [ ] §10 steps 5–8 run, including the built-HTML `:::` grep and the two must-be-empty greps, with expected results stated
- [ ] Nothing in the §7 anti-instruction list violated
- [ ] Refute-first adversarial self-review written up in chat and dispositioned in `notes.md`, committed on the branch
- [ ] **After review:** `git rm -r docs/plans/issue-100-read-only-query-builder-type/` as the final commit, before merge

---

## §12 — Pre-handoff verification

| Check | Command / method | Result |
| --- | --- | --- |
| §6 blocks compile as written | `probes/03-readonly-query.ts` — §6.1 verbatim plus every §8.1 assertion — through `probes/harness.cjs` (virtual `src/__probe_ff__.ts`, `tsconfig.typecheck.json` options, real module resolution) | **0 diagnostics.** Not a repo edit and not `npm run test:types` itself — see §5.2 |
| Every `from '…'` specifier §6 uses | same program: `'./core/DocumentId.js'`, `'./utils/pathTypes.js'`, `'./core/QueryBuilder.js'` all resolved; confirmed `FirestoreDocument` (`QueryBuilder.ts:4`) and `DeepPartial` (`:12`) are **already imported** at the insertion site (E2, E3) | resolved; §6 adds **no new import** |
| Declaration emit (new public type) | `probes/05-declaration-emit.cjs` — `declaration: true, emitDeclarationOnly: true` over §6.1 alone | **5/5 PASS.** 0 emit diagnostics; the `.d.ts` imports only the three local modules; **no `@google-cloud/firestore`, no `firebase-admin`** specifier; `ReadOnlyQueryClauseKeys` emitted locally (V8, and the basis for T5) |
| Prettier | `npx prettier --parser typescript --config .prettierrc --check` on §6.1 | "All matched files use Prettier code style!" (V9) |
| Interface-vs-alias decision | `checker.typeToString` on both forms | alias ≈ 3 000 chars per mention; interface prints `ReadOnlyQuery<…>` (V7) → D1 |
| Guards actually fire | `probes/04-mutations.cjs` — four in-memory mutations of probe 03, each with an asserted expectation | **ALL 5 EXPECTATIONS HOLD, exit 0.** Bare `Missing` → **0 diagnostics** while resolving to `"orderById"`; asserted → TS2344; leaked return type → TS2344 + 3× TS2578 + TS2322 with the key guards still `never`; dropped clause key → TS2430 |
| Probes re-runnable on a clean clone | ran the exact §0.4 command block from the repo root on this branch | `01`/`02`/`03` → `DIAGNOSTICS (0)`; `04` → all 5 hold; `05` → 5 PASS. The harness resolves `typescript` from the repo's own `node_modules`, so nothing needs installing |
| Baseline suite counts | `npm run test:unit`; `npm run test:integration:emulator` (both green) | unit **35 / 455**; integration **37 / 548** |
| Gate headroom (§8 claims gate-safe) | parsed `coverage/{unit,integration}/lcov.info` against `scripts/check-coverage-gates.mjs` | integration `QueryBuilder.ts` +6.39 / +11.50 / +5.00; unit `index.ts` **+0.00 / +0.00** / +10.76 (C1–C3) |
| Every §9 / §10 shell command | ran each: the `#41)` ADR grep (10 footers, all `(#41)`); the README grep (3 unrelated hits, none about the facade); the website caveat greps (`terminating helpers` → `patterns.md:505,545,557`; `Omit<FirestoreQueryBuilder` → `patterns.md:547,552`); `npx eslint src/tests/types/` (exit 0 — so type tests **are** linted, not ignored) | recorded above, each with the expected post-change result |
| Baseline still current at handoff | `git log --oneline -3 main`; `git diff --stat 05c02cf..b999f40 -- src/ website/ docs/adr/ scripts/ package.json` | `main` advanced to `b999f40` during planning (#106 merged). Diff **empty** ⇒ every §3 fact and line number holds. `check:zod-idioms` now exists on the baseline, so it is leg 14 of the 15 in §10, not a §5 carve-out. |
| Unresolved conditionals | re-read §§2–9 | none. Collection-group scope resolved by P2 and `VectorQueryBuilder` by P3; the `/vector` re-export resolved by reading `withVectorSearch.ts:25–26, :52`; type-test linting resolved by running eslint; the `check:zod-idioms` question resolved by the row above. |
| Not verified | — | §5.1 `check:consumer` peer fan-out, §5.2 the real `test:types` invocation, §5.3 `docs:build`, §5.4 strict-pnpm resolution |

---

## Appendix — probe inventory

All five run clean on the baseline. Two are **self-checking** (non-zero exit on failure), so they
are worth re-running after implementation rather than only reading.

| Probe | Proves | Kind |
| --- | --- | --- |
| `probes/harness.cjs` | the runner. Mounts a probe as a virtual `src/__probe_ff__.ts` over `tsconfig.typecheck.json`'s options and the real module graph — so answers are about the program the gate checks, without leaving a deliberately-broken file inside `tsconfig` `include`. Resolves `P_*` aliases via `checker.typeToString` (union constituents sorted for diff-stability), lists `M_*` properties, types `p_*` bindings. Exports `compileProbe(source, opts)` for probes 04/05. | CLI + module |
| `probes/01-member-sets.ts` | **P1–P4** — the three builders' `keyof` sets; that only the single-collection builder has write terminals; and the 33-vs-60 public/protected gap that makes `keyof` (not `getPropertiesOfType`) the right question | prints |
| `probes/02-parameters-collapse.ts` | **N1–N5** — what `Parameters` / `ReturnType` do to overloads and generics, i.e. why ADR-0041 decision 3 cannot be applied to the terminals; plus the single-signature members where deriving *is* exact | prints |
| `probes/03-readonly-query.ts` | **V1–V6, V9** — §6.1 **verbatim** plus every §8.1 assertion, against a real `withSchema` repo and a W ≠ T repo. Keep it byte-identical to §6.1: it is the evidence §6 compiles as written | prints (0 diagnostics ⇒ pass) |
| `probes/04-mutations.cjs` | **M1, M1′, M2, M2′, M3** — mutates probe 03 four ways in memory and asserts each guard fires; anchors its own string replacements and throws if probe 03 drifts | **self-checking** |
| `probes/05-declaration-emit.cjs` | **V8** — declaration-only emit of §6.1 alone; asserts no `@google-cloud/firestore` / `firebase-admin` specifier reaches the `.d.ts`, and that `ReadOnlyQueryClauseKeys` is emitted locally (hence trap T5) | **self-checking** |
