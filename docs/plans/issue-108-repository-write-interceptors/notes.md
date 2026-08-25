# Issue #108 — Implementation notes (for adversarial review)

**Implementer:** Claude Opus 5 (Claude Code session) · **Branch:** `feat/108-write-interceptors` ·
**Plan:** `docs/plans/issue-108-repository-write-interceptors/PLAN.md` · **Baseline:** `main` @
`42314e8` — **unchanged**, so no rebase was needed and **every §3 `file:line` was still accurate**
(verified: `git merge-base HEAD origin/main` → `42314e8434ba…`, and `prototype.patch` applied with
`git apply` cleanly on the first try).

## Read this first

This document grew through three rounds — implementation, an independent adversarial review, and two
rounds of owner review — so it is long. If you are reviewing the code rather than the process, the
five things worth your attention are:

1. **`commitInChunks` records before it chunks** (`src/core/FirestoreRepository.ts:4896`). An
   interceptor's write phase may stage zero, one, or many writes, so every group is resolved to its
   real physical operation list *before* any commit. The plan's own formula for this was wrong; see
   finding **F1**, which is the most important thing in this file.
2. **The writer surface mirrors the repository's verbs** — `createWithId` / `set` / `update` /
   `patch` / `delete` (`:4506`). `set` is the deliberate exception and the reasoning is in
   deviation 19.
3. **`set` takes the COMPLETE write model**, including under `{ merge: true }` (`:4530`). An earlier
   revision typed the merge branch as a partial update; that was unsound — see finding **F3**.
4. **Every bulk path refuses read-capable interceptors as its first statement** (`:4710`), ahead of
   its pre-read and its hooks — deviation 16.
5. **The trap table** (§4 of the plan) maps each trap to the test that pins it, and the **mutation
   checks** table records what each test fails against. Two tests in the original plan guarded
   nothing until mutation-checking exposed them.

Sections in order: what shipped → decisions I made → deviations → files → traps → tests → mutation
checks → gate → anti-instructions → §11 audit → the adversarial review and its dispositions →
could-not-verify → owner Q&A. Deviations 15–19 and findings F1/F3 are the post-review changes; the
rest is the first pass.

## Status

**Done, reviewed, all owner questions ruled, and committed.** All eight ADR-0040 decisions ship: the
registration API, mode-by-inference, the one shared writer/reader surface, every cell of the §2.1
coverage matrix (run, join, chunked batch, or refuse), group-aware `commitInChunks`, the
`withMetadata` throw, the per-repository mode union, and additivity. Plus the ADR flip, five docs
pages, and four new test suites (two type, one unit, one integration).

Nothing from §2's out-of-scope list was folded in.

**What changed after the first pass**, so you are not reading stale reasoning as current:

| Round | Outcome |
| ----- | ------- |
| My own pre-review pass | Deviations 8–14: found `writer.*` members no test executed, two published doc snippets that did not compile, `select().update()` as an unenumerated write path, and the clone rules untested in the negative direction |
| Independent adversarial review | 8 findings, all fixed. **F1 was a blocker** — `commitInChunks` counted interceptor *closures* rather than the writes they stage, silently reintroducing traps T3 and T4 |
| Owner review, round 1 | Q1–Q5 ruled (deviations 16–18): early refusal guards, nested-transaction issue #112, one commit |
| Owner review, round 2 | **F3's fix was wrong and is reverted** (a partial payload cannot create a valid document), and the writer's vocabulary was realigned to the repository's (deviation 19) |
| External review, round 1 | APPROVE WITH FIXES — 1 Major (**M1**: a merge write reaches the interceptor dot-path normalized, undocumented and unpinned) and 5 Minors, all fixed. See "External review — round 1 dispositions" |

Committed as a single commit on `feat/108-write-interceptors`; the tree is clean and the plan
directory stays in place so this file and `PLAN.md` are readable in the PR diff.

## Ambiguities resolved

- **§5.4 — `set` on the restricted writer (flagged for explicit review).** The plan added `set`
  beyond ADR-0040 Decision 1's literal `create`/`update`/`delete`, and said the owner had **not**
  ruled on it. I **kept** it, and it is load-bearing in practice: `writer.update` on a sibling that
  does not exist yet fails the whole batch, which is exactly the counter / audit-row case the ADR
  motivates. It is additive and cheap to drop (delete the `set` member from `InterceptorWriter` and
  its implementation at `src/core/FirestoreRepository.ts:4530`, plus the tests that use it). Recorded
  as an amendment blockquote on ADR-0040 Decision 1 so it is a decision, not an accident. **Owner
  ruled: keep it**, on the grounds that `bulkWrite` already exposes the same `'set'` verb — so this
  is not a new escape of a raw Firestore primitive past the CRUD facade.
- **§5.5 — interceptor ordering and composition.** Left at "registration order, sequential, fail
  fast", matching `runHooks`. Now **documented** (`registerWriteInterceptor` JSDoc, `patterns.md`
  §1, `repository.md`, and an ADR-0040 Decision 1 amendment) and **pinned by tests** (I-15, and the
  unit "keeps registration order" case), so it is a contract rather than an accident.
- **Where the transaction-mode refusal for bulk paths lives.** §6.2 invariant 1 puts it inside
  `commitInChunks`, which means a bulk call's `beforeBulk*` hooks fire **before** the refusal throws.
  I kept the plan's design (one check covering all six paths) rather than adding six early guards.
  Observable consequence: a refused `bulkDelete` under transaction mode still runs its existence
  pre-read and `beforeBulkDelete`. Nothing is written (I-13 asserts that). Flagged here because it is
  a real, if minor, ordering choice the plan did not spell out.
- **The `InterceptedWrite` kind for `upsert`.** Each branch reports the write it actually performed —
  `'create'` on the create branch, `'update'` through `runUpdate` on the update branch. I-1 asserts
  both separately.
- **`InterceptorReader.get`'s implementation return type** is annotated `Promise<any>`: the member is
  generic over the *target* repository's read model, which the implementation cannot name. Callers
  still get `FirestoreDocument<TT> | null` from the interface (asserted by TT-3). Body otherwise
  mirrors `getInTransaction`.

## Deviations from the plan

1. **One commit, not §7's two.** §7 names an intermediate `refactor(repository): make
   commitInChunks group-aware (#108)` ahead of the feature commit. **Owner ruled one commit**, and by
   then the refactor was no longer separable anyway: F1 rewrote `commitInChunks` into
   record-then-chunk, so a faithful split would have had to ship the prototype's known-broken version
   in commit one and fix it in commit two. The plan directory in the diff carries the narrative
   instead, which is what it is for.

2. **§8.4's I-8 test design could not detect the bug it exists to catch. Redesigned.** The plan
   specifies "1 interceptor (group size 2) and **260 documents**". I implemented that verbatim, then
   the mutation check exposed it: **with a uniform group size that divides 500, a chunk boundary can
   never fall inside a group**, so the naive port T4 warns about is *accidentally correct* and the
   test passes either way. Group size 2 → the counter only ever takes even values → it reaches 500
   exactly at a group boundary.
   Redesigned to **2 interceptors (group size 3) and 200 documents**: position 499 then lands on a
   group's *first* interceptor write, so the naive loop commits with that group half-staged and its
   second sibling lands in the next chunk. Verified by mutation both ways — the faithful naive port
   **passes** the plan's version and **fails** mine
   (`src/tests/integration/repository-write-interceptors.integration.test.ts:620`, with the reason
   written into the test as a comment so nobody "simplifies" it back).

3. **§6.4's three-branch shape is factored into one private helper, not inlined five times.**
   `runInterceptedWrite(intercepted, operation, options, direct, stage)` at
   `src/core/FirestoreRepository.ts:4787` implements exactly §6.4's `none` / `batch` / `transaction`
   branches once; each of R2.1–R2.5 passes its own domain closure and `InterceptedWrite`. Reason:
   §6.4's literal shape is ~25 lines × 5 sites of identical control flow, and §3.6 warns that
   **functions** is the binding coverage metric. Semantics per site are unchanged — the `none` branch
   calls a closure over exactly today's `docRef.*` call. §7's anti-instruction forbids extracting a
   new **module** (both coverage gates would miss it); this is a private method in
   `FirestoreRepository.ts`, which the integration gate owns.
   Same reasoning for `stageInterceptedWrite` at `:4835`, shared by R3.1–R3.4, which additionally
   makes the reads-before-writes ordering (T9) structural instead of repeated at four call sites.

4. **§6.7 was already done by `prototype.patch`.** The patch includes the
   `'registerWriteInterceptor'` line in the `NonWrite` union
   (`src/tests/types/write-override-warning.type-test.ts:67`), so §7 step 9 was a verification, not
   an edit. The plan describes it as "to write".

5. **Removed dead scaffolding the prototype shipped.** `prototype.patch` left `if (false as boolean)
   { … }` where the old post-increment chunk commit used to be — unreachable code that would have
   counted as uncovered lines. Deleted, and the surrounding JSDoc rewritten (the old text described
   `actions`, not groups).

6. **The `commitInChunks` transaction-refusal message now names the forcing interceptors**, not just
   the operation — now in `assertNoReadCapableInterceptor` (`src/core/FirestoreRepository.ts:4710`). §6.2 invariant 1 only required the
   operation name; naming the read-capable interceptors matches D3's "long, actionable message" and
   the sibling guards. Additive to the invariant, asserted by U-6 and I-13.

7. **`FirestoreQueryBuilder` gained an optional trailing ctor param, rather than a signature
   reorder.** `query()` cannot reach the repository's private `collectInterceptorWrites` through the
   existing bound `FirestoreWriteBatch` (which §6.2 pins to `(groups, operation)`), so the collector
   is passed separately as `collectInterceptorWrites?` at `src/core/QueryBuilder.ts:1899` — appended
   **after** `allowLegacyDatastoreIds` so every existing positional construction (including ten
   unit-test call sites) keeps its meaning. `select()` forwards it, alongside the Q3 guard added later
   at `:1900`. Cost: the two `?? []`
   fallbacks are unreachable from `repo.query()`, so they show as 2 uncovered branches in
   `QueryBuilder.ts` (branches 85.89% vs a 75% threshold — the only reason its branch number moved).

8. **Added seven tests beyond §8's list, covering the writer surface.** After the first green
   coverage run I checked the LCOV per-function data rather than just the gate verdict, and found
   `writer.create`, `writer.update` and `writer.delete` were **never executed by any test** — the
   gate passed anyway (functions 92.17% vs 85%). Those members carry real logic (merge
   normalization, sanitization, empty-payload rejection, id validation). Added a
   "writer surface" block (`…integration.test.ts:930`). Now the only uncovered functions in
   `FirestoreRepository.ts` are the **6 that were already uncovered at baseline**.

9. **Two published doc examples did not compile. Fixed, and now gated.** Nothing in the repo compiles
   a documentation code block — which is exactly how the *previous* enforced-denormalization guide
   shipped a snippet that did not type-check (the reason
   `src/tests/types/enforced-denormalization-facade.type-test.ts` exists). I copied my own snippets
   into a scratch type-test and both failed: `write.data.userId` is
   `string | FieldValue | undefined` on the `'update'` branch, because an update payload carries only
   the fields being written. Rather than paper over it, the guide now **teaches** that constraint
   (branch per `kind`, and the read-capable example as the way to fill the gap). Added
   **`src/tests/types/write-interceptor-examples.type-test.ts`**, holding all three published
   snippets **byte-identically** (verified with `diff`) plus the four documented call sites.

10. **`select().update()` was an unenumerated write path.** §3.5 lists `query().update()` (R1.6) but
    not the projected builder. `update()` has **no** `hasSelect` guard (only `delete()` does, at
    `QueryBuilder.ts:2275`), so `select().update()` is a real write terminal — and `select()` builds a
    **replacement** builder, so without forwarding the collector every interceptor would be silently
    skipped there. Forwarded by `select()`, pinned by a test, and mutation-checked
    (replacing the forwarded value with `undefined` fails the test).

11. **`upsert`'s `withMetadata` refusal named the wrong method, existence-dependently.** Both branches
    route through different sites, so the message said `upsert()` when the document was absent and
    `update()` when it was present — for the same call. §6.4's table assigns `'update()'` to R2.3, so
    this is a deliberate deviation: `runUpdate` now takes an explicit `operation` label
    (`FirestoreRepository.ts:2922`), `upsert` passes `'upsert()'`, and `update`/`patch` pass
    `'update()'` (accurate — `patch`'s documented contract *is* `update(id, data, { merge: true })`).
    Both branches are asserted in I-10.

12. **Pinned the empty / no-op input boundaries** rather than leaving them accidental: `bulkWrite([])`
    **throws** (the guard is the method's first statement, ahead of the empty short-circuit — an
    interceptor plus `bulkWrite` is a configuration error at any input size); an empty `bulkCreate`
    **throws** under transaction mode (it has no short-circuit, so it reaches `commitInChunks`); but
    `bulkDelete([])` and a zero-match `query().delete()` resolve normally, because they short-circuit
    before `commitInChunks` and a call that writes nothing bypasses nothing. The asymmetry is now a
    tested decision.

13. **Pinned `WriteOutcomeError`'s new accounting end-to-end.** §6.2 invariant 4 says
    `committedWrites`/`totalWrites` count **physical** writes, but nothing tested it: with one
    interceptor and 260 documents a partial failure reports `committedWrites: 500` /
    `totalWrites: 520`, not 250 / 260. Asserted by a unit test that rejects the second chunk's commit.

    > **Superseded in part by F1 (reviewer N5).** This deviation originally also claimed that a
    > `WriteOutcomeError`'s `cause` could be the caller's own interceptor error, because interceptors
    > ran during staging. F1's record-then-chunk rewrite put the recording loop **outside** the `try`
    > (`src/core/FirestoreRepository.ts:4937`, `try` opens at `:4973`), so an interceptor throw now
    > propagates unwrapped and nothing commits — which is what the suite asserts
    > (`repository-write-interceptors.integration.test.ts`, `expect(error).not.toBeInstanceOf(WriteOutcomeError)`).
    > The shipped docs already describe the current behavior; only this paragraph was stale.
    Note `phase` stays `'commit'` even when the failure was in staging. Widening the `WriteOutcome`
    union would change a public error contract, which §3.9 keeps unchanged and D3 avoids; the
    `state` (`'partially-committed'`) and the counts are accurate, and `cause` carries the real
    reason.

14. **Pinned the clone rules in BOTH directions.** §7's anti-instruction ("do not propagate
    interceptors in `subcollection()` / `withSchema()` / `withSchemaArgs()`") and §3.9's near-miss
    warning were documented and implemented but **untested** — only the positive case (I-5, the
    `runInTransaction` clone) had a test, so an over-eager future change that propagated everywhere
    would have gone unnoticed. Added tests that `subcollection()` does not inherit, that a second
    repository over the *same* collection has its own registration list, and that `runReadOnlyAt`
    inherits the clone via `runInTransaction` without anything being written.

15. **§6.2 invariant 4's literal formula is wrong, and the fix restructures `commitInChunks`.**
    Raised by the adversarial reviewer as **F1 (BLOCKER)** — full write-up in that section. In short:
    the plan specifies `totalWrites` as `groups.reduce((n, g) => n + 1 + g.interceptor.length, 0)`
    and §6.3's collector produces one closure per interceptor, which is correct **only** if every
    interceptor stages exactly one write. Nothing enforces that, and staging zero or several silently
    reintroduces traps T3 and T4. `commitInChunks` now **records** each group's real operation list
    before chunking (`recordStagedWrites`, `src/core/FirestoreRepository.ts:627`), so every count is
    physical. The invariant's *intent* ("`totalWrites` counts physical writes") is preserved exactly;
    its stated implementation is not.

16. **Owner ruling (Q3): the bulk-path refusal moved to an early guard, contradicting §6.2
    invariant 1.** The plan states that the single check inside `commitInChunks` *is* how the whole
    "refuse" row of §2.1 is implemented. In practice that meant a refused `bulkDelete` had already
    run its `db.getAll` existence pre-read and fired `beforeBulkDelete` — a hook that writes an audit
    row or bumps a metric ran for a call that could never proceed. The check is now
    `assertNoReadCapableInterceptor` (`src/core/FirestoreRepository.ts:4710`), called as the **first
    statement** of all six paths: `:2167`, `:2290`, `:3151`, `:3582`, and — through a second bound
    ctor param on the query builder (`QueryBuilder.ts:1900`, forwarded by `select()`) — `:2190` and
    `:2287`. Removed from `commitInChunks` entirely rather than left as an unreachable
    backstop.
    **Bonus consistency win:** the refusal no longer depends on input size. `bulkDelete([])` used to
    resolve to `0` under transaction mode because it short-circuited before reaching
    `commitInChunks`; it now refuses like every other bulk path. The "deliberate asymmetry" I had
    documented and tested is gone. Mutation-checked (`Q3_GUARD`): neutering the guard fails 3 tests.

17. **Owner ruling (Q1): `set` stays; the F3 overload is REMOVED.** Two things came out of the
    follow-up discussion. First, `set` is **not** new public vocabulary: `BulkWriteOperationKind`
    already exposes `'set'`, and `bulkWrite`'s `case 'set'` (`:3870`) has identical semantics — full
    replace, create-model validation. So `writer.set` is the same verb one layer down, not a leak of
    a raw Firestore primitive past the CRUD facade. Second, the overload was unsound; see F3 above.
    Final surface at that point was the planner's original four members with no payload-model flag
    anywhere: `create` / `set` / `update` / `delete`. Deviation 19 then realigned the names.
    The delete-sentinel sub-question is moot as a result: `validateCreateData` already calls
    `assertNoDeleteSentinel`, so a `set` rejects them automatically for exactly the reason `upsert`
    does (ADR-0019 — the sentinel's meaning would depend on whether the sibling existed), and
    `writer.update` still permits them, matching `update`/`patch`. Both halves asserted by an
    integration test; mutation-checked (`Q1_DELETE`).

18. **Owner ruling (Q4): nested transactions documented + tracked.** A `:::caution` block under
    `patterns.md` → "Register a write interceptor" shows the failing shape and points at the
    `*InTransaction` helpers; the real fix (ambient transaction context, or detect-and-throw) is
    [#112](https://github.com/reggieofarrell/flintfire/issues/112).

19. **Owner ruling: the writer's vocabulary now mirrors the repository's.** The follow-up review
    question — "our base CRUD operations have no `set` method but `writer` does, and it's missing
    other methods" — held up. Mapping the writer against the repository surfaced two real mismatches
    and one trap:
    - `writer.create(repo, id, data)` took an **id**, so it was really `createWithId`; `repo.create`
      generates one. **Renamed to `createWithId`.**
    - `writer.update(..., { merge: true })` is exactly `repo.patch` (both run
      `normalizeUpdateDataForMerge` then update). **Split into `writer.patch`**, and `update` lost its
      options object; the two now share one private `stageUpdate` body that differs only in that
      normalization, mirroring how `patch()` is `update(..., { merge: true })` on the repository.
    - `writer.set(..., { merge: true })` *looks* like `repo.upsert` — both take a complete payload and
      create-or-update — but **it is not**: `upsert` calls `runUpdate` with `merge` unset, so on an
      existing document it replaces a nested map wholesale, while a merge-set deep-merges it. Same
      payload, different result. So `set` **keeps the Firestore verb**, which is honest: it is the one
      operation with no repository counterpart, and it is already public vocabulary through
      `BulkWriteOperationKind`'s `'set'`.

    Final surface — four of five members are the repository method of the same name, staged instead
    of executed: `createWithId` / `set` / `update` / `patch` / `delete`, with **no options object on
    any member except `set`'s merge flag**. Pinned by a new type test (**TT-6**) asserting the member
    set exactly, that every member but `set` is a real `keyof FirestoreRepository`, and that `set`
    deliberately is not. Mutation-checked twice: renaming `patch` to `merge` fails `test:types` on
    both TT-6 guards, and dropping `patch`'s normalization fails its integration test.

20. **§9.2's renumbering came with prose edits the plan did not enumerate.** Renumbering the facade to
   §2 makes "use the facade" ambiguous, so the facade intro now says what it is *for* versus an
   interceptor, the subclass section's "until a future write choke point lands" is now past tense,
   and the hooks section's silent-recursive-delete gap notes that an interceptor closes it by being
   loud. The `## Enforced Denormalization` heading text is unchanged, so the TOC anchor at `:29`
   still resolves (verified in the built HTML).

## Files touched and why

| File | Change | Plan reference |
| ---- | ------ | -------------- |
| `src/core/FirestoreRepository.ts` | Types, registration, runner, guards, the two boundary helpers, all 5 single-doc sites, all 4 tx sites, 4 fixed-batch sites, 3 refusals, the tx-clone fix, group-aware `commitInChunks` | §6.1–§6.6, R1–R4, R6 |
| `src/core/QueryBuilder.ts` | `WriteGroup` bound signature, the collector ctor param + `select()` forwarding, both write terminals | R1.5–R1.7, §6.2 |
| `src/index.ts` | Re-exports the **seven** public interceptor types; `StagingTarget`/`WriteGroup` deliberately absent | §6.1 |
| `src/core/writeOverrideWarning.ts` | Redirect half now names `registerWriteInterceptor` first, facade as fallback; two JSDoc `@see`/prose updates | §9.4, B7 |
| `src/tests/types/write-interceptors.type-test.ts` | **new** — TT-1…TT-5 | §8.2 |
| `src/tests/types/write-interceptor-examples.type-test.ts` | **new** — compiles all three published doc snippets verbatim | deviation 9 |
| `src/tests/types/write-override-warning.type-test.ts` | `'registerWriteInterceptor'` in `NonWrite` (came with the patch) | §6.7, T5 |
| `src/tests/unit/writeInterceptors.unit.test.ts` | **new** — U-1…U-6 (20 tests) | §8.3 |
| `src/tests/unit/writeOverrideWarning.unit.test.ts` | Inverted the deliberate `not.toMatch(/interceptor/i)` guard | §9.4 |
| `src/tests/integration/repository-write-interceptors.integration.test.ts` | **new** — I-1…I-15 + the writer surface (45 tests) | §8.4 |
| `docs/adr/0040-repository-write-interceptors.md` | `Proposed` → `Accepted`; 3 amendment blockquotes | §9.1 |
| `docs/adr/README.md` | Row 0040 `Proposed` → `Accepted` (plain, per ADR-0043) | §9.1 |
| `website/…/guides/advanced/patterns.md` | New `### 1. Register a write interceptor`; renumber 1→2, 2→3, 3→4; rewrote `### Choosing` | §9.2, B6 |
| `website/…/reference/repository.md` | New `### Write interceptors`; `suppressWriteOverrideWarning` prose | §9.3 |
| `website/…/guides/concepts/lifecycle-hooks.md` | Recursive deletes now throw; "a hook is not a substitute" aside | §9.3 |
| `website/…/reference/types.md` | Rows for the seven new exported types | §9.3 |
| `website/…/reference/scope-and-capabilities.md` | Row in the **supported** matrix (Deferred table untouched) | §9.3, B4 |

**Deliberately not touched, per §3.9:** `CollectionGroup.ts`, `src/vector/**`, `src/express/`,
`Errors.ts`, `ErrorParser.ts`, both READMEs, all 15 living-index footers, ADR-0017, the
`scope-and-capabilities` "Deferred to v3.x" table, `docs/2.0/`.

## Edge cases / traps handled

| Trap | Handled by | Pinned by |
| ---- | ---------- | --------- |
| **T1** `Pick<WriteBatch,…>` rejects a `Transaction` | `StagingTarget` members return `unknown` (`FirestoreRepository.ts:417`) | **TT-1** — asserts *both* assignments plus a live `@ts-expect-error` that the `Pick` spelling rejects `tx` |
| **T2** internal-marker tag breaks the published `.d.ts` while all 14 legs stay green | No such tag on `StagingTarget`/`WriteGroup` | **Gate leg 15** (declaration emit) — and it **fired**, see "Gate results" |
| **T3** flat receipts desync `withMetadata` | `domainIndices` projection (`:4946`, `:4961`), fed by the recording pass at `:4900` so the indices are **physical** write positions, not interceptor counts (F1) | **U-7** — labelled receipts, the only place identity is observable at all; **I-6**/**I-7** (counts, and cross-chunk identity). See F4 for what I-6 alone cannot prove |
| **T3 (again, via F1)** an interceptor staging 0 or 2+ writes | recording, not counting (`recordStagedWrites`, `:627`) | **U-7** 0-write and 2-write cases; mutation `F1_CLOSURE_COUNT` fails 4 of 5 |
| **T4** a group straddling a chunk boundary | Commit *before* staging a group that would not fit (`:4944`); oversized group throws on the **real** operation count (`:4917`) | **I-8** (redesigned — see deviation 2), **U-4** (3 cases incl. exactly-500), **U-7** (750 ops must not become one batch) |
| **T5** the member partition breaks | `'registerWriteInterceptor'` in `NonWrite`, not `Write`, not `REPOSITORY_WRITE_METHODS`/`BYPASS_PATHS` | the existing `Missing` guard |
| **T6** cross-`Firestore` write reports success and lands nowhere | `assertSameFirestoreInstance` on **all five** writer members and the reader (`:4485`, applied at every member) | **I-11** (writer, reader, and a same-instance control) |
| **T7** a 501-op batch commits on the emulator | I-8 asserts commit **grouping** (timestamps + per-group identity), never an error at 501 | **I-8**, with the reason in a comment |
| **T8** the tx clone silently drops interceptors | `txRepo.interceptors = [...this.interceptors]` (`:5117`) | **I-5** (3 tests) — fails against unfixed `prototype.patch` |
| **T9** reads must precede writes | `write` is `=> void` by type; ordering is structural in `runInterceptedWrite`/`stageInterceptedWrite` | **I-9** (both cases), **I-15** read-order test, **U-1** call-order assertion |
| **T10** `withMetadata` under transaction mode | `assertNoWriteMetadataUnderTransactionMode`, transaction branch **only** — defined at `:4754`, called from `runInterceptedWrite` | **I-10** (throws ×6 / succeeds ×6), **U-5** (names only the read-capable one) |
| **T11** `upsert`'s pre-read stays outside the boundary | Untouched at `:3353`; both branches keep their own hook family | **I-1**/**I-2** assert each branch separately |

## Tests added

| Id | Suite | Asserts | Guards |
| -- | ----- | ------- | ------ |
| TT-1 | types | `StagingTarget` accepts `WriteBatch` **and** `Transaction`; a `Pick` alias rejects `tx` | T1 |
| TT-2 | types | `kind` narrowing: `'delete'`→`document`, `'create'`→`CreateOutput<WO>`, `'update'`→`UpdateInput<W>` | §6.1(3) |
| TT-3 | types | `R` flows `read`→`write.reads` exactly; a write-only ctx has no `reads` | §6.1(4) |
| TT-4 | types | sibling payloads check against the **target** repo's write model (2 live directives) | §6.1(6) |
| TT-5 | types | `StagingTarget`/`WriteGroup` not importable from the root; the seven public ones are | §6.1 |
| U-1 | unit | mode union: none / batch / transaction (write-only registered **first**) | ADR D7 |
| U-2 | unit | nothing registered → `docRef.*` direct, `db.batch`/`runTransaction` never called | ADR D8 |
| U-3 | unit | duplicate `name` refused (same flavour and across flavours) | §6.3 |
| U-4 | unit | oversized group throws naming the op; exactly-500 accepted | T4 |
| U-5 | unit | `withMetadata` throws in tx mode only, naming **only** read-capable interceptors | T10 |
| U-6 | unit | 3 refusals; `bulkWrite` refuses with `{ skipHooks: true }`; all 6 bulk paths refuse in tx mode | §6.5 |
| I-1 | integration | 7 single-doc writes commit the sibling (batch); delete gets the whole document | §2.1 row 1 |
| I-2 | integration | same 7 in tx mode; the read value provably reaches the write phase (revision chain) | §2.1 row 1 |
| I-3 | integration | a throwing interceptor aborts the domain write (batch, tx, and update-unchanged) | ADR D4, P7 |
| I-4 | integration | 5 fixed-batch helpers + `query().update()`/`delete()`; each delete sees **its own** doc | §2.1 row 3 |
| I-5 | integration | `runInTransaction`'s repo runs interceptors, across all 4 `*InTransaction` helpers | T8 |
| I-6 | integration | receipts 1:1 for `bulkCreate`/`bulkCreateWithIds`/`bulkUpdate`/`bulkPatch` | T3 |
| I-7 | integration | `bulkDelete` keeps `writeTimes.length === count` with a missing id in the input | T3 |
| I-8 | integration | 200 docs × group 3 → 2 commits, each group whole | T4, T7 |
| I-9 | integration | no ordering error normally; caller-writes-first surfaces P4's exact message | T9 |
| I-10 | integration | `withMetadata` ×6 throws in tx mode / ×6 succeeds in batch mode | T10 |
| I-11 | integration | foreign writer refused, foreign reader refused, same-instance control passes | T6 |
| I-12 | integration | `bulkWrite` (±`skipHooks`), both recursive deletes refuse; all three work with none registered | §6.5 |
| I-13 | integration | 5 fixed-batch helpers + both query terminals refuse in tx mode; nothing written | §2.1 ⚠️ |
| I-14 | integration | nothing registered → return shapes, hook order, receipts all unchanged | ADR D8 |
| I-15 | integration | registration order; first throw stops the rest; read phases ordered and per-name keyed | §5.5 |
| — | integration | **writer surface**: `create` (+collision aborts group), `update` (+empty-payload refusal), `update({merge})` normalization, `delete`, `set` merge-vs-replace, malformed target id | deviation 8 |
| — | types | **doc-example compile gate** — all three published snippets, byte-identical | deviation 9 |
| TT-6 | types | the writer's member set is exactly `createWithId` / `set` / `update` / `patch` / `delete`; every member but `set` is a real `keyof FirestoreRepository`; `set` deliberately is not | deviation 19 |
| — | integration | `set` requires the **complete** write model — a partial payload is refused at compile time *and* at runtime, and the supported subset write is `update`, which fails on a missing document | **F3** |
| — | integration | `patch()` normalizes a nested object into field paths exactly as `repo.patch` does | deviation 19 |
| — | integration | a refused bulk call fires **no** hooks and performs no pre-read, across all seven paths | deviation 16 |
| — | integration | `select().update()` on a **projected** builder still runs interceptors | deviation 10 |
| — | integration | `returnDoc: true` reads back after the boundary commits, in **both** modes | — |
| — | integration | empty / no-op inputs: which refuse and which resolve | deviation 12 |
| — | integration | `WriteOutcomeError` counts physical writes; `cause` is the interceptor's own error | deviation 13 |
| — | integration | **clone rules, both directions**: `subcollection()` does *not* inherit; a second instance over the same collection has its own list; `runReadOnlyAt` inherits the clone | deviation 14 |
| U-7 | unit | **physical-write accounting** (labelled receipts): a 0-write interceptor reserves no slot; a 2-write interceptor still yields each document its own receipt; 250 docs × 3 writes chunk as 2 batches, not one 750-op batch; the oversized guard measures real writes (601); `committedWrites`/`totalWrites` are physical on a mid-run commit failure | **F1** |
| — | integration | a 2-write interceptor's real `floor(500/3)`-document capacity, with **cross-chunk** receipt identity; a 0-write interceptor keeps receipts 1:1; an interceptor throwing aborts before **any** chunk commits | **F1** |
| — | types + integration | `set({ merge: true })` takes the target's **partial** model — a required-field schema accepts a one-field mirror; schema rejection and dotted-key refusal both fire | **F3** |

## Mutation checks

Restored from a **file backup** each time (`cp` before/after) — never `git checkout`/`git restore`/
`git stash`, which would have wiped uncommitted work while the change was still in progress. Driver:
`scratchpad/mut/{mutate.py,run.sh}`; residue grep after every run returned nothing.

Two of these are the ones that matter most, because each caught a test that guarded nothing: the
**I-8 naive port** (which the plan's own test design could not detect) and **U-7 (F1)** (which the
plan's own `totalWrites` formula gets wrong).

| Test | Mutation | Result |
| ---- | -------- | ------ |
| TT-1 (`write-interceptors.type-test.ts:58`) | `StagingTarget` → `Pick<WriteBatch, 'create'\|'set'\|'update'\|'delete'>` | **Fails** — `write-interceptors.type-test.ts(58,7): TS2322 Type 'Transaction' is not assignable to type 'StagingTarget'` (+2 in source) |
| `write-override-warning` `Missing` guard | drop `'registerWriteInterceptor'` from `NonWrite` (`write-override-warning.type-test.ts:67`) | **Fails** — `write-override-warning.type-test.ts(78,22): TS2344 Type 'false' does not satisfy the constraint 'true'` |
| I-5 (T8) | delete `txRepo.interceptors = [...this.interceptors]` | **Fails** — 4 tests |
| I-6 / I-7 (T3) | `writeResults.push(...chunkResults)` instead of the `domainIndices` projection | **Fails** — 1 test |
| I-8 (T4, faithful naive port) | restore the pre-#108 flat counter committing at exactly 500 *after* incrementing, inside the group | **Fails** — 1 test, at the per-group sibling-timestamp assertion (line 613) |
| I-8 (T4, boundary check ignores group size) | `counter + 1 > 500` instead of `counter + groupSize > 500` | **Fails** — 1 test (boundary moves; groups 165/166 land in one commit) |
| U-4 (T4) | remove the oversized-group throw | **Fails** — 2 tests |
| I-11 (T6) | invert `assertSameFirestoreInstance` to a no-op | **Fails** — **2 tests**, both I-11. (An earlier draft of this row said 30; the external reviewer re-ran it and measured 2, which is the better result — precisely targeted rather than coupled. Corrected per N5.) |
| I-10 / U-5 (T10) | remove the `assertNoWriteMetadataUnderTransactionMode` call | **Fails** — 1 integration + 2 unit |
| I-5 / I-9 (T9) | stage the domain write **before** running the read phase | **Fails** — 1 test |
| I-5 (tx join) | make `stageInterceptedWrite` always take its no-interceptor fast path | **Fails** — 4 tests |
| I-15 (reads keying) | `reads.values().next().value` instead of `reads.get(interceptor.name)` | **Fails** — 1 test |
| U-3 | remove the duplicate-name check | **Fails** — 2 tests |
| U-6 / I-12 | remove the `bulkWrite` refusal | **Fails** — 2 tests |
| U-6 / I-12 | disable the `recursiveDelete` refusal | **Fails** — 1 test |
| I-4 | `query().update()` → `interceptor: []` | **Fails** — 1 test |
| I-4 | `query().delete()` → `interceptor: []` | **Fails** — 1 test |
| I-4 | `bulkDelete` → `interceptor: []` | **Fails** — 1 test |
| `select().update()` | drop the collector forwarded through `select()` (`undefined`) | **Fails** — 1 test |
| doc-example gate | (checked in reverse) the snippets **failed** `test:types` before the fix — 2x `TS2345 Argument of type 'string \| FieldValue \| undefined' is not assignable to parameter of type 'string'` | **Fails** |
| I-13 hooks (Q3) | neuter the early `assertNoReadCapableInterceptor` so the refusal happens inside `commitInChunks` again | **Fails** — 3 tests (`Q3_GUARD`) |
| delete sentinels (Q1) | drop `assertNoDeleteSentinel` from the `set` path | **Fails** — 1 test (`Q1_DELETE`) |
| `set` payload, runtime (F3 re-fix) | validate `{ merge: true }` against the **update** model again — the unsound revision | **Fails** — 2 tests (`SET_PARTIAL`) |
| `set` payload, type level (F3 re-fix) | loosen the declared signature to `UpdateInput<WW>` | **Fails** — `test:types`, 2x `TS2578 Unused '@ts-expect-error' directive` (`SET_SIG_PARTIAL`) |
| TT-6 vocabulary | rename `writer.patch` to `writer.merge` | **Fails** — `test:types`, both TT-6 guards + 4 errors in source (`WRITER_VOCAB`) |
| `patch` normalization | drop `normalizeUpdateDataForMerge`, so `writer.patch` is no longer `repo.patch` | **Fails** — 1 test (`PATCH_NO_NORMALIZE`) |
| I-1 / I-10 | single-doc batch branch → `interceptor: []` | **Fails** — 14 tests |
| **U-7 (F1)** | restore closure counting — `[group.domain, ...group.interceptor]` as the group's operation list, i.e. the plan's own §6.2 invariant-4 formula | **Fails** — **4 of the 5** U-7 cases (0-write receipts, 2-write receipt identity, the 750-op single batch, the 601-write guard) |

Every `@ts-expect-error` in the two type-test files is **live** by construction: `test:types` is
green, and TypeScript reports TS2578 "Unused '@ts-expect-error' directive" for any that stopped
being an error.

## Gate results

Unit **36 suites / 468 tests -> 37 / 493**. Integration **37 / 548 -> 38 / 611**. Both up, as §10
required; **no existing suite's count moved** in either direction, which is the additivity check.

The gate was run in full **seven** times: the first pass, after my own self-review fixes, after
remediating the adversarial review, after each of the two owner-review rounds, and after the external
review's fixes. Only the last matters — it is the committed tree — so that is what is recorded here;
the earlier runs differed only in test counts and are not reproduced.

```
npm run test:types                       ✓
npm run lint                             ✓
npm run check:format                     ✓  All matched files use Prettier code style!
npm run test:unit                        ✓  37 suites / 493 tests   (was 36 / 468)
npm run test:integration:emulator        ✓  38 suites / 611 tests   (was 37 / 548)
npm run test:unit:coverage + gate:unit   ✓  All unit coverage gates passed.
npm run test:integration:coverage + gate ✓  All integration coverage gates passed.
npm run build                            ✓
npm run check:package                    ✓  102 files, allowlist satisfied
npm run check:consumer                   ✓  firebase-admin@^14.0.0 only (see Could-not-verify)
npm run check:docs                       ✓  207 doc files scanned
npm run docs:build                       ✓  61 pages
npm run check:zod-idioms                 ✓  207 files scanned
npm run rules:check                      ✓  All files are up to date.
npm run check:manifest                   ✓
LEG 15  declaration emit over dist/**.d.ts  ✓  exit 0  (FAILED on the first run — see below)
LEG 16  grep ':::' website/dist/            ✓  0 rows
grep "PROTOTYPE (#108)" / old flat shape    ✓  0 rows each
probe P1                                    ✓  exit 0
probe P2–P8                                 ✓  matches §3.2 exactly (incl. P3's 501-op commit)
probe P8b                                   ✓  matches §3.3 exactly (accepted, readable nowhere)
```

**Re-run after the external review's fixes** (M1, N1–N5), every leg **individually** so no leg is
hidden by an `&&` short-circuit — the reviewer's own method:

```
LEG 01–03  test:types · lint · check:format                  EXIT=0
LEG 04     test:unit                                         EXIT=0   37 suites / 493 tests
LEG 05     test:integration:emulator                         EXIT=0   38 suites / 611 tests  (+2 from M1)
LEG 06–09  unit + integration coverage, both gates           EXIT=0   both "coverage gates passed"
LEG 10–12  build · check:package · check:consumer            EXIT=0   102 files; firebase-admin@^14.0.0
LEG 13–14  check:docs · docs:build                           EXIT=0   208 doc files; Complete!
extras     check:zod-idioms · rules:check · check:manifest    EXIT=0
LEG 15     declaration emit over dist/**.d.ts                EXIT=0
LEG 16     grep ':::' website/dist/                          0 rows
greps      PROTOTYPE (#108) · old flat action shape          0 rows each
probes     P1 exit 0 · P2–P8 and P8b, all 16 lines matching §3.2 / §3.3
```

**Coverage gates, no threshold edited** (final, post-remediation):

| File | lines | branches | functions | thresholds |
| ---- | ----- | -------- | --------- | ---------- |
| `FirestoreRepository.ts` | 98.37% | 93.51% | **95.12%** | 90 / 75 / 85 |
| `QueryBuilder.ts` | 96.66% | 86.36% | **100%** | 90 / 75 / 95 |

§3.6 warned that **functions** is the binding metric (9 and 3 units of room), so per §8.6 I checked
the per-function LCOV rather than trusting the verdict — and the first such check found a real gap
(deviation 8). Final state: the only uncovered functions in `FirestoreRepository.ts` are the **6 that
were already uncovered at baseline** (`readSchema` / `createSchema` / `updateSchema` getters,
`isSubcollection`, `toFirestore` x2), and `QueryBuilder.ts` has **none**. Every function this change
adds is executed by a test, so both function percentages ended up **above** baseline (93.62% ->
95.12%, 100% -> 100%).

### Leg 15 caught a real defect — by a route the plan did not predict

T2/N4 warns that an internal-marker JSDoc tag on `StagingTarget` breaks the published `.d.ts` while
the whole 14-leg gate stays green. I never added that tag. Leg 15 still failed:

```
dist/core/FirestoreRepository.d.ts(329,31): error TS2304: Cannot find name 'StagingTarget'.
dist/core/FirestoreRepository.d.ts(330,46): error TS2304: Cannot find name 'StagingTarget'.
dist/core/QueryBuilder.d.ts(8,15): error TS2305: Module '"./FirestoreRepository.js"' has no exported member 'StagingTarget'.
```

Cause: my JSDoc **prose warning not to use that tag** mentioned it inside a code span, and TypeScript
reads the tag out of the comment regardless of markup — so the sentence forbidding the tag *applied*
it. `build`, `test:types`, `check:package` and `check:consumer` were all green throughout. Fixed by
rewording (`FirestoreRepository.ts:399–414` (unchanged region), which now says explicitly not to write that tag name
here even in a code span); leg 15 re-run exits 0, and `dist/core/FirestoreRepository.d.ts:341,357`
now declare both types while `dist/index.d.ts` mentions neither.

**Superseded intermediate runs.** Earlier drafts of this file listed each gate run separately; they
differed from the final run only in test counts and one coverage figure, so they have been removed in
favour of the single authoritative block above. Reviewer N5 flagged one of them for reporting
`FirestoreRepository.ts` functions at 95.00% where the committed tree measures **95.12%**.

## Anti-instructions checklist

| Anti-instruction | Confirmed |
| ---------------- | --------- |
| Do not commit beyond §7's named commits | ✓ nothing committed at all (deviation 1) |
| Do not create ADR-0044 | ✓ `ls docs/adr/` ends at `0043`; 0040 flipped |
| No ADR-0017 amendment; no living-index footer touched | ✓ `grep -rn "remaining deferral" docs/adr/*.md` → 7 occurrences, **all** `(#41)`; ADR-0017 unmodified in `git status` |
| No internal-marker tag on `StagingTarget`/`WriteGroup` | ✓ `grep -n "@internal" src/core/FirestoreRepository.ts` → 0 rows; the prose warning at `:399–414` deliberately avoids the tag name; leg 15 exits 0 |
| Not `Pick<WriteBatch,…>`; no `tx as WriteBatch` | ✓ `FirestoreRepository.ts:417` returns `unknown`; the two casts are `tx as StagingTarget` inside the two boundary helpers, never to `WriteBatch` |
| `registerWriteInterceptor` not in `REPOSITORY_WRITE_METHODS`/`BYPASS_PATHS` | ✓ `grep -n registerWriteInterceptor src/core/writeOverrideWarning.ts` → 1 row, in prose only |
| Do not touch `CollectionGroup.ts` or `src/vector/**` | ✓ absent from `git status` |
| Do not propagate interceptors in `subcollection()`/`withSchema()`/`withSchemaArgs()` | ✓ `grep -n "\.interceptors" src/core/FirestoreRepository.ts` → the field, the guards, and exactly one clone site (`:5117`, inside `runInTransaction`) |
| Do not widen `write` to `Promise<void>` | ✓ both interceptor interfaces declare `=> void` |
| Do not move `upsert`'s pre-read; do not change hook families | ✓ `getById` still at `:3021`, before the branch; each branch keeps its own hooks |
| Do not extract into a new module | ✓ no new file under `src/core/`; everything is in the two integration-gated files |
| No `{ skipInterceptors: true }` on `bulkWrite` | ✓ guard is unconditional and sits **above** the `skipHooks` check |
| No "expect 501 to fail" chunk test | ✓ I-8 asserts timestamps + per-group identity; the comment says why |
| Do not fold in `writeOverrideWarning` field-style detection | ✓ mechanism untouched; only the redirect string and JSDoc changed |
| Do not claim the `^12`/`^13` consumer legs pass | ✓ see Could-not-verify |
| Do not run `readme-sync` | ✓ `grep -rn "denormaliz\|interceptor" README.md npm-readme.md` → 0 rows; neither file in `git status` |

## §11 audit

| §11 item | Result | Evidence |
| -------- | ------ | -------- |
| §1 — `registerWriteInterceptor` (D2), positional writer, plain `Error` (D3), one PR (D1) | **PASS** | `FirestoreRepository.ts:4634`; `writer.set(repo, id, data)` at `:4530`; all four guards `throw new Error` (`assertSameFirestoreInstance` `:4485`, `assertNoReadCapableInterceptor` `:4710`, `assertNoInterceptorsRegistered` `:4732`, `assertNoWriteMetadataUnderTransactionMode` `:4754`); `Errors.ts` / `ErrorParser.ts` / `express/index.ts` untouched (`git status` → 0 rows), so no new error class; one branch |
| §2 — every matrix cell implemented or refused; nothing out-of-scope folded in | **PASS** | run (`runInterceptedWrite`): `:1965`, `:2091`, `:2966`, `:3385`, `:3491`; join (`stageInterceptedWrite`): `:5349`, `:5426`, `:5489`, `:5549`; chunked: 4 fixed-batch sites + `QueryBuilder.ts:2250`, `:2332`; refuse-unconditionally (`bulkWrite`, both recursive deletes): `:3788`, `:3985`, `:4030`; refuse-read-capable, as the first statement of all six bulk paths: `:2167`, `:2290`, `:3151`, `:3582` + `QueryBuilder.ts:2190`, `:2287`. No outbox, no chunked transactions, no `updateAtomic`, no field-style detection, no `tx` on `HookContext` |
| §3 — line numbers re-verified; "not changed" surfaces untouched | **PASS** | baseline sha unmoved, patch applied clean; `git status` lists no file from §3.9 |
| §4 — T1…T11 each pinned and mutation-checked | **PASS** | trap table + mutation table above; T2 by leg 15, which **fired** (see Gate results). T3 and T4 are pinned twice over after F1: once against the plan's own closure-counting formula |
| §5 — notes record 5.1 / 5.4 / 5.5 / 5.6 | **PASS** | Could-not-verify + Ambiguities |
| §6 — patch applied; no `PROTOTYPE (#108)`; tx clone carries interceptors; staging types un-tagged and un-re-exported | **PASS** | grep 0 rows; `:5117`; `dist/index.d.ts` mentions neither type; TT-5 |
| §7 — order followed; no anti-instruction violated | **PASS** | steps 1–12 in order (patch → clone fix → runner → bulk → single-doc → tx → refusals → type-test → tests → docs → gate); checklist above |
| §8 — three suites added; trap matrix holds both ways; both gates pass on functions with no threshold edit | **PASS** | **4** new test files (`write-interceptors.type-test.ts`, `write-interceptor-examples.type-test.ts`, `writeInterceptors.unit.test.ts`, `repository-write-interceptors.integration.test.ts`); mutation table; `check-coverage-gates.mjs` unmodified (`git status` → 0 rows); only the 6 baseline-uncovered functions remain in the two changed files |
| §9 — ADR flipped in both places; no new ADR; no 0017 amendment; no footer touched; `patterns.md` renumbered; 4 other docs updated; redirect updated; `:::` grep clean | **PASS** | `0040…md:3` reads `Accepted`; `README.md:70` row reads `Accepted`; `docs/adr/` still ends at `0043`; `0017…md` unmodified (`git status` → 0 rows); all 7 "remaining deferral" lines still read `(#41)`; heading map 1/2/3/4 + Choosing; `writeOverrideWarning.ts:291,313` (prose + message only, not `REPOSITORY_WRITE_METHODS`/`BYPASS_PATHS`); leg 16 → 0 rows |
| §10 — all legs pass with output; both counts up; probes re-run | **PASS** | Gate results — three runs; final unit 37/493, integration 38/608; all three probes re-run and matching §3.2/§3.3 |
| §11 audit performed against source, not memory | **PASS** | every `file:line` in this table re-resolved with `sed -n` on the final tree after the F1/F3 restructuring moved them |
| plan directory removal | **NOT DONE, by design** | separate cleanup commit after review |

## Independent adversarial review

**Reviewer:** a fresh general-purpose subagent with none of this session's context · **Reviewed:**
the working tree + `PLAN.md` + the three test suites — **not** these notes · **Verdict:** pass with
fixes (one blocker, empirically reproduced).

It was handed the diff, the plan and the tests, and prompted to **refute**: default to a finding when
uncertain, check every §7 anti-instruction and §4 trap by name, enumerate the whole write surface to
*find the path that was missed*, and hunt anchor rot from the §9.2 renumbering. It was told the plan
itself had already been wrong once (the I-8 design), so not to trust it either. It ran read-only
commands and wrote a standalone jest probe of its own; it modified nothing.

It reported **eight** findings. All eight are disposed below; none is left open.

### Findings fixed

1. **F1 — BLOCKER — `commitInChunks` counted interceptor *closures*, not the writes they stage.**
   The real defect, and I missed it. `collectInterceptorWrites` pushes exactly one closure per
   registered interceptor, but a `write` phase may call `writer.*` **zero, one, or many** times. Every
   piece of the chunk accounting treated one closure as one physical write, so an interceptor that
   staged anything other than exactly one write broke, silently:
   - **0 writes** → a reserved slot never fills, and the receipt projection reads past the end of the
     chunk result array (`TypeError`) or hands a document the previous one's receipt;
   - **2 writes** → documents get an *interceptor's* receipt. **That is trap T3, reintroduced** —
     no error, no type change, just wrong timestamps;
   - **2 writes × 250 documents** → 750 operations committed as **one** batch. Production rejects
     >500; the emulator does not (probe P3 / trap **T7**), so no emulator test could ever see it;
   - the `> 500` oversized-group guard never tripped for one interceptor staging 600 writes, and the
     published `floor(500 / (1 + K))` capacity contract was wrong.

   **The plan encodes this bug.** §6.2 invariant 4 specifies `totalWrites` literally as
   `groups.reduce((n, g) => n + 1 + g.interceptor.length, 0)`, and §6.3's collector is one closure per
   interceptor — correct only if every interceptor stages exactly one write, which nothing enforces
   and the code's own error text ("…or have them stage fewer **writes per document**") contradicts.
   This is the **second** plan defect found (after I-8); see "Open questions".

   **Why no test caught it:** every interceptor in all three of my suites staged exactly one write.

   **Fix — record, then chunk.** New module-private `recordStagedWrites`
   (`src/core/FirestoreRepository.ts:627`): a `StagingTarget` that captures calls instead of
   performing them. `commitInChunks` now resolves every group to its **real** operation list first
   (`:4863`), so the boundary decision (`:4902`), the receipt projection (`:4907`, `:4915`), the
   oversized-group guard (`:4875`) and `totalWrites` are all physical-write counts. Each `write`
   phase runs **exactly once**, and each replay preserves **arity** — an omitted
   `SetOptions`/`Precondition` is never forwarded as an explicit `undefined`, which the SDK's
   alternating field/value overloads would misread as data.

   **Deliberate behavior improvement that falls out of it:** because all write phases now run before
   the first commit, an interceptor that throws aborts the **whole** call with nothing committed —
   even on the thousandth document. Previously earlier chunks stayed committed. That is strictly
   better for a feature whose contract is "atomic or refused", and the integration test that
   previously pinned the old behavior now pins the new one.

   **Tests:** a new `U-7` block in the unit suite with **labelled receipts** — the mocked
   `batch.commit()` returns one receipt per staged op tagged with that op, which is the only place
   receipt *identity* is observable at all (see F4). It covers 0-write, 2-write, the 750-op
   overflow, the 601-write guard, and physical `committedWrites`/`totalWrites` on a mid-run commit
   failure. Plus two emulator tests: a 2-write interceptor's real `floor(500/3) = 166`-document
   chunking with cross-chunk receipt identity, and a 0-write interceptor keeping receipts 1:1.
   **Mutation-checked:** reverting to closure counting fails **4 of the 5** new unit cases.

2. **F2 — MAJOR — the published doc snippets did not compile.** Found independently by both of us
   while the review ran; already recorded as deviation 9. `write.data.userId` is
   `string | FieldValue | undefined` on the `'update'` branch. Fixed by rewriting the snippets to
   *teach* that constraint, and gated by the new
   `src/tests/types/write-interceptor-examples.type-test.ts`, which holds all three published
   snippets **byte-identically** (verified with `diff`). The reviewer's second error
   (`{ lastOrderId, lastOrderStatus }` not being a full `CreateInput`) is the same root cause as F3
   and is fixed by it.

3. **F3 — MAJOR — reported correctly, and my first fix was WRONG. Re-fixed.**

   The friction was real: `writer.set(..., { merge: true })` typed `data` as `CreateInput<WW>` and
   validated it with `validateCreateData`, so mirroring one field onto a required-field schema
   demanded that sibling's whole document. I "fixed" it by typing and validating the merge branch as
   a partial update.

   **That was unsound, and the owner caught it: you cannot create with a partial payload.** A `set`
   creates the document when it is absent, so a partial payload persists a record missing its
   required fields — and `getById` does **not** validate on read, so it comes back typed as a
   complete `FirestoreDocument<T>` with those fields simply absent. A silent type lie. My own
   integration test asserted it as correct: it wrote `{ lastStatus }` into a `members` collection
   requiring `displayName` and `email`, then asserted the read-back matched.

   **Reverted to the planner's original signature** — one `set`, no overload, `data: CreateInput<WW>`,
   `validateCreateData` on both branches (`src/core/FirestoreRepository.ts:4530`). `{ merge: true }`
   now only controls whether unmentioned fields survive; it does not change the payload model. Two
   guards come back for free from the create path — dotted keys (which `set()` would turn into literal
   field names) and delete sentinels — so my hand-rolled versions of both are gone.

   **The real answer is that the friction is correct.** The write verbs on the two axes that
   distinguish them:

   | | must **not** exist | **don't care** | must **already** exist |
   | --- | --- | --- | --- |
   | complete payload | `create` | `set` | — |
   | partial payload | — | **deliberately empty** | `update` |

   The empty cell is a guard rail: a partial write that tolerated a missing document would be the
   only way in the library to persist a schema-invalid record. Mirroring onto an entity that should
   already exist is `update`, and its failure when the target is missing is the feature — an order
   write must not conjure a half-formed user.

   Pinned and mutation-checked in **both** layers: loosening the *implementation* back to partial
   validation fails 2 integration tests (`SET_PARTIAL`); loosening the *declared signature* to
   `UpdateInput<WW>` fails `test:types` with two unused-`@ts-expect-error` errors (`SET_SIG_PARTIAL`).
   The ADR amendment, `patterns.md`, `repository.md` and the example type-test all carry the corrected
   rule.

   _Original report, kept for the trace:_ there was no working spelling for "atomically patch a
   sibling that may not exist".**
   `writer.set(repo, id, data, { merge: true })` typed `data` as `CreateInput<WW>` and validated it
   with `validateCreateData` — the target's **whole** create model. So the one member that can
   address a not-yet-existing sibling still demanded that sibling's entire document, and the counter
   / audit-row / mirror-field case ADR-0040 exists for only worked when the target's write model was
   *entirely optional*. The reviewer's tell was sharp: my own example type-test had quietly declared
   `userSchema` with every field optional, which is what made the guide compile.

   **Fix:** `set` is now **overloaded** (`:4470`) — a full write keeps `CreateInput<WW>`, and
   `{ merge: true }` takes `UpdateInput<WW>` and validates through `validateUpdateData` +
   `sanitizeUpdateData` (`:4493`). Dotted keys are refused on the merge branch, because Firestore's
   `set()` treats a dot as a literal character in a field *name* (unlike `update()`) — the same
   hazard `upsert` already guards. Documented in `patterns.md` and `repository.md` (which now has a
   payload-model column). **Tested** at the type level (a required-field target accepts a partial
   merge; two live `@ts-expect-error`s pin that a non-merge `set` still demands the full model and
   that a merge `set` is still checked against the target's model) and at runtime against a
   **schema-validated** target with required fields, including the schema rejection and the
   dotted-key refusal.

4. **F4 — MINOR — I-6's receipt-*identity* assertion was vacuous.** Correct: every write in one
   committed batch shares a single commit timestamp (the plan's own probe P2), so
   `stored.updateTime.isEqual(writeTime)` holds even when the projection returns an interceptor's
   receipt. Within one chunk, that assertion pins the *count*, not the *index*. Fixed three ways:
   the misleading comment is replaced with an explicit note saying exactly what the test can and
   cannot prove; cross-chunk identity is asserted in the new 2-write capacity test; and genuine
   per-operation identity is pinned in the unit suite, where labelled receipts make it observable
   (F1).

5. **F5 — MINOR — the refusal message advised an API that does not exist.** It ended "…or unregister
   the interceptor", and there is no unregister API. Reworded (`:4678`) to "…or do not register the
   interceptor on this repository — registration lasts for the life of the process and cannot be
   undone", which also matches what `reference/repository.md` says.

6. **F6 — MINOR — a unit test title claimed coverage it did not have.** Titled "the fixed-batch
   helpers **and query terminals** refuse under transaction mode", but the body exercised only the
   five fixed-batch helpers (the mocked boundary cannot produce a real query). Retitled to "the five
   fixed-batch helpers…", with a comment pointing at I-13, which does cover both query terminals.

7. **F7 — NIT — `writesInCurrentBatch` duplicated `counter`.** Both were initialised, incremented and
   reset identically and could never differ; my refactor had added a second reset site, doubling the
   drift surface. Collapsed into a single `staged` counter, which under F1's fix is the physical
   write count.

8. **F8 — MINOR — the gate results in these notes predated the tree they described.** True — the tree
   moved four times while the review ran. The gate has since been re-run end to end as **Run 3**
   above, on the final tree, including both coverage gates and legs 15/16.

### Findings not treated as defects

None. Every finding was a real defect or a real inaccuracy.

### Findings deferred

None.

### What the reviewer independently confirmed correct

Recorded because it saves the next reviewer a cycle: all **16** §7 anti-instructions, one by one; the
§2.1 matrix enumeration (including that both — and only both — `new FirestoreQueryBuilder` sites
forward the collector, that `withVectorSearch` is a `get` proxy binding to the real repo so
interceptors *do* apply through it, and that `bulkWrite`'s guard sits above the `skipHooks` check);
the T8 clone fix; T1/TT-1 and TT-5's live directives; the I-8 redesign ("the single best thing in the
change"); `assertSameFirestoreInstance` on all five members with no other route to a foreign repo;
the duplicate-name check and overload discrimination; `EMPTY_INTERCEPTOR_READS` genuinely safe;
error wrapping clean (a plain interceptor `Error` reaches the caller intact); additivity real for
K = 0; the §9 bookkeeping; **no anchor rot** from the renumbering; and both new `:::` asides
correctly fenced.

### Gate re-run after fixes

Re-run in full after remediating the review, and again after each owner-review round. See
"Gate results" above — that block is the **final** run, on the committed tree. Suite counts moved
with each round of remediation (unit 488 -> 493, integration 593 -> 609); both coverage gates still
pass with no threshold edit, and the only uncovered functions in the two changed files remain the 6
that were already uncovered at baseline.

## External review — round 1 dispositions

**Reviewer:** external session, `review.md` in this directory · **Reviewed:** `0c51ea6` ·
**Verdict:** APPROVE WITH FIXES — no blockers, 1 Major, 5 Minors.

I read their "Verified and holding" section first, so none of that is re-checked here. They
independently re-ran all 14 legs *individually* (no `&&` short-circuit), legs 15–16, all three probes,
five of my mutations, and added three probes the plan never named — a payload-shape probe (which found
**M1**), an error-identity probe across both modes (held), and a 50-case chunk property sweep over
K ∈ {0…4} writes-per-document × ten boundary-adjacent document counts (held, and non-vacuous: 8 cases
fail under a group-size-ignoring boundary). They also judged each of my deviations individually and
found all seven right; **none is reversed**.

All six findings are **fixed**. None deferred, none disputed.

### M1 — Major — a merge write reaches the interceptor dot-path normalized, undocumented and unpinned

Confirmed against source: `runUpdate` normalizes a merge payload into field paths *before* validating
(`src/core/FirestoreRepository.ts:2948–2952`) and hands that same `validData` to the interceptor
(`:2967`). So `update(id, { address: { city } })` observes `{ address: { city } }` while
`patch(id, { address: { city } })` observes `{ 'address.city': … }` — same `kind: 'update'`, and
`UpdateInput<W>` admits dotted keys, so TypeScript says nothing. `bulkPatch` has the same shape
(`:3183–3185`). An interceptor reading `write.data.address?.city` silently mirrors nothing under
`patch()`: the exact silent-skip class ADR-0040 exists to remove, at the observation surface.

I took their recommended resolution rather than changing the contract — the interceptor observing what
is **actually written**, transforms included, is the honest semantics, and handing over the caller's
pre-normalization payload would hide the schema transforms `validateUpdateData` applies. So the shape
stays and is now written down and pinned:

- **Declared where the contract is** (`:540–563`): a ⚠ block on `InterceptedWrite` with the two-line
  worked example and the "read it as `write.data['address.city']`" instruction, plus a per-member note
  on the `'update'` branch. Also noted at the site that produces the divergence (`:2967`).
- **`types.md`** — the `InterceptedWrite` bullet now carries the same warning.
- **`patterns.md:597`** — a `:::caution` in the guide where interceptor authors actually read, with
  the scope note that flat payloads are unaffected (which is why the guide's own published example
  was never exposed to it).
- **Pinned** by two new integration cases (`…integration.test.ts:158`, `:201`): `update()` keeps the
  nested object, `patch()` and `update(…, { merge: true })` normalize, `bulkPatch` matches `patch`,
  and a **flat** payload is unchanged through both. Mutation-checked (`M1_SHAPE`): handing over the
  pre-normalization payload fails the new case.

### N1 — `commitInChunks`' JSDoc still claimed it refuses transaction mode

Their sharpest point: a maintainer trusting that comment would read the six early guards as
belt-and-braces and might delete one, at which point that path stops refusing entirely. Replaced with
the inverse statement — this method **assumes its callers have already refused**, the check lives in
`assertNoReadCapableInterceptor` (`:4740`), and removing one of the six guards removes that path's
refusal outright.

### N2 — orphaned JSDoc in the query builder

Correct: two doc blocks sat consecutively, so the second won the declaration and
`CollectInterceptorWrites` had none — and the orphan carried N1's stale claim. Reordered so each block
sits above the type it documents (`QueryBuilder.ts:69`, `:82`), and the collector's third paragraph now
names the early guard instead of `commitInChunks`.

### N3 — transaction-retry re-execution undocumented, beside a claim reading the other way

Both phases run inside the transaction callback, so Firestore's contention retry re-executes them —
correct and unavoidable, but an interceptor with an external side effect fires it once per *attempt*.
Meanwhile the guide said "each phase still runs exactly once per document", true only of the
batch/chunking path it sits in. Fixed both halves: that sentence is now scoped to **batch mode**, and a
new bullet (`patterns.md:665`) states the re-run and says to keep phases free of external side
effects.

### N4 — the bulk-update refusal named both methods regardless of which was called

Exactly the imprecision deviation 11 fixed for `upsert`, and `merge` was already in scope two lines
below. Now `merge ? 'bulkPatch()' : 'bulkUpdate()'` at the guard (`:3178`) and at the `commitInChunks`
label (`:3241`), so the oversized-group error is precise too. Both suites' assertions tightened to the
specific label — which is what made this visible: the integration test failed the moment the label
changed. Mutation-checked (`N4_LABEL`).

### N5 — three stale figures in these notes

All three corrected in place, each marked as a correction rather than silently rewritten:

1. **Deviation 13's claim that `WriteOutcomeError.cause` can be the interceptor's error** — superseded
   by F1, as they spotted. The recording loop is **outside** the `try` (`:4937` vs `:4973`), so an
   interceptor throw propagates unwrapped and nothing commits. Their reading is right; the shipped docs
   already said the correct thing.
2. **The T6 mutation row said "30 tests"** — they measured **2**, both I-11. Corrected, and it is the
   better result: precisely targeted rather than coupled.
3. **A superseded run block reported functions at 95.00%** where the tree measures 95.12%. That block
   is deleted; the "Gate results" section is the single authoritative run.

### Their four "not defects" — agreed, and nothing changed

`I-6` not failing under the T3 mutation (that is F4, and they explicitly warn against "strengthening"
it since within one chunk it cannot work); the two unreachable `?? []` branches in the query builder;
`commitInChunks`' idempotent double-parse; and the pre-existing out-of-band commit for a plain write
inside someone's transaction callback under batch mode. I also left `security-boundary.md:72`'s
parent-section anchor alone, which they marked optional.

## Could-not-verify

- **§5.1 — only the `^14` `check:consumer` leg ran locally.** `firebase-admin@^14.0.0` with
  `@google-cloud/firestore` 8.6.0. The `^12` / `^13` and pinned-firestore legs run only in CI. N1's
  signature extraction is from 8.6.0 only; if `Transaction` and `WriteBatch` diverged in an older
  major, `StagingTarget` could reject one there. The `unknown` return type makes that unlikely (it
  needs only parameter compatibility), but I have **not** verified it. Watch those matrix legs; if one
  fails, report it rather than widening `StagingTarget` to `any`.
- **§5.2 — P8b's exact emulator filing behavior** is still unchased and emulator-specific. What is
  verified (and re-verified this session) is the decision-relevant part: accepted, reports success,
  readable through neither instance. The guard is justified either way.
- **§5.6 — the `writeOverrideWarning` field-style / ctor-body blind spot is still deferred.**
  ADR-0043 pointed it at "ADR-0040's choke point". The choke point now exists; wiring the lazy check
  into it is **not** done here (§2 out of scope). The warning's *message* changed; its mechanism did
  not. Not shipped — do not read the docs' new wording as implying otherwise.
- **§9.3 — `migration-v2-to-v3.md` needed nothing.** `grep -rn "interceptor\|denormaliz"` → 0 rows.
  Interceptors are new API in an unreleased 3.0.0, so there is nothing to migrate *from*. Recording
  the empty grep here rather than leaving it implicit, as §9.3 asks.
- **§8.3's `packageExports.unit.test.ts` check — read before deciding, as the plan asked.** That file
  asserts **runtime** exports (`expect(orm.X).toBeDefined()` on values, `src/tests/unit/packageExports.unit.test.ts:11–60`).
  All seven new exports are **types**, which have no runtime presence, so no change is required there
  and none was made. Recording the check rather than leaving it implicit.
- **Production (non-emulator) Firestore was never exercised.** Everything runtime rests on the
  emulator. Notably P3: the emulator does not enforce the 500-op batch limit, so the oversized-group
  refusal (U-4) and the chunk arithmetic are pinned by *our* arithmetic and by observable commit
  grouping, not by a real backend rejection.
- **Nested transactions are newly reachable and untested.** Under transaction mode a plain
  `repo.update(...)` opens `db.runTransaction` internally. A caller who invokes it from *inside*
  another `runInTransaction` callback (rather than using the `*InTransaction` helpers, which join
  the caller's transaction and are the documented way) would now nest two independent transactions
  where previously there was one — a contention/deadlock risk. This follows directly from
  mode-by-inference and is not something this change can avoid. **Owner ruling: documented + tracked.**
  A `:::caution` block now sits under `patterns.md` → "Register a write interceptor", and the real fix
  (ambient transaction context, or detect-and-throw) is
  [#112](https://github.com/reggieofarrell/flintfire/issues/112). Still untested — there is no way to
  detect an open transaction from inside a write path today.
- **Concurrency / retry under real contention** is not tested. P7 shows a failed attempt commits
  nothing, and transaction re-entry is already covered by
  `repository-write-outcomes.integration.test.ts:432`, but a read-capable interceptor re-running its
  read phase across a genuine retry storm has not been observed.

## Owner decisions (all settled)

Kept as a record of what was decided and why — **none of these are open**. A fresh reviewer who
disagrees with one should read the reasoning here first; each was argued rather than assumed.

**All five settled by the owner (2026-08-24):** Q1 → keep `set`, **drop the overload**; Q2 → keep
record-all (a); Q3 → add the early guards; Q4 → doc block + follow-up issue #112; Q5 → one commit.
The delete-sentinel sub-question resolved itself once `set` went back to create-model validation.

1. ~~**`set` on the writer (§5.4), now with an overload**~~ — **RULED: keep the member, drop the
   overload.** `set` turned out not to be new public vocabulary (`bulkWrite` already exposes the
   `'set'` verb with identical semantics), and the overload turned out to be unsound — a partial
   payload cannot create a valid document. See deviation 17 and finding F3.
2. ~~**The bulk-path refusal fires after `beforeBulk*` hooks**~~ — **RULED: add the guards.** Done;
   see deviation 16.
3. ~~**Interceptor write phases now run before the first commit**~~ — **RULED: keep it (option a).**
   An interceptor throwing on document 9,000 of 10,000 aborts everything rather than leaving 8,999
   committed. The deciding argument was `totalWrites`: it must be the *physical* write count (§6.2
   invariant 4, the thing F1 was about), and that is only knowable by running every write phase — so
   a lazy per-chunk variant would have to either report a closure-count estimate (the F1 bug,
   relocated), report a number it cannot know, or run the remaining write phases inside a catch
   block. Recording everything up front gets it for free. Two supporting facts, both verified against
   source rather than assumed:
   - the O(N) retention already exists — `bulkCreate` builds `capturedIds`, `drafts`, `validatedDocs`
     and the whole `actions` array before `commitInChunks` is called (`:2213`), so this adds a
     constant factor, not a complexity class;
   - `bulkCreateWithIds` uses `batch.create` (`:2327`), so a partial commit leaves the naive retry
     failing with `ConflictError` on every already-created document — the state a partial commit
     would strand you in is worse than starting clean.

   Now documented as an explicit two-row table in the guide's capacity section, because the
   surrounding "becomes non-atomic above 500" text would otherwise read as contradicting it:
   **interceptor** failures commit nothing, **commit** failures stay partial.
4. ~~**A follow-up issue for nested transactions?**~~ — **RULED: yes.** #112 filed; caution block
   added. Original text: Under transaction mode a plain `repo.update(...)`
   inside someone else's `runInTransaction` callback now nests two independent transactions (see
   Could-not-verify). Out of scope here; worth an issue and a doc warning?
5. ~~**Commit shape**~~ — **RULED: one commit**, with the §10 feature subject.

### Commit (§10)

Committed as **one** commit (owner ruling Q5, see deviation 1), with §10's subject:

```
feat(repository): guarantee write interceptors run in the primary write's atomic boundary (#108)
```

**Breaking-or-not: not breaking**, per §10's ruling and re-verified on the final tree. Every new path
requires a `registerWriteInterceptor` call no existing consumer makes; `commitInChunks` is private;
`WriteGroup` / `StagingTarget` are not re-exported (`dist/index.d.ts` mentions neither); U-2 and
I-14 assert the zero-interceptor path is unchanged, and no existing suite's test count moved. The two
observable changes are both gated on opting in: `WriteOutcomeError`'s counts are physical writes, and
`partially-committed` becomes reachable below 500 documents. Folds into the unreleased **3.0.0**, so
no `BREAKING CHANGE:` footer.

### For the next reviewer — where I would look hardest

Not open questions, just an honest ranking of where this change is most likely to still be wrong:

1. **`commitInChunks`'s record-then-chunk rewrite** (`:4896`). The largest structural change, made
   late under review pressure. Worth checking: that `domainIndices` is reset on every path, that the
   boundary arithmetic is right for group sizes that do and do not divide 500, and that recording
   every group up front is acceptable for very large bulk calls (it roughly doubles an already-O(N)
   allocation — see the owner decision on that).
2. **`writer.set`'s semantics** — this went back and forth twice. It now takes the **complete** write
   model on both branches, and `{ merge: true }` only controls whether unmentioned fields survive.
   The failure mode I shipped and then reverted was allowing a partial payload to create a
   schema-invalid document; check that nothing else on the writer can still do that.
3. **The Q3 early guards** (`:4710`). These deliberately contradict §6.2 invariant 1, on the owner's
   ruling. Worth confirming all six paths really are covered and that the query-terminal plumbing
   (two optional ctor params on `FirestoreQueryBuilder`, forwarded by `select()`) has no hole.
4. **Anything I marked could-not-verify** — particularly the `^12`/`^13` `check:consumer` legs, which
   only run in CI, and the fact that nothing here has touched production Firestore.

### A note on the plan itself

Two of its specifications were wrong in the same way — each was internally consistent, compiled, and
had a test written against it that could not fail:

- **§8.4 I-8** ("1 interceptor, 260 documents") cannot observe a straddling group, because a group
  size of 2 divides 500 evenly.
- **§6.2 invariant 4** (`totalWrites = groups.reduce((n, g) => n + 1 + g.interceptor.length, 0)`)
  is correct only if every interceptor stages exactly one write.

Both were caught by adversarial pressure rather than by the gate — the first by mutation-checking a
test I had just written, the second by the independent reviewer. Worth carrying into the next plan:
**a `1 + interceptors.length` arithmetic anywhere in that document is a smell**, because the writer
surface deliberately does not constrain how many writes a phase stages.
