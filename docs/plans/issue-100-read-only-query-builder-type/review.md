<!-- External reviewer report. The implementer dispositions every finding id in notes.md and never edits this file. -->

# Issue #100 — implementation review

**Reviewer:** Claude Code (Opus 5, 1M context), `implementation-review` skill · **Round:** 1 ·
**Reviewed:** `2b6cf63` (`feat(query): export ReadOnlyQuery so fluent chains cannot leak write terminals`) ·
**Branch:** `feat/issue-100-read-only-query` · **Plan:** `PLAN.md` @ baseline `b999f40` ·
**Tree:** unchanged by this review — `git status --porcelain` empty and `git diff HEAD` empty after
every mutation and probe was reverted; `src/core/QueryBuilder.ts` md5 back to
`19b4fd124ab505c0f26c6de41f81c81a`, and the temporary git worktree at `/tmp/ff100-base` was removed.

**Verdict: APPROVE WITH FIXES** — the implementation is correct, the full 15-leg gate is green on the
tree as committed, and the three top traps are genuinely pinned. What remains is **M1**: trap T5's
stated guard (`build` + `check:package` + `check:consumer`) does **not** fire — I broke it on purpose
and all three stayed green — so after the plan directory is deleted nothing in CI guards it. Add the
~14-line `ReadOnlyQuery` block to `scripts/check-packed-consumer.mjs` (I proved it goes red on the
break and green on the control) plus one JSDoc line, then re-run `build && check:package && check:consumer`.

> **Note on the notes:** `notes.md` § Status says "Not committed (owner decides)". The work **is**
> committed — `2b6cf63`, which includes `notes.md` itself. Everything below was verified against that
> commit.

---

## What I ran

Every claim below traces to a row here. I ran the 15 legs as **15 separate commands with an exit code
captured per leg** (not an `&&` chain), so no leg can be short-circuited-and-assumed-passing.

| Check | Command | Result |
| ----- | ------- | ------ |
| Full §10 gate, 15/15 legs | `for leg in …; do npm run $leg; echo "LEG $n EXIT=$?"; done` | **every leg `EXIT=0`**, `OVERALL_FAIL=0`. Legs in order: `test:types` 0 · `lint` 0 · `check:format` 0 · `test:unit` 0 · `test:integration:emulator` 0 · `test:unit:coverage` 0 · `test:coverage:gate:unit` 0 · `test:integration:coverage` 0 · `test:coverage:gate:integration` 0 · `build` 0 · `check:package` 0 · `check:consumer` 0 · `check:docs` 0 · `check:zod-idioms` 0 · `docs:build` 0 |
| Legs skipped by a short circuit | — | **none** — nothing short-circuited, all 15 have their own recorded exit code |
| Suite counts — unit | `npx jest -c jest.config.unit.js` at `2b6cf63^` in a throwaway worktree, then at HEAD | baseline **35 / 455** → after **35 / 456**. Independently measured, not taken from `notes.md` or §3.5 |
| Suite counts — integration | `npm run test:integration:emulator` | **37 / 548**, unchanged — which is what §10 requires ("do not manufacture an integration test to make a number move"). The skill's "both counts must go up" checklist item is **correctly** not satisfied here; see *Deviations* |
| Coverage gate — unit | leg 7's own stdout | `src/index.ts` **100.00 / 100.00 / 75.76** vs `100 / 100 / 65` — identical to §3.5, and the zero-slack lines/branches confirm no value export slipped in |
| Coverage gate — integration | leg 9's own stdout | `src/core/QueryBuilder.ts` **96.57 / 86.44 / 100.00** vs `90 / 75 / 95` |
| Coverage — real baseline | ran `test:integration:coverage` at `2b6cf63^` in the worktree and read LCOV counters directly | baseline `LF 2298 / LH 2215 / BRF 236 / BRH 204 / FNF 63 / FNH 63` → **96.39 / 86.44 / 100.00**. See **N1** |
| Mutation — T1 (`getOne`) | added `'getOne'` to `ReadOnlyQueryClauseKeys` and restated it as `(...a: Parameters<QB['getOne']>): ReturnType<QB['getOne']>` | **exactly 2 diagnostics, both in the F1 test** — `read-only-query.type-test.ts(144,33) TS2322` and `(145,29) TS2344`. Nothing else fired |
| Mutation — T1 (all five siblings) | same, for `getOne`/`stream`/`paginate`/`offsetPaginate`/`paginateWithCount` | **10 diagnostics = exactly one pair per sibling** (L144/145, 147/149, 152/154, 164/166, 178/180). One site per terminal, nothing collateral. F1's fix is load-bearing |
| Mutation — T3 | `where(...): ReadOnlyQuery<…>` → `: FirestoreQueryBuilder<T, W, S, R>` | red at `_c01` (`read-only-query.type-test.ts:107` TS2344), plus TS2322 at `:100` (`facadeDefaultedW`) and TS2578 ×3 at `:241/:245/:249` and ×1 at `enforced-denormalization-facade.type-test.ts:132`. Every hit is a distinct *asserted* guard tripping on the same leak — not suite coupling |
| Mutation — T4 | `'where'` → `'wheer'` in `ReadOnlyQueryClauseKeys` | **one** diagnostic: `src/core/QueryBuilder.ts(2357,18) TS2430` |
| Mutation — T2/M1 (my variant) | deleted the `orderById` re-declaration **and** its clause key (the "clean up a redundant re-declaration" slip §4 T4 warns about) | red at `_c05` (`:111` TS2344) + `:100` TS2322 + `:247` TS2578. Caught from the other side than the notes' variant, so both directions are guarded |
| Mutation — T5 | tagged `ReadOnlyQueryClauseKeys` `@internal` | `test:types` **0 errors**, `build` **EXIT=0**, `check:package` **EXIT=0**, `check:consumer` **EXIT=0** (all 7 sub-checks ✓) — while `dist/core/QueryBuilder.d.ts:1257` referenced a type with **no declaration**. See **M1** |
| Mutation — T8 | `## Read-only view` → `## Read-only query view` | `check:docs` **EXIT=1**, **6 broken anchors** named across all five pages + the intra-page link. T8 genuinely guarded |
| Revert verified | `cp` from `/tmp` backups, then `git status --porcelain` + `git diff HEAD` + `md5` + re-run `test:types` / `build` / `check:docs` / `check:consumer` | clean, md5 identical, all green again |
| §10 step 5 — probes | all five, from repo root | `01`/`02`/`03` → `DIAGNOSTICS (0)`; `04` → `ALL 5 EXPECTATIONS HOLD` exit 0; `05` → 5/5 PASS |
| §10 step 6 — built-HTML `:::` | `grep -c ':::'` on the three `website/dist/**/index.html` | `0`, `0`, `0` |
| §10 step 7 — stale caveat | `grep -rn "terminating helpers" … \| grep -v '/2.0/'` | no matches; **grep proved well-formed** by running it at `2b6cf63^`, where it returns exactly the three lines §10 names (`patterns.md:505,545,557`) |
| §10 step 8 — leak text | `grep -rn "Omit<FirestoreQueryBuilder" … \| grep -v '/2.0/'` | one match, `reference/query-builder.md:307` — the intentional anti-pattern callout |
| **Probe (unnamed by the plan)** — is `withVectorSearch(repo).query()` assignable to `ReadOnlyQuery` with no cast? | harness probe R1 (virtual `src/__probe_ff__.ts`, nothing written to the tree) | **0 diagnostics** — the §6.3 comment's rationale holds. Also confirmed for a non-schema `FirestoreRepository<T>` |
| **Probe** — ADR-0041's member-count claims | harness probe R2, `keyof` via `checker.typeToString` | `keyof FirestoreQueryBuilder` **33** · `keyof ReadOnlyQuery` **31** · `keyof FirestoreCollectionGroupQueryBuilder` **31** · `keyof VectorQueryBuilder` **10** · `Extract<…, 'update'\|'delete'>` on both = `never`. Every number in the ADR and in `query-builder.md`'s new section is exact |
| **Probe** — is the terminal-pin set *complete*? | enumerated every declaration in `QueryBuilder.ts` for all 18 inherited terminals | see *Verified and holding* — the 8 lossy terminals are exactly the 8 pinned |
| **Probe** — derived clause params vs a future overload | harness probe R4 | a parameter-equality guard is a **tautology**; a newly inserted overload is silently dropped. See **N2** |

---

## Blockers

None.

---

## Major

### M1 — Trap T5's stated guard does not fire; after the plan directory is deleted, nothing in CI guards it (`src/core/QueryBuilder.ts:2292-2300`, `scripts/check-packed-consumer.mjs:130-138`)

`PLAN.md` §4 T5 says the `@internal` hazard is "Guarded by the §10 `build` + `check:package` +
`check:consumer` legs and by §12's declaration-emit row", and `notes.md` § *Edge cases / traps
handled* records T5 as "Pinned by: `build` / `check:package` / `check:consumer`; emitted `.d.ts`".
I executed that claim and it is false.

**Evidence — the break.** I added `@internal` to the `ReadOnlyQueryClauseKeys` JSDoc and nothing else:

```
test:types      0 errors
build           EXIT=0
check:package   EXIT=0
check:consumer  EXIT=0   (✓ ESM compile, ✓ ESM runtime, ✓ CJS compile, ✓ CJS runtime,
                          ✓ express subpath compile, ✓ express import(), ✓ express require())
```

while the emitted declaration was broken — the `type ReadOnlyQueryClauseKeys = …` line was stripped
by `stripInternal` and the reference survived:

```
$ grep -n "ReadOnlyQueryClauseKeys" dist/core/QueryBuilder.d.ts
1257:export interface ReadOnlyQuery<…> extends Omit<FirestoreQueryBuilder<T, W, S, R>, 'update' | 'delete' | ReadOnlyQueryClauseKeys> {
```

(one match, not two — the declaration at `:1227` in the good build is gone.) `check:consumer` cannot
see this because it uses `skipLibCheck: true` on purpose (`scripts/check-packed-consumer.mjs:6-7,
109-111`) and **never names `ReadOnlyQuery`** — `grep -n ReadOnlyQuery scripts/check-packed-consumer.mjs`
returns nothing.

The only thing that actually catches it is `probes/05-declaration-emit.cjs`, which §11's last item
deletes: *"After review: `git rm -r docs/plans/issue-100-read-only-query-builder-type/`"*. That also
contradicts `docs/plans/README.md`, which says self-checking assertion probes must be **promoted to
committed tests, not left here to be deleted** — probe 05 is exactly that kind of probe.

**Failure scenario.** A maintainer tidying `QueryBuilder.ts` in six months tags
`ReadOnlyQueryClauseKeys` `@internal` — a natural move for a non-exported helper, and the JSDoc above
it warns only against *deriving it from `keyof`*, never against `@internal`/`stripInternal`. The full
15-leg gate stays green. The published `.d.ts` ships a dangling type reference; for a consumer,
`Omit<…, 'update' | 'delete' | ReadOnlyQueryClauseKeys>` resolves with the third operand errored, so
`'update' extends keyof ReadOnlyQuery<X>` becomes **true** again — the exact leak #100 exists to
close, reintroduced in the published artifact only, invisible to this repo's CI.

**What closes it.** Two small, independent edits:

1. **`scripts/check-packed-consumer.mjs`** — add a `ReadOnlyQuery` block beside the existing issue-#37
   `QueryExplainResult` block at `:130-138`, which is the exact same dual-entry re-export shape. I
   verified this closes it: with the block added and `@internal` applied, `check:consumer` went
   **red** — `consumer.ts(28,7): error TS2322: Type 'true' is not assignable to type 'never'` (the
   `keyof`-has-no-`update` assert) plus the same at `(32,7)` (the post-`.where()` assert). **Control:**
   I then reverted `@internal`, rebuilt, and re-ran with the block still in place — all seven
   sub-checks green. So the red is caused by the break, not by the block. The block I proved out:

   ```js
   `import type { ReadOnlyQuery } from '${PKG}';\n` +
   `import type { ReadOnlyQuery as VectorReadOnlyQuery } from '${PKG}/vector';\n` +
   `type _ROSame = ReadOnlyQuery<{ n: number }> extends VectorReadOnlyQuery<{ n: number }>\n` +
   `  ? VectorReadOnlyQuery<{ n: number }> extends ReadOnlyQuery<{ n: number }> ? true : never\n` +
   `  : never;\n` +
   `const _roSame: _ROSame = true;\nvoid _roSame;\n` +
   `type _RONoWrites = 'update' extends keyof ReadOnlyQuery<{ n: number }> ? never\n` +
   `  : 'delete' extends keyof ReadOnlyQuery<{ n: number }> ? never : true;\n` +
   `const _roNoWrites: _RONoWrites = true;\nvoid _roNoWrites;\n` +
   `type _ROChain = ReturnType<ReadOnlyQuery<{ n: number }>['where']>;\n` +
   `type _ROChainNoWrites = 'update' extends keyof _ROChain ? never : true;\n` +
   `const _roChainOk: _ROChainNoWrites = true;\nvoid _roChainOk;\n` +
   ```

   It covers T5 **and** the `/vector` export-map claim §6.3 rests on, which `test:types` cannot reach
   (T-12 imports the source barrel, not the packed subpath).
2. **`src/core/QueryBuilder.ts`** — one line in the `ReadOnlyQueryClauseKeys` JSDoc: *"Do not tag
   `@internal` — `tsconfig` sets `stripInternal: true`, which would strip this declaration and leave a
   dangling reference in the published `.d.ts` (trap T5)."* The existing comment warns about the wrong
   mistake.

Re-run after: `npm run build && npm run check:package && npm run check:consumer`.

**Severity note.** I am calling this Major, not a Blocker: nothing currently ships wrong, the code in
`2b6cf63` is correct, and the gate is green. It is Major rather than Minor because the plan and
`notes.md` both record T5 as guarded when it measurably is not, and because the one real guard is
scheduled for deletion — so merging as-is silently drops the protection. If you would rather not grow
`check:packed-consumer` in this PR, deferring to its own issue is defensible; leaving it recorded as
"pinned" is not.

---

## Minor / nits

- **N1 — the §11 row "coverage identical to §3.5" is recorded PASS but the line figure did move, and
  `notes.md` deviation 4's explanation is right for branches and wrong for lines** (`PLAN.md:204`,
  `PLAN.md:784`, `notes.md` § *Deviations* item 4). I measured the real baseline by running
  `test:integration:coverage` at `2b6cf63^` in a throwaway worktree and reading the LCOV counters:

  | | LF | LH | lines | BRF | BRH | branches | FNF/FNH |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | `2b6cf63^` | 2298 | 2215 | **96.39%** | 236 | 204 | **86.44%** | 63 / 63 |
  | `2b6cf63` | 2420 | 2337 | **96.57%** | 236 | 204 | **86.44%** | 63 / 63 |

  So §3.5's **line** figure (96.39) was *correct*, not stale — the number genuinely moved because all
  122 added type-only lines land in LCOV as covered lines (`LF +122`, `LH +122`). Only §3.5's
  **branch** figure (86.50) was wrong; the real baseline is 86.44, byte-identical to HEAD.
  **Failure scenario:** the next implementer of a type-only change reads `notes.md` and concludes the
  on-disk LCOV baseline is simply unreliable, so they stop treating line-coverage drift as a signal —
  when the actual invariant is available and sharp. **What closes it:** correct deviation 4 to say
  what it is — line % moves on a type-only insert because LF/LH both rise by the inserted line count;
  the reliable "did runtime slip in?" invariant is `FNF/FNH` (63/63) and `BRF/BRH` (236/204)
  unchanged, both of which hold exactly. No code change.

- **N2 — "drift-proof" over-claims what a derived clause parameter list guarantees**
  (`src/core/QueryBuilder.ts:2377-2379`, echoed in ADR-0041 decision 3). The comment above the four
  bound members says deriving "is lossless here and keeps them drift-proof". It is drift-proof against
  a *change* to an existing signature, but not against a *newly added overload*. Probe R4 (0
  diagnostics, so both expectations held): a parameter-equality assertion is a **tautology** —
  `Parameters<RO['where']>` is *defined as* `Parameters<QB['where']>`, so no pre-written guard can
  catch this — while `qbLater.where({ kind: 'composite' })` compiles and `roLater.where({ kind:
  'composite' })` is an error. **Failure scenario:** someone adds `where(filter: Filter): this` as a
  new overload *before* the existing 3-arg signature on `FirestoreQueryBuilder`. `Parameters<…>` still
  resolves the last signature, so `ReadOnlyQuery.where` silently keeps only the 3-arg form: T-1/T-2
  stay `never`, T-3 stays `true`, `test:types` stays green, and consumers hit a read-only view that
  rejects a call the concrete builder accepts. (`orderBy` and friends would be caught loudly *only*
  because existing tests call the current form; an *added* overload never is.) **What closes it:**
  amend that comment and ADR-0041 decision 3 to state the standing obligation — *adding an overload to
  a chainable clause requires hand-writing that clause on `ReadOnlyQuery`, the way `whereId` already
  is.* Documentation only; do not add a parameter-equality assert, it asserts nothing.

- **N3 — `notes.md` § Status says "Not committed (owner decides)"** while the work is committed as
  `2b6cf63` (the notes file included). Stale by one step; refresh it when dispositioning.

- **N4 — `packageExports.unit.test.ts:76-83` is near-tautological** and worth knowing as such:
  `ReadOnlyQuery` is an `interface`, so a value export of that name cannot compile in the first place,
  which means the assert can only ever fire for a *different* runtime binding that happens to share
  the name. Not a defect — it matches the file's existing house pattern for `WriteMetadata` /
  `WriteResultWithMetadata` immediately above, §8.2 mandated it, and it is what moves the unit count
  455 → 456. Flagged only so nobody mistakes it for the load-bearing guard; the real one is T-11 in
  the type test.

---

## Verified and holding

Do not re-check these.

- **The clause-key list is exactly right, from source.** Every public member of
  `FirestoreQueryBuilder` whose declared return type is `this`: `where:656`, `orderBy:690`,
  `limit:723`, `startAt:752-754`, `startAfter:765-767`, `endAt:776-778`, `endBefore:787-789`,
  `offset:806`, `limitToLast:829`, `whereFilter:1997`, `whereId:2068-2070`, `orderById:2093` — twelve,
  plus `select:2024` (the one member returning a re-parameterized builder). That is exactly the 13
  entries of `ReadOnlyQueryClauseKeys` (`src/core/QueryBuilder.ts:2303-2316`). `applyCompositeFilter:483`
  is `protected`, so `keyof` never sees it. No fourteenth candidate exists:
  `grep -n "): FirestoreQueryBuilder"` finds only `select` at `:2026`.
- **The terminal-pin set is complete — this goes past what §8.3 named.** §8.3 named five siblings; I
  enumerated all 18 inherited terminals and classified each by whether `Parameters`/`ReturnType` would
  actually lose anything. Overloaded: `get:1697-1699`, `getOne:1069-1071`, `stream:1430-1432`,
  `paginate:894-904`, `offsetPaginate:980-996`, `paginateWithCount:1620-1635`. Generic: `aggregate:1239`
  (`Spec`), `distinctValues:1380` (`K`). That is **8 lossy terminals**, and all 8 are pinned — T-5 +
  `metadataOverloadsSurviveOmitOnSiblingTerminals` + T-6 + T-7. The remaining ten (`count:858`,
  `exists:1109`, `sum:1141`, `average:1177`, `onSnapshot:1480`, `onSnapshotDetailed:1549`,
  `explain:1733`, `explainStream:1797`, `collectionCount:2112`, `getUnderlyingQuery:1661`) are
  single-signature and non-generic, so restating them would be genuinely lossless and their absence
  from the pin set is correct, not a gap.
- **`/vector` is not just nameable — it is assignable.** The §6.3 comment claims a facade over a
  vector-enabled repository needs the type from that specifier. `VectorEnabledRepository` is
  `FirestoreRepository<T,W,S,WO> & { vectorQuery() }` (`src/vector/withVectorSearch.ts:18-20`), and
  probe R1 confirms `withVectorSearch(repo).query()` returns something assignable to
  `ReadOnlyQuery<T>` with **no cast** (0 diagnostics). Nothing in the committed tests asserts this;
  it holds anyway.
- **Every number in ADR-0041's new "Collection-group and vector builders need nothing" paragraph and
  in `query-builder.md`'s new section is exact** (probe R2): CG = 31 public members, `VectorQueryBuilder`
  = 10, and `Extract<keyof …, 'update' | 'delete'>` is `never` on both. `grep -nE "^\s+(async )?(update|delete)\s*\("
  src/vector/VectorQueryBuilder.ts` → no matches.
- **No write path escapes through an inherited member.** `keyof ReadOnlyQuery` is 31 names with no
  `update`/`delete` (probe R2), and the one escape-hatch-shaped member, `getUnderlyingQuery()`,
  is declared `Query<any, DocumentData>` — the native Firestore `Query`, which has no write methods
  (`add`/`doc`/`set` live on `CollectionReference`). `getQueryRef` is package-internal: it appears in
  neither `src/index.ts` nor `src/vector/index.ts`.
- **T8's guard is real, not assumed.** Renaming the heading to `## Read-only query view` turns
  `check:docs` red with all six link sites named (`patterns.md:554`, `security-boundary.md:74`,
  `queries.md:314`, `queries.md:484`, `query-builder.md:19`, `types.md:176`).
- **The facade type-test genuinely pins the guide.** `enforced-denormalization-facade.type-test.ts`
  mirrors `patterns.md` member-for-member and in order (`getById`, `query`, `countByStatus`) and shares
  its import line, `import type { DataOf, ID, ReadOnlyQuery, UpdateInput }`. §9.5's "remove the
  now-unused `@ts-expect-error` on `orders.query()`" was done, and its JSDoc count is now **accurate**
  at 14 directives (12 facade + 2 chain) — it was already off by one at `2b6cf63^`, where the function
  had 13 and the comment said twelve. The `omitNarrowingLeakIsReal` guard was correctly re-purposed
  from "will start failing when ADR-0041 lands" to "must keep passing — it documents the anti-pattern".
- **No stale prose survives anywhere in the v3 tree**, not just on the three pages §10 step 7 names:
  `grep -rniE "no builder escapes|builder is not exposed|does not hand back|not expose the (query )?builder|let no builder"`
  over `website/src/content/docs/` minus `/2.0/` → no matches. `ReadOnlyQuery` appears on exactly the
  five pages §9.2/§9.3 prescribe.
- **§9.4's forbidden edits were all respected** — `git show --stat 2b6cf63` touches no `README.md`, no
  `npm-readme.md`, no `CHANGELOG.md`, no `docs/2.0/**`, no `scope-and-capabilities.md`, no ADR-0017.
- **Deviations from the plan — each judged:**
  - **§8.4 restore via `/tmp` backup instead of `git checkout -- src/` — right.** The tree was dirty;
    `git checkout` would have discarded the implementation. I used the same technique and verified the
    revert by md5 rather than by trust.
  - **§6.1 not character-verbatim (prettier wrapped `orderBy`, `orderById`, `startAt`, `startAfter`,
    `limitToLast`, `endBefore`) — right.** `check:format` is leg 3 and would fail on the unwrapped
    form; I read the wrapped block at `src/core/QueryBuilder.ts:2318-2412` and it is semantically
    identical to §6.1. Prettier-clean beats character-verbatim; the plan's wording is the thing that
    was slightly wrong.
  - **T-5 siblings expanded beyond the minimal §8.1 table (F1) — right, and load-bearing.** My
    mutations show each of the five is pinned at its own site and nothing else fires. Without this the
    plan's #1 trap was five-sixths unguarded. Do not trim it back.
  - **Integration count left at 548 — right.** §10 forbids manufacturing an emulator test for a
    type-only change, so the generic "both suites must grow" expectation should not be applied here.
  - **Fresh LCOV vs §3.5 (deviation 4) — conclusion right, reasoning partly wrong.** See **N1**.

---

## Not defects

- **`Parameters<RO['startAt']>` resolving to `unknown[]`** while the concrete builder declares
  `startAt(snapshot: DocumentSnapshot)` / `startAt(...fieldValues: unknown[])`. Probe R3 confirms both
  sides resolve to `unknown[]`, so callers see no difference — the §6.1 comment's "deriving is lossless
  here" is accurate for today's overload sets. (The forward-looking caveat is **N2**, not this.)
- **`ReadOnlyQuery` being defeatable by a cast.** Stated three times — §6.1 `@remarks`,
  `query-builder.md:314`, `types.md:172` — and ADR-0041 decision 5 rejects a runtime `Proxy`
  deliberately. Working as designed.
- **`W` unreferenced by any member.** It is a documented phantom (ADR-0041 decision 8, `@template W`);
  T-9's `facadeDefaultedW` pins it, and my T3 mutation tripped it at `:100`, so it is not inert.
- **`ReadOnlyQueryClauseKeys` not being exported.** It is emitted into the `.d.ts` as a local
  declaration (probe 05, and `dist/core/QueryBuilder.d.ts:1227` in the good build), which is what the
  `extends` clause needs. Exporting it is not required — hardening it against `@internal` is **M1**.

---

## What to do next

1. Fix **M1** (both parts) and correct **N1**/**N2**/**N3** — all documentation or test-harness edits,
   none touching `src/core/QueryBuilder.ts` semantics.
2. Re-run the full 15 legs (fixing M1 changes what `check:consumer` compiles, and N2 edits a JSDoc
   block inside `QueryBuilder.ts`, so `check:format` matters too).
3. Disposition **M1, N1, N2, N3, N4** in `notes.md` — fixed / not a defect / deferred-with-issue-link.
   Round 2 will review the deltas plus a fresh gate run only.

**Verdict: APPROVE WITH FIXES.**
