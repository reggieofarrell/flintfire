# Issue #82 — implementation review

**Reviewer:** Codex (GPT-5) with three independent read-only audits · **Round:** 1 · **Reviewed:**
`99fdaa2` (`test(types): strengthen #82 number-index and special-type pins`) · **Branch:**
`cursor/preserve-explicit-id-indexed-paths-e5aa` · **Plan:** `PLAN.md` @ baseline `6dc98c6` ·
**Tree:** implementation tree restored exactly after mutations; only this uncommitted `review.md`
was added by the review

**Verdict: BLOCKED** — B1 leaves the plan's T3/D4 modifier-and-value preservation contract
unguarded; add the four missing index-domain assertions and mutation-check them, then address N1–N3
and rerun the full gate.

---

## What I ran

`notes.md` was used only as a map. Every load-bearing claim below was checked independently against
the committed tree.

| Check | Command / method | Result |
| ----- | ---------------- | ------ |
| Full §10 gate | Exact 14-leg `&&` chain redirected to `/tmp/issue82-review-gate.log`, with explicit `EXIT` capture | The chain passed through unit coverage/gate, then the integration-coverage emulator stalled and was manually stopped (`EXIT=130`). No assertion failure was printed. |
| Stalled/skipped legs | Clean `test:integration:emulator` rerun, then all remaining legs from `test:unit:coverage` through `docs:build` in a second captured chain | Integration **36 suites / 544 tests**; remainder `EXIT=0`. Together, every §10 leg has a fresh result on `99fdaa2`. |
| Suite counts | Fresh unit and emulator runs | Unit **32 suites / 426 tests** (plan baseline 32/426); integration **36 suites / 544 tests** (baseline 36/544). Unchanged is correct: §8 assigns this type-only change to `test:types`, not Jest. |
| Unit coverage gates | Own remainder log | Pure utils **98.93/94.47/100** vs **95/90/90**; error/validation **98.42/92.92/100** vs **90/85/90**; package exports **100/100/75.76** vs **100/100/65** (lines/branches/functions). |
| Integration coverage gates | Own remainder log | Repository **98.11/92.42/93.48** vs **90/75/85**; QueryBuilder **96.38/86.44/100** vs **90/75/95**; CollectionGroup **99.55/97.22/100** vs **90/75/95**; validation **95.97/90.51/100** vs **90/80/95**; vector **93.26/88.03/96.55** vs **90/75/90**. |
| T1 mutation | `OmitId` explicit-id branch → baseline `Omit<S, 'id'>`; `npm run test:types` | `EXIT=2`, **35 diagnostics** confined to `union-model-paths.type-test.ts`: direct/nested aliases, precision, Core/repository/group/vector surfaces, and union member all failed. |
| T3 targeted mutation | `NumberIndex<T>` → `Record<string, unknown>`; `npm run test:types` | `EXIT=2`; only TY-8 failed, with unused directives at test lines 436 and 451. The existing domain/readonly guard is targeted, not suite-wide coupling. |
| T3 false-negative mutation | `StringIndex<T>` → `Readonly<Record<string, unknown>>`; `NumberIndex<T>` → `Record<number, unknown>` | **`test:types` passed (`EXIT=0`)** despite losing mutable-string behavior and precise string/number value types. This is B1's executed falsifier. |
| Mutation reverts | Reversed each temporary patch with `apply_patch`, reran `npm run test:types`, checked source diff/status | Clean compiler run after every revert; no `src/` diff remained. |
| Compiler probe | `node docs/plans/issue-82-explicit-id-index-field-paths/probes/resolve.mjs …/explicit-id-index.probe.ts` (independent code audit) | Selected paths, declared precision, dynamic/id values, unions, number/readonly/symbol domains, and `never`/`unknown`/`any` matched the implementation contract; no diagnostics. |
| Declaration emit | Independent `tsc --declaration --emitDeclarationOnly` audit | Clean; emitted private helpers accompany public `OmitId`; no new undeclared-package import. |
| Unplanned surfaces | `rg` and numbered reads of migration guide plus emitted Core extractor/factory JSDoc | Found N1 and N2; these surfaces were absent from the plan's four-page docs list. |
| Diff / notes / plan audit | `git show` per implementation commit, `git diff main...HEAD`, exact source reads, three independent delegated audits | Algorithm and intended surfaces held; B1 and N1–N3 remain. |

---

## Blockers

### B1 — T3/D4 index modifier and precise-value preservation is only partially falsifiable (`src/tests/types/union-model-paths.type-test.ts:423`)

The public helper documentation promises that homomorphic `Pick` preserves the original index
modifier and precise value type at `src/utils/pathTypes.ts:52–67`, and plan D4/T3 requires this for
both string and number domains. The current tests cover:

- a **mutable, `unknown`-valued number** index read at
  `src/tests/types/union-model-paths.type-test.ts:423–440`; and
- a **readonly, `unknown`-valued string** index with one rejected write at
  `src/tests/types/union-model-paths.type-test.ts:442–453`.

They do not positively write through either mutable index, exercise a readonly number index, or
observe a precise string/number index value. I replaced the two `Pick` branches with:

```ts
type StringIndex<T> = string extends keyof T ? Readonly<Record<string, unknown>> : unknown;
type NumberIndex<T> = number extends keyof T ? Record<number, unknown> : unknown;
```

`npm run test:types` still passed. This mutation violates the documented contract by making a
mutable string index readonly and erasing precise value types, yet no test sees it. The narrower
`NumberIndex → Record<string, unknown>` mutation did fail only TY-8, proving existing tests guard
domain widening but not the full modifier/value contract claimed by T3.

**Failure scenario:** a future refactor replaces homomorphic `Pick` with a superficially equivalent
`Record`, or accidentally wraps the string result in `Readonly`. A consumer's
`StoredDataOf<typeof repo>` either rejects a formerly legal dynamic write or changes a dynamic
`string`/`number` read to `unknown`, while CI remains green.

**What closes it:** add all four observables to the existing TY-8 area:

1. positive dynamic writes through mutable string and mutable number fixtures;
2. a readonly-number fixture whose dynamic read assigns to its precise value type and whose write is
   an error;
3. a precise string-index fixture whose dynamic read assigns to `string`; and
4. a precise number-index fixture whose dynamic read assigns to `number`.

Mutation-check mutable→readonly, readonly→mutable, and precise-value→`unknown` independently for
both domains. Each mutation must fail the corresponding TY-8 assertion, then `test:types` must be
green after revert.

---

## Major

None beyond B1.

---

## Minor / nits

### N1 — The migration guide still publishes the defect-causing built-in `Omit` spelling (`website/src/content/docs/guides/migration-v2-to-v3.md:103`)

The guide says query/vector surfaces accept `FieldPaths<Omit<S, 'id'>> | FieldPath` at line 104.
Actual public signatures use `FieldPaths<OmitId<S>>`, including
`src/core/QueryBuilder.ts:652,686,1993,2021` and
`src/vector/VectorQueryBuilder.ts:91,117,132`. Before #82 the two spellings happened to share the
target failure; after #82 they differ observably.

**Failure scenario:** a migrating consumer copies the documented type for
`{ id: string; name: string } & Record<string, unknown>`. Built-in `Omit` collapses `name`, so their
annotation rejects the declared path the library now supports.

**What closes it:** change the guide to `FieldPaths<OmitId<S>> | FieldPath` and briefly preserve the
declared-sibling/arbitrary-key distinction; rerun `check:docs` and `docs:build`.

### N2 — Emitted public JSDoc still recommends or describes built-in `Omit` as equivalent (`src/core/QueryBuilder.ts:172`)

`QueryFilterFactoryBase` recommends `StoredDataOf<typeof repo>` “or `Omit<Stored, 'id'>`” at
`src/core/QueryBuilder.ts:180–182`. The alternative reproduces #82's collapse for the exact indexed
intersection. `DataOf` / `StoredDataOf` comments at
`src/core/FirestoreRepository.ts:4533–4546` likewise say `Omit<'id'>` performs normalization even
though the aliases actually use `OmitId` and now distinguish declared/path removal from unavoidable
string-index value access.

**Failure scenario:** a consumer follows the emitted factory JSDoc and annotates a reusable
predicate with built-in `Omit`; `f.where('name', …)` rejects `name` as not assignable to `FieldPath`.
The extractor comments also overpromise that value-position `id` is absent on a string-indexed model.

**What closes it:** remove or explicitly limit the built-in-`Omit` alternative, name `OmitId` in
both extractor comments, and state the declared/path versus index-domain distinction. Rebuild to
verify emitted declarations.

### N3 — `notes.md` no longer carries the known unverified bounds (`docs/plans/issue-82-explicit-id-index-field-paths/notes.md:90`)

The first implementation commit recorded the local `firebase-admin@^14` limit, absent exact runtime
schema fixture, and exotic-index bounds under “Could-not-verify.” Commit `99fdaa2` removed that
section while marking `notes.md complete` at lines 127–144. Line 104 still labels `^14` as local, so
this is not a false gate claim, but it drops the explicit return-channel inventory required by the
plan/skill.

**Failure scenario:** a later implementer/reviewer reads only `notes.md` and treats the peer-major
matrix, runtime-schema reachability, or all exotic index combinations as verified.

**What closes it:** restore the three bounds or add an explicit “Could not verify” section pointing
to PLAN §5; keep `^12`, `^13`, and pinned-firestore CI legs marked unrun locally.

---

## Verified and holding

- **Core algorithm** — `src/utils/pathTypes.ts:44–78,243–247` remaps declared keys, omits declared
  `id`, and reconstructs existing string/number domains with `Pick`. The probe and declaration emit
  confirm declared precision, dynamic access, symbol handling, union distribution, and special-type
  identity.
- **T1 and all named path consumers** — the baseline-branch mutation produced 35 diagnostics across
  TY-1–TY-6 and TY-9. Core, repository mask/helper, collection-group, and vector surfaces inherit the
  shared change; the implementation diff did not edit their signatures.
- **T2/T4/T7/T8/T9/T10** — declared values flow into their precise types, dynamic/id values stay at
  the index type, `id`/arbitrary/typo/nonnumeric paths remain rejected, exact reusable predicate
  naming compiles, and `findNearest` retains the deliberately wider arbitrary-index-key contract.
- **Gate** — all 14 logical legs have fresh reviewer results. The environmental emulator stall was
  isolated, stopped, and every affected/skipped leg rerun; no code assertion failed.
- **ADR** — `docs/adr/0028-distributive-omit-id.md:103–112` appends all five #82 points without
  rewriting the original decision or #58 historical amendment. Bug-only bookkeeping correctly
  leaves ADR-0017, living footers, and the ADR index unchanged.
- **Named Starlight pages** — the four edited pages accurately distinguish declared typed paths,
  arbitrary keys, and value-position `id`; no v2 archive, README, or scope/capability edit leaked in.
- **Unplanned public surface** — an independent root-API probe covered `DataOf`, `StoredDataOf`, and
  `ReadOnlyTransactionalRepository`, including readonly combined indexes and transaction masks; it
  compiled with zero diagnostics. The documentation read of other unplanned surfaces produced N1/N2.
- **Deviations from the plan:** cutting/committing a cloud workflow branch is process-justified;
  the arbitrary vector-key `findNearest` control is a correct strengthening; the F1/F2/F3 follow-up
  was directionally correct but incomplete for T3, which is why B1 remains.
- **Tree restoration** — every reviewer mutation was reversed with `apply_patch`; `test:types` was
  rerun green after each revert and `src/utils/pathTypes.ts` had no working-tree diff.

---

## Not defects

- `StoredDataOf<ExplicitIdIndex>['id']` remaining the string-index value while `id` is absent from
  `FieldPaths` is the owner-approved D3 contract, not incomplete omission.
- ADR-0028's original limitation and #58 amendment still describe their historical moments. The new
  #82 amendment resolves them without rewriting accepted history.
- The unchanged Jest counts do not violate the review checklist: this type-only module is explicitly
  excluded from LCOV/Jest and the plan requires compiler tests instead.
- `prototype.patch` has whitespace reported by `git diff --check main...HEAD`, but the whole plan
  directory is review-only and must be deleted before merge; it does not ship or affect the gate.
- The plan's blanket sentence that every TY-1–TY-6 positive fails on the old helper does not apply to
  TY-6's intentional `KeysOf`/`findNearest` control. The implementation correctly kept that control
  compiling under both versions.

---

## Round 2+

Append here; do not rewrite Round 1 or renumber B1/N1–N3.
