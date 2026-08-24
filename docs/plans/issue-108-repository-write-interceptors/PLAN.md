# Implementation plan — repository write interceptors (issue #108, ADR-0040)

- **Implementer:** _unassigned — owner to fill_ (written for an agent/teammate, or a Cursor Cloud Agent on a fresh clone, with none of this investigation in context)
- **Reviewer:** Reggie O'Farrell
- **Baseline:** `main` @ `42314e8` — _fix(ci): skip rulesync bump when the lockfile is inside the
  cooldown (#111)_. Every `file:line` below is against that sha.
- **Branch:** `feat/108-write-interceptors` (already carries this plan directory — check it out, do
  not cut a new one)
- **Issue:** <https://github.com/reggieofarrell/flintfire/issues/108> — labels: `enhancement`
- **ADR:** [`docs/adr/0040-repository-write-interceptors.md`](../../adr/0040-repository-write-interceptors.md)
  — **status `Proposed`; this PR flips it to `Accepted`.** The ADR already exists: do **not** create
  a new one.
- **Acceptance criteria:** the issue states none as a checklist. Its coverage matrix (reproduced as
  §2.1) is the contract, and ADR-0040 Decisions 1–8 are the specification.

> **Read this first.** A meaningful part of this change is **already written and gate-green** in
> [`prototype.patch`](./prototype.patch) (247 insertions across 4 files): the group-aware
> `commitInChunks` refactor with all 7 call sites, the public types, `registerWriteInterceptor`, the
> mode union, `buildInterceptorWriter`, and the query-terminal refusal. It passes `test:types`,
> `lint`, `check:format`, `test:unit` (36/468), `test:integration:emulator` (37/548), `build`, and
> emits a valid `.d.ts`. It does **not** implement the feature: no interceptor is invoked at any
> write site, there is no `*InTransaction` join, no `bulkWrite`/`recursiveDelete` refusal, no
> `withMetadata` throw, no read-phase execution, **no interceptor propagation to the transaction
> clone**, and zero tests or docs. §6 tells you which parts to apply verbatim and which to write.

---

## §0 — How to use this plan

**Read order:** §1 (settled decisions) → §2 (scope) → §4 (traps — the highest-value section) → §3
(facts, as reference while you work) → §6 (spec) → §7 (sequence) → §8 (tests) → §9 (docs) → §10
(gate) → §11 (done).

**Copy-verbatim:** `prototype.patch` is copy-verbatim — `git apply` it (§7 step 2). The code blocks
in §6.3–§6.8 are copy-verbatim. §6.1–§6.2 are the **contract** for what the patch already contains:
signatures and invariants you must not refactor away, not a second copy of the bodies.

**Environment:** Node 24 (`.nvmrc`; the husky hooks hard-fail on any other major) and a JDK for
`test:integration:emulator`. The emulator is started for you by `firebase emulators:exec` — no
Firebase login or credentials.

**Re-running the probes** (all re-runnable from a clean clone, paths relative to repo root):

```bash
# P1 — the shared writer type (type-level, no emulator)
npx tsc --noEmit --strict --exactOptionalPropertyTypes --skipLibCheck \
  --moduleResolution bundler --module esnext --target es2022 \
  docs/plans/issue-108-repository-write-interceptors/probes/P1-shared-writer-type.ts
# expected: exit 0 (both the positive assignments AND the @ts-expect-error must hold)

# P2..P8 — boundary semantics against the emulator
firebase emulators:exec --project demo-firestoreorm-test --only firestore \
  "node docs/plans/issue-108-repository-write-interceptors/probes/P2-boundary-semantics.mjs"

# P8b — cross-Firestore-instance staging
firebase emulators:exec --project demo-firestoreorm-test --only firestore \
  "node docs/plans/issue-108-repository-write-interceptors/probes/P8b-cross-instance-staging.mjs"
```

**Notes back:** write `docs/plans/issue-108-repository-write-interceptors/notes.md` and **commit it
on this branch** — deviations from this plan, anything you could not verify, and your adversarial
self-review dispositions. That file is the return channel; do not write `review.md` (that slot is
reserved for an external reviewer).

---

## §1 — Owner-approved decisions

Settled with the owner before this plan was written. **Do not re-litigate.**

| id | Fork | Decision | Rejected alternative, and why |
| -- | ---- | -------- | ----------------------------- |
| **D1** | One PR, or split the `commitInChunks` refactor out? | **One PR** for all of ADR-0040. | Two PRs (refactor, then feature). Rejected by the owner: keeps the ADR flip atomic with the feature and matches #103's single-PR shape. Consequence you must accept: the review surface is large — keep the commit history legible (§7 names the commit boundaries). |
| **D2** | Public API spelling | **`repo.registerWriteInterceptor({ name, read?, write })`**, with a **positional** writer (`writer.update(repo, id, data)`). | `interceptWrites` (terser but less clear that this is a process-lifetime registration) and `onWrite` (rejected: reads as "one more hook", which is exactly the confusion ADR-0040 exists to resolve — hooks react, interceptors are atomic-or-refuse). `register…` also matches the ADR's own language and `assertNoBulkHooksRegistered`. |
| **D3** | Error type for the new refusals | **Plain `Error`** with a long, actionable message. | A new exported error class (`InterceptorUnsupportedError`). Rejected: every existing repository refusal is a plain `Error` (`assertNoBulkHooksRegistered` at `FirestoreRepository.ts:3338`, `assertExclusiveWriteResultOptions` at `:4165`), and a new class costs the full sweep — `Errors.ts`, `ErrorParser.ts`, `src/index.ts`, the express status mapping, `packageExports.unit.test.ts`, a `reference/errors.md` row — for what are programmer errors, not conditions a caller branches on. |

---

## §2 — Scope

### In scope

All eight ADR-0040 decisions: the registration API, mode-by-inference, the one shared writer
interface, the coverage matrix (§2.1), group-aware `commitInChunks`, the `withMetadata` throw, the
per-repository mode union, and additivity.

### Explicitly out of scope

- **The outbox (#80).** ADR-0040 unblocks it; it is not built here.
- **Chunked transactions for bulk paths.** ADR-0040 forward-compat: the refusal can become a
  capability additively later. Refuse now.
- **`updateAtomic(id, data, cb)` sugar.** ADR-0040 alternatives: "worth adding later as sugar over
  interceptors." Not now.
- **Field-style / ctor-body override detection** (`writeOverrideWarning.ts`'s known blind spot, cited
  in ADR-0043 as "deferred to ADR-0040's choke point"). ADR-0040 creates a choke point, but wiring
  the lazy override check into it is **separate work** — do not fold it in. The #103 warning's
  *message* does change (§9.4); its mechanism does not.
- **`HookContext` gaining a `tx` handle.** ADR-0040 calls this "cheap and worth doing on its own
  merits, but insufficient." Not this issue.

### 2.1 The coverage matrix (the contract)

| Path | write-only (batch) | read-capable (transaction) |
| ---- | ------------------ | -------------------------- |
| `create`, `createWithId`, `update`, `patch`, `upsert`, `delete` | ✅ runs | ✅ runs |
| `createInTransaction`, `createWithIdInTransaction`, `updateInTransaction`, `patchInTransaction`, `deleteInTransaction` | ✅ joins the caller's transaction | ✅ joins the caller's transaction |
| `bulkCreate`, `bulkCreateWithIds`, `bulkUpdate`, `bulkPatch`, `bulkDelete`, `query().update()`, `query().delete()` | ✅ chunked batch | ⚠️ **refuse** (`Error`) |
| `bulkWrite` | ❌ **refuse** (`Error`) | ❌ **refuse** (`Error`) |
| `recursiveDelete`, `recursiveDeleteCollection` | ❌ **refuse** (`Error`) | ❌ **refuse** (`Error`) |

Every cell above is reachable **only** on a repository with at least one interceptor registered
(ADR-0040 Decision 8). With none registered, nothing in this matrix changes behavior.

### 2.2 Where the issue body / ADR is stale or incomplete

Re-enumerated from `42314e8`. Four corrections:

1. **"`runUpdate` has 2 call sites, `commitInChunks` has 5"** (issue #108, via ADR-0043) — accurate,
   but the 5 counts the `.bind()`. `commitInChunks` has **4 direct call sites** plus **1 bound
   handoff** to the query builder, which itself has **2** call sites. Seven places change. See R1.
2. **ADR-0040 Decision 3: "`WriteBatch` and `Transaction` declare identical `create`/`update`/
   `delete` signatures."** Their **parameter lists** are byte-identical; their **return types are
   not** (`WriteBatch` vs `Transaction`). The natural reading — `Pick<WriteBatch, 'create' | …>` —
   **does not accept a `Transaction`**. See N1/P1 and trap **T1**.
3. **ADR-0040 Decision 1 names only `create`/`update`/`delete` on the restricted writer.** That set
   cannot write a sibling that may not exist yet — the counter and audit-row cases the ADR itself
   motivates. `set` is declared identically on both SDK classes (N1), so this plan adds it. This is
   an addition beyond the ADR's literal enumeration; see §5.4.
4. **The ADR's docs section anticipates a new ADR.** It does not need one: ADR-0040 **already
   exists** (`docs/adr/README.md:70`, status `Proposed`). Flip it; do not create ADR-0044.

---

## §3 — Verified facts

Every row was executed against `42314e8`. Ids are cited from §4, §6, §8 and §11.

### 3.1 The shared writer type (probe `P1-shared-writer-type.ts`, exit 0)

Extracted from `node_modules/@google-cloud/firestore/types/firestore.d.ts` (v8.6.0, the transitive
under `firebase-admin` 14.2.0):

| id | Claim | Observed |
| -- | ----- | -------- |
| **N1** | `Transaction` vs `WriteBatch` write signatures | `create`, `set` (×2 overloads), `update` (×2 overloads), `delete` have **byte-identical parameter lists** on both classes. Return types differ: `): Transaction;` vs `): WriteBatch;`. |
| **N1a** | A `void`/`unknown`-returning structural type accepts **both** | ✅ `const a1: StagingWriterA = batch` and `const a2: StagingWriterA = tx` both compile (return-type covariance to `unknown`). |
| **N1b** | `Pick<WriteBatch, 'create' \| 'update' \| 'delete'>` accepts a `Transaction` | ❌ **No.** The probe's `@ts-expect-error` on `const b2: StagingWriterB = tx` is *live* — remove it and `tsc` reports an unused-directive error, so the assignment genuinely fails. |
| **N2** | `firebase-admin/firestore` re-export allowlist | `Transaction`, `WriteBatch`, `WriteResult`, `Precondition`, `DocumentReference`, `SetOptions` are **all** re-exported (`node_modules/firebase-admin/lib/firestore/index.d.ts:25`). Every `from 'firebase-admin/firestore'` specifier §6 uses resolves. (Contrast: `VectorQuery` is *not* on that allowlist, which is why `src/vector/` hand-writes a local type — assume nothing.) |

### 3.2 Boundary semantics (probe `P2-boundary-semantics.mjs`, against the emulator)

| id | Expression | Observed |
| -- | ---------- | -------- |
| **P2** | `batch.create(b) ; batch.update(a) ; batch.delete(c) ; await batch.commit()` | `receipts 3`, 1:1 with enqueue order across **mixed** op kinds; every receipt carries `writeTime`; all three share **one** commit timestamp. → positional receipt mapping is sound within a chunk. |
| **P3** | a **501**-operation `WriteBatch` | **`COMMITTED`, receipts 501.** The emulator does **not** enforce the 500-op limit. → see trap **T7**. |
| **P4** | `tx.update(ref, …)` then `await tx.get(ref)` | `Error: Firestore transactions require all reads to be executed before all writes.` (plain `Error`, no `code`) |
| **P5** | `db.runTransaction(async tx => { tx.create(...); return 'v' })` | resolves to `"v"` only. `tx.create(...)` returns the **`Transaction`** — there is **no per-operation receipt inside a transaction**. Confirms ADR-0037's premise and forces §6.6. |
| **P6** | staging a write inside `{ readOnly: true }` | `Error: Firestore read-only transactions cannot execute writes.` (matches the existing comment at `FirestoreRepository.ts:4271`) |
| **P7** | stage primary + sibling, then `throw` from the transaction callback | `primary.exists=false sibling.exists=false` → **a failed attempt commits nothing.** ADR-0040's retry-safety claim holds; re-running an interceptor that only *stages* is safe. (Retry **re-entry** itself is already covered by `src/tests/integration/repository-write-outcomes.integration.test.ts:432` "I4", so it is not re-probed.) |

### 3.3 Cross-`Firestore`-instance staging (probe `P8b-cross-instance-staging.mjs`)

An interceptor addresses siblings through a *repository*, and nothing stops that repository being
built on a different `Firestore` instance. Verified with a control that proves the harness works:

| id | Step | Observed |
| -- | ---- | -------- |
| **P8** | same-project second instance, ref staged into instance 1's batch | `ACCEPTED at stage AND commit; receipts 1` |
| **P8b-control** | native `db2` write, read back through `db2` | `true` (harness sound) |
| **P8b** | `db2` (project `demo-other-project`) ref staged into `db1` (project `demo-firestoreorm-test`) batch | `ACCEPTED; receipts=1` with a real `writeTime` — **and then**: `db1: doc('x').exists=false`, `db2: doc('x').exists=false`. The write reported success and is readable through **neither** instance. |

**The SDK does not guard this and reports success.** → mandatory guard, trap **T6**. Bound in §5.2.

### 3.4 Type-level facts measured on the prototype

| id | Claim | Observed |
| -- | ----- | -------- |
| **N3** | Blast radius of the group-aware `commitInChunks` signature | Exactly **6** diagnostics: 4× `TS2345` at the direct call sites (`FirestoreRepository.ts` 1929 / 2051 / 2881 / 3294), 1× `TS2345` on the bound `FirestoreWriteBatch` handoff (`:3996`), 1× **cascading** `TS2719` at `:3996` ("Two different types with this name exist, but they are unrelated") which is *noise from* the bound-type mismatch and disappears with it. After fixing all 5 real sites: **0**. |
| **N4** | `stripInternal: true` + `@internal StagingTarget` referenced by the public `WriteGroup` | **The published `.d.ts` breaks**: `dist/core/FirestoreRepository.d.ts(315,31)` and `(316,46)` → `error TS2304: Cannot find name 'StagingTarget'`. And **`build`, `test:types`, `check:package` and `check:consumer` ALL PASS** (`check:consumer` compiles with `skipLibCheck: true` by design — `scripts/check-packed-consumer.mjs:111`). Fix: do **not** mark `StagingTarget` `@internal`; export it from `FirestoreRepository.ts` and simply do not re-export it from `src/index.ts`. Verified: after removing `@internal`, compiling the emitted `.d.ts` files with `--strict --module nodenext` yields **0** diagnostics. → trap **T2**. |
| **N5** | Adding a public method to `FirestoreRepository` | Breaks `src/tests/types/write-override-warning.type-test.ts(78,22)`: `error TS2344: Type 'false' does not satisfy the constraint 'true'` — its `Missing = Exclude<Keys, Write \| NonWrite>` guard is no longer `never`. Fix: add `'registerWriteInterceptor'` to the **`NonWrite`** union (`:43–74`), following the `'on'` precedent for registration methods. → trap **T5**. |
| **N6** | Cross-instance access to `private` members of another `FirestoreRepository` | **Compiles.** From inside the class body, `repo.writeCol()`, `repo.validateCreateData()`, `repo.validateUpdateData()`, `repo.sanitizeUpdateData()`, `repo.normalizeUpdateDataForMerge()`, `repo.assertNonEmptyUpdatePayload()`, `repo.validateId()` and `repo.db` are all reachable on a *differently-parameterized* instance. No `@internal` escape hatch is needed. |
| **N7** | The public shape infers as §6 prescribes | Verified with a scratch `src/tests/types/*.type-test.ts` (0 diagnostics, removed afterwards): on the `kind: 'delete'` branch `write.document` narrows to `FirestoreDocument<T>`; `R` flows `read` → `write.reads` with exact inference (`{ count: number }`); a sibling payload is checked against the **target** repo's write model (both `@ts-expect-error` directives fired, so the errors genuinely occur). |

### 3.5 Authoritative site enumeration

**`commitInChunks` — definition and all 7 places that change (R1):**

| id | Site | What it is |
| -- | ---- | ---------- |
| **R1.0** | `src/core/FirestoreRepository.ts:4107` | the definition (`private async commitInChunks`) |
| **R1.1** | `src/core/FirestoreRepository.ts:1929` | `bulkCreate` (`batch.set`, actions pushed at `:1921`) |
| **R1.2** | `src/core/FirestoreRepository.ts:2051` | `bulkCreateWithIds` (`batch.create`, `:2044`) |
| **R1.3** | `src/core/FirestoreRepository.ts:2881` | `runBulkBatchWrite` → `bulkUpdate` / `bulkPatch` (`batch.update`, `:2874` / `:2876`) |
| **R1.4** | `src/core/FirestoreRepository.ts:3294` | `bulkDelete` (`batch.delete`, `:3282–3292`) |
| **R1.5** | `src/core/FirestoreRepository.ts:3996` | the `.bind(this)` handoff into `query()` |
| **R1.6** | `src/core/QueryBuilder.ts:2208` | `query().update()` (actions built `:2204`) |
| **R1.7** | `src/core/QueryBuilder.ts:2280` | `query().delete()` (actions built `:2276–2278`) |

Plus the bound type `FirestoreWriteBatch` at `src/core/QueryBuilder.ts:42–44` and the private ctor
param at `:1866`.

**The five single-document physical write sites (R2)** — these gain the three-branch structure:

| id | Site | Call | Method |
| -- | ---- | ---- | ------ |
| **R2.1** | `FirestoreRepository.ts:1698` | `await docRef.set(validData)` | `create` |
| **R2.2** | `FirestoreRepository.ts:1814` | `await docRef.create(validData)` | `createWithId` |
| **R2.3** | `FirestoreRepository.ts:2659–2660` | `await docRef.update(payload[, precondition])` | `runUpdate` — the single seam covering **`update`, `patch`, and `upsert`'s update branch** |
| **R2.4** | `FirestoreRepository.ts:3049` | `await docRef.set(validData)` | `upsert`'s **create** branch |
| **R2.5** | `FirestoreRepository.ts:3146` | `await docRef.delete([precondition])` | `delete` |

**The five transaction staging sites (R3)** — these gain the "join the caller's transaction" path:

| id | Site | Call | Method |
| -- | ---- | ---- | ------ |
| **R3.1** | `FirestoreRepository.ts:4517 / 4519` | `tx.update(...)` | `updateInTransaction` (and `patchInTransaction`, which self-delegates at `:4543`) |
| **R3.2** | `FirestoreRepository.ts:4593` | `tx.set(...)` | `createInTransaction` |
| **R3.3** | `FirestoreRepository.ts:4652` | `tx.create(...)` | `createWithIdInTransaction` |
| **R3.4** | `FirestoreRepository.ts:4711 / 4713` | `tx.delete(...)` | `deleteInTransaction` |

**The three refusal sites (R4):**

| id | Site | Method |
| -- | ---- | ------ |
| **R4.1** | `FirestoreRepository.ts:3419` (guard alongside `:3423`) | `bulkWrite` |
| **R4.2** | `FirestoreRepository.ts:3614` | `recursiveDelete` |
| **R4.3** | `FirestoreRepository.ts:3655` | `recursiveDeleteCollection` |

**R5 — every delete path pre-reads its document**, so a `kind: 'delete'` interceptor can always be
handed the real document (not just an id): `delete` at `:3131` (`docRef.get()`), `bulkDelete` at
`:3252` (`db.getAll`), `query().delete()` from its own snapshot (`QueryBuilder.ts:2264`),
`deleteInTransaction` at `:4697` (`tx.get`). Verified by reading all four.

**R6 — the transaction clone copies hooks and nothing else.** `FirestoreRepository.ts:4284–4287`
copies `this.hooks` into `txRepo`. It is the **only** clone site that copies registrations;
`withSchema` / `subcollection` / `withSchemaArgs` build fresh repositories and deliberately carry no
hooks. → trap **T8**.

**R7 — `withMetadata` is accepted on 11 write surfaces**: `create` (`:1686`), `createWithId`
(`:1790`), `bulkCreate` (`:1881`), `bulkCreateWithIds` (`:1995`), `runUpdate`/`update` (`:2668`),
`patch` (`:2726`), `bulkUpdate`/`bulkPatch` via `runBulkBatchWrite` (`:2815`, `:2830`), `upsert`
(`:3000`), `delete` (`:3126`), `bulkDelete` (`:3227`). Under transaction mode the six
single-document ones must throw (§6.6); the five bulk ones are already refused wholesale by §6.5, so
their `withMetadata` is unreachable — do **not** add a second throw there.

### 3.6 Measured gate headroom

Parsed from `coverage/integration/lcov.info` against `scripts/check-coverage-gates.mjs` on the clean
baseline. "Room" = how many **additional uncovered** units the gate tolerates.

| id | Gate / file | Metric | Measured | Threshold | Room |
| -- | ----------- | ------ | -------- | --------- | ---- |
| **V3.1** | `FirestoreRepository.ts` | lines | 4674/4755 = 98.30% | 90% | **438** |
| **V3.2** | `FirestoreRepository.ts` | branches | 492/532 = 92.48% | 75% | **124** |
| **V3.3** | `FirestoreRepository.ts` | **functions** | 88/94 = 93.62% | 85% | **9** ← binding |
| **V3.4** | `QueryBuilder.ts` | lines | 2351/2434 = 96.59% | 90% | 178 |
| **V3.5** | `QueryBuilder.ts` | branches | 204/236 = 86.44% | 75% | 36 |
| **V3.6** | `QueryBuilder.ts` | **functions** | 63/63 = 100% | 95% | **3** ← binding |

**Read V3.3/V3.6 carefully.** Lines and branches have generous room; **functions do not**. LCOV
counts every arrow function as a function, and this change adds many (each `domain:` / `interceptor:`
staging closure, each writer member, each guard). The gate is safe **only if every new function is
executed by a test**. §8 requires that explicitly.

### 3.7 Baselines

| id | Measurement | Value |
| -- | ----------- | ----- |
| **V1** | `npm run test:unit` | **36 suites / 468 tests** passed |
| **V2** | `npm run test:integration:emulator` | **37 suites / 548 tests** passed |
| **V4** | `npm run check:docs` | `✓ documentation links OK (205 doc files scanned)` — **206 with this plan directory present**, which is what you will see. |
| **V5** | `npm run check:package` | `✓ Package content check passed (102 files, allowlist satisfied)` |

### 3.8 Docs / ADR bookkeeping facts

| id | Claim | Observed |
| -- | ----- | -------- |
| **B1** | ADR-0040 already exists | `docs/adr/README.md:70` — status **`Proposed`**, dated 2026-08-23. Flip to `Accepted`; do **not** create a new ADR. |
| **B2** | Is #108 in ADR-0017's deferral set? | **No.** ADR-0017 Decision 3 (`0017…md:43–49`) enumerates issues **#30–#41**. #108 is not among them → **no ADR-0017 amendment blockquote**, per the bookkeeping map's "issue is not a deferral" rule. |
| **B3** | Living-index footers | 15 files carry one (`0017`, `0023`–`0027`, `0029`–`0032`, `0034`, `0036`–`0038`, `README`). **Every one now reads "remaining deferral (#41)"** — a single item. #108 closes no ADR-0017 deferral, so **no footer changes.** Verified: `grep -rn "remaining deferral" docs/adr/*.md`. |
| **B4** | `scope-and-capabilities.md` "Deferred to v3.x" | Contains exactly **one** row (#41, Enterprise Pipeline) at `:57`; heading at `:50`. Interceptors were never a row there → **nothing to move** from "Deferred" to "Supported". |
| **B5** | Both READMEs | `grep -rn "denormaliz\|interceptor" README.md npm-readme.md` → **no matches**. Neither carries install / pitch / quick-start / peer-dep content this change touches → **declared unaffected**; do not run `readme-sync`. |
| **B6** | The docs section was pre-structured for this | `website/src/content/docs/guides/advanced/patterns.md:483` `## Enforced Denormalization` already has numbered subsections `### 1.` (`:489` facade), `### 2.` (`:563` why-not-subclass), `### 3.` (`:586` hooks), `### Choosing` (`:608`) — interceptors slot in as the new `### 1.` and the rest renumber. |
| **B7** | The #103 warning anticipates this | `src/core/writeOverrideWarning.ts:285–287` — "Points at the facade pattern (the mechanism that works today); when ADR-0040 interceptors ship, **only the redirect half of this string needs editing**." The redirect is at `:303`. |

### 3.9 Deliberately NOT changed — each with the fact id proving it is safe

| Surface | Why it is safe to leave alone | Proof |
| ------- | ----------------------------- | ----- |
| `src/core/CollectionGroup.ts` | The collection-group query builder has **no** `update()` / `delete()` — they are absent from the type, not present-and-throwing, so there is no write path to intercept. | `CollectionGroup.ts:139` ("**No `update()` / `delete()`.** They are absent from the type…") and `:155–159` — it extends `FirestoreQueryBuilderBase`, not `FirestoreQueryBuilder`, so it never receives the bound `commitInChunks`. Confirmed: `grep -n commitInChunks src/core/CollectionGroup.ts` → no matches. |
| `src/vector/**` | The vector surface is **read-only** — `VectorQueryBuilder` / `VectorSearch` expose `findNearest` and terminal reads, never a write terminal, so no `commitInChunks` and no write site. | `grep -n commitInChunks src/vector/*.ts` → no matches. `FirestoreWriteBatch` is not referenced there. |
| `src/express/index.ts` | D3 uses plain `Error` for every refusal, adding **no** new error class, so the status mapping is untouched. | §1 D3; `grep` of `Errors.ts` shows the 7 existing classes unchanged. |
| `src/core/Errors.ts`, `src/core/ErrorParser.ts` | Same reason — no new error class. `WriteOutcomeError`'s **shape** is unchanged; only the *values* `committedWrites`/`totalWrites` carry (see §6.2 invariant 4). | §1 D3; `Errors.ts:21–41` (the `WriteOutcome` union). |
| The `flintfire/vector` subpath re-export (`src/vector/index.ts`) | No new type is nameable from a `/vector` return signature — the interceptor types appear only on `FirestoreRepository` members, and `/vector` returns no repository. | The `VectorValueLike` precedent exists because `pathTypes` leaks through a `/vector` signature; nothing here does. |
| Living-index footers in 15 ADRs | #108 closes no ADR-0017 deferral. | **B2**, **B3** |
| `scope-and-capabilities.md` "Deferred to v3.x" table | Interceptors were never listed as deferred. | **B4** |
| `README.md`, `npm-readme.md` | Neither mentions denormalization, interceptors, or any changed install/peer content. | **B5** |
| The read-only transaction surface (`ReadOnlyTransactionalRepository`) | It is a **type-level** narrowing only; the runtime always hands a full repo, and the SDK rejects any staged write itself. Interceptors add no new runtime path here. | `FirestoreRepository.ts:4268–4272` + **P6** (exact SDK error message). |
| **`subcollection()`, `withSchema()`, `withSchemaArgs()`** — do **not** propagate interceptors | These build repositories for a **different collection and model**, so a parent's interceptor could not produce a valid payload for them; they deliberately carry no hooks either, and this plan keeps registration symmetric with hooks. Registration is **per repository instance** (ADR-0040 D1). **This is the near-miss created by T8**: that trap tells you to copy interceptors in `runInTransaction` — do not generalize it to every constructor-adjacent site. `runInTransaction` is different because `txRepo` is the *same* collection and model, standing in for `this`. | **R6** — `:4284–4287` is the only clone site that copies registrations. `runReadOnlyAt` needs no separate fix: it delegates to `runInTransaction` at `:4337`, so it inherits the §6.4 clone change. |
| `bulkWrite`'s `{ skipHooks: true }` escape hatch | It acknowledges *hooks* not firing. Interceptors are a **guarantee**, not a notification — there is no honest "skip" for them, so `bulkWrite` refuses unconditionally. | ADR-0040 Decision 4; §6.5 note. |

---

## §4 — Traps

Ordered by how badly a competent implementer gets this wrong. Each names its evidence and its
**silent**-failure mode.

**T1 — The obvious spelling of the shared writer type compiles, then fails only once transaction
mode is wired (N1, N1b, P1).** `WriteBatch` and `Transaction` have identical *parameter* lists but
different *return* types. `type StagingTarget = Pick<WriteBatch, 'create' | 'set' | 'update' |
'delete'>` type-checks perfectly while you build batch mode, and `Transaction` is **not assignable to
it**. The failure surfaces late, in transaction mode, and the tempting fix is `tx as unknown as
WriteBatch` — which silently discards the compiler's only check that both boundaries really do accept
the same calls. **The members must return `unknown`** (§6.1). Type-test `TT-1` asserts both
assignments directly, so a regression to `Pick<…>` fails `test:types`, not an integration test.

**T2 — Marking `StagingTarget` `@internal` breaks the published `.d.ts`, and the entire 14-leg gate
passes anyway (N4).** `tsconfig.json` sets `stripInternal: true`, so an `@internal` declaration is
removed from the emitted `.d.ts` — but the public `WriteGroup` still *references* it, leaving
`error TS2304: Cannot find name 'StagingTarget'` ×2 in `dist/core/FirestoreRepository.d.ts`. Measured:
`build` ✓, `test:types` ✓, `check:package` ✓, `check:consumer` ✓ — because `check:consumer` compiles
with `skipLibCheck: true` on purpose (`scripts/check-packed-consumer.mjs:109–111`). A strict consumer
would break on install and nothing here would have told you. **Do not put `@internal` on
`StagingTarget` or `WriteGroup`.** Keeping them un-re-exported from `src/index.ts` is what makes them
non-public; `@internal` is not needed for that. §10 adds an explicit declaration-emit leg.

**T3 — Concatenating receipts flat silently desynchronizes `bulkDelete`'s public contract (P2, R1.4).**
`bulkDelete`'s documented guarantee is `writeTimes.length === count` (`FirestoreRepository.ts:3180`),
built from `writeResults.map(r => r.writeTime)` at `:3300`. `bulkCreate` / `bulkCreateWithIds` /
`runBulkBatchWrite` index receipts **positionally** (`writeResults[index]!.writeTime`). If
`commitInChunks` returns *all* physical receipts instead of **domain receipts only**, then with one
interceptor registered `bulkDelete` returns twice as many `writeTimes` as documents deleted, and
`bulkCreate({ withMetadata: true })[i].writeTime` becomes the receipt of some *interceptor's* write.
No error, no type change — just wrong timestamps. `commitInChunks` **must** collect only the
`domain` index of each group (§6.2 invariant 2). Tests `I-6`/`I-7` assert lengths *and* identity.

**T4 — A chunk boundary must fall between groups, never inside one (ADR-0040 Decision 5).** The
existing loop increments a flat counter and commits at exactly 500 (`:4118–4131`). Ported naively to
groups, a domain write can land in chunk N with its interceptor write in chunk N+1 — destroying the
one guarantee the feature sells, and only under load above 500 operations. The new loop must commit
*before* staging a group that would not fit whole. Corollary: a group whose own size (`1 + K`)
exceeds 500 can never fit and must **throw** rather than loop forever or split. Tests `I-8`, `U-4`.

**T5 — Adding `registerWriteInterceptor` breaks an existing type-test, and the plausible fix is wrong
(N5).** `src/tests/types/write-override-warning.type-test.ts` partitions **every**
`keyof FirestoreRepository` into `Write | NonWrite` and fails when one is unclassified (`TS2344` at
`:78`, from the `Missing` alias at `:75`). The error is loud; the trap is the fix. `registerWriteInterceptor` belongs in **`NonWrite`**
(`:43–74`), following `'on'` — the other registration method. Adding it to `Write`, or to
`REPOSITORY_WRITE_METHODS` in `writeOverrideWarning.ts:21–40`, would make the #103 warning fire on
subclasses that merely register an interceptor, and would list it as a "bypassed" path in
`BYPASS_PATHS` — inventing a leak that does not exist.

**T6 — An interceptor writing through a repository on a different `Firestore` instance loses the
write silently, and the SDK reports success (P8, P8b).** Measured: staging a `db2` (project
`demo-other-project`) `DocumentReference` into a `db1` batch was **accepted**, `commit()` returned a
real `writeTime`, and the document was readable through **neither** instance — with a control
proving the harness worked. There is no SDK guard. Because interceptors are the first API that makes a
*foreign* repository reachable at a write boundary, this plan requires a reference-equality guard on
every writer and reader member (§6.3). Test `I-11` asserts the throw; without the guard it would
"pass" a naive happy-path test while destroying data in production.

**T7 — The emulator does not enforce the 500-op batch limit, so a chunk test written as "expect 501
to fail" passes vacuously (P3).** A 501-operation batch **committed**, returning 501 receipts. Any
chunk-boundary test must assert on *observable grouping* — receipt counts and commit timestamps
(`P2` showed one commit shares a single `writeTime`, so distinct timestamps ≈ distinct commits) — or
by spying on `db.batch()`. Do **not** write a test that expects an error at 501. Test `I-8` specifies
the observable.

**T8 — Forgetting the transaction clone silently disables every interceptor inside
`runInTransaction` (R6).** `FirestoreRepository.ts:4284–4287` copies `this.hooks` into `txRepo` and
copies **nothing else**. `txRepo` is a fresh `FirestoreRepository`, so its `interceptors` array is
empty: every `updateInTransaction` / `createInTransaction` / `deleteInTransaction` call on the repo
handed to the callback would run **zero** interceptors, with no error — precisely the silent bypass
ADR-0040 exists to eliminate, reintroduced at the one site where atomicity was already free.
**`prototype.patch` has this bug** (it adds `private interceptors` but does not extend the clone).
§6.4 fixes it. Test `I-5` covers it; it must fail on the unpatched clone.

**T9 — In transaction mode all interceptor reads must precede all writes (P4, ADR-0040
Consequences).** `Error: Firestore transactions require all reads to be executed before all writes.`
The repository must run **every** interceptor's `read` phase, *then* stage the primary write, *then*
stage the interceptor writes. This plan makes the `write` phase **synchronous** (`=> void`, §6.1) so
the ordering is enforced by construction — you cannot `await` a read from inside it. Do not "fix" a
future need by widening `write` to `Promise<void>`; put the I/O in `read`. Test `I-9`.

**T10 — `withMetadata` must throw only under transaction mode, and the message must name the
interceptor (ADR-0040 Decisions 6–7, P5, R7).** `db.runTransaction` exposes no per-operation receipt
(P5: `tx.create` returns the `Transaction`), so a `writeTime` there would be fabricated. Two ways to
get this wrong: throwing under **batch** mode too (batch receipts survive — `withMetadata` must keep
working, and `bulkCreate`'s positional receipts depend on it), or throwing a message that does not
say *which* interceptor forced the union, leaving the caller unable to find the cause. Tests `I-10`,
`U-5`.

**T11 — `upsert`'s existence pre-read sits outside the boundary and must stay there (R2.3/R2.4).**
`upsert` reads at `:3021` (`await this.getById(id)`) and *then* branches to `runUpdate` or an inline
`set`. Under batch mode the read cannot join a `WriteBatch` at all. Do **not** "improve" this by
moving the read inside a transaction under batch mode, and do not change which hook family each
branch fires. The TOCTOU window between that read and the commit is **pre-existing** behavior
(ADR-0019); this issue does not touch it. Anti-instruction in §7.

---

## §5 — Could not verify / bounds

**5.1 — `check:consumer` covered one peer major only.** The local run exercised the dev
`firebase-admin` (**14.2.0**, with `@google-cloud/firestore` 8.6.0 hoisted). CI fans out over `^12` /
`^13` / `^14` plus a pinned-firestore `^12` leg via `FLINTFIRE_ADMIN_VERSION` /
`FLINTFIRE_FIRESTORE_VERSION`. **N1's signature extraction is from 8.6.0 only.** If `Transaction` and
`WriteBatch` diverged in an older Firestore major, `StagingTarget` could reject one of them there.
The `unknown` return type makes that unlikely (it only needs parameter compatibility), but it is
**unverified for `^12` / `^13`**. Watch the CI matrix legs, and if one fails, report it rather than
widening `StagingTarget` to `any`.

**5.2 — P8b's *exact* emulator filing behavior is emulator-specific.** What is verified is the
decision-relevant part: the SDK accepts a cross-instance ref, `commit()` reports success with a real
`writeTime`, and the document is readable through neither instance. Where the emulator actually filed
those bytes (`db1.listDocuments()` returned the name `x` while `db1.doc('x').get()` reported
`exists=false`) is an emulator artifact I did not chase. Production behavior may differ in detail; it
is at best undefined. The guard is justified either way — do not weaken it to a `console.warn` on the
grounds that the probe ran against an emulator.

**5.3 — Not prototyped.** `prototype.patch` covers the group-aware refactor and the type scaffolding
only. **Unverified by execution:** interceptor invocation at all five single-document sites (R2), the
`*InTransaction` join (R3), the three refusals (R4), the `withMetadata` throw, read-phase execution
and transaction wrapping, and the tx-clone fix. Those are prose-specified in §6 and every symbol they
use has been compiled, but their *runtime* behavior rests on §8's tests, not on a prototype run.

**5.4 — `set` on the restricted writer is a planner addition, not an owner ruling.** ADR-0040
Decision 1 names `create`/`update`/`delete`. I added `set` because `update` fails the whole batch on
a not-yet-existing sibling, which breaks the counter and audit-row cases the ADR motivates; `set` is
declared identically on both SDK classes (N1) so it costs nothing structurally. The owner has **not**
explicitly ruled on it. It is additive and safe to drop: delete the `set` member from
`InterceptorWriter` and its implementation. Flag it in `notes.md` so it gets an explicit review.

**5.5 — Interceptor *ordering and composition* is left at "registration order, sequential".** With
several interceptors registered, this plan runs them in registration order (matching `runHooks` at
`:1310–1312`) and fails fast on the first throw. ADR-0040 does not specify ordering. Nothing here
depends on it, but it becomes a public contract the moment it ships — document it (§9.3) so it is a
decision rather than an accident.

**5.6 — Carried over and still deferred:** the `writeOverrideWarning` field-style/ctor-body blind
spot (ADR-0043 → "ADR-0040's choke point"). ADR-0040 creates the choke point; wiring the lazy check
into it is **not** done here (§2 out of scope). Say so in `notes.md` so it is not mistaken for
shipped.

---

## §6 — API specification

Every code block below was compiled as written (§12). Every `from '…'` specifier resolves (N2).

### 6.1 Contract — the types (already in `prototype.patch`, `src/core/FirestoreRepository.ts`)

`prototype.patch` adds these above the `FirestoreRepository` class JSDoc. **Do not re-type them —
apply the patch.** This is the contract you must not refactor away:

1. **`StagingTarget`'s members return `unknown`, and it is NOT `@internal`.** Both properties are
   load-bearing: `unknown` is what lets a `Transaction` satisfy it (T1/N1b), and the absence of
   `@internal` is what keeps the emitted `.d.ts` valid under `stripInternal` (T2/N4). It is exported
   from `FirestoreRepository.ts` but **not** re-exported from `src/index.ts`, which is what makes it
   non-public.
2. **`WriteGroup` is `{ domain, interceptor }`** — one domain write plus the writes that must commit
   with it. `domain` is singular by construction; `interceptor` is a `readonly` array.
3. **`InterceptedWrite<T, W, WO>` is a discriminated union on `kind`**, and the `'delete'` member
   carries `document: FirestoreDocument<T>` rather than a payload — sound because every delete path
   pre-reads (R5). N7 verified the narrowing.
4. **`WriteOnlyInterceptor.read` is `?: undefined`**, not merely absent. This is what makes the
   `registerWriteInterceptor` overload pair discriminate instead of silently picking the first.
5. **`write` returns `void`, never `Promise<void>`** — the structural enforcement of T9.
6. **`InterceptorWriter` / `InterceptorReader` members are generic over the *target* repository's
   parameters**, so a sibling payload is checked against that repo's write model (N7).

Public re-exports added to `src/index.ts` (in the existing
`} from './core/FirestoreRepository.js';` block): `InterceptedWriteKind`, `InterceptedWrite`,
`InterceptorReader`, `InterceptorWriter`, `WriteInterceptor`, `WriteOnlyInterceptor`,
`ReadCapableInterceptor`. **`StagingTarget` and `WriteGroup` are deliberately NOT re-exported.**

### 6.2 Contract — group-aware `commitInChunks` (already in `prototype.patch`)

```ts
private async commitInChunks(
  groups: WriteGroup[],
  operation: string,
): Promise<FirebaseFirestore.WriteResult[]>
```

Four invariants the patch establishes. Preserve all four:

1. **It refuses transaction mode up front**, naming `operation` — this single check is what
   implements the whole "⚠️ refuse" row of §2.1 for both the four fixed-batch helpers and the two
   query terminals. The `operation` parameter exists only so the message can name the caller; the
   labels are `'bulkCreate()'`, `'bulkCreateWithIds()'`, `'bulkUpdate()/bulkPatch()'`,
   `'bulkDelete()'`, `'query().update()'`, `'query().delete()'`.
2. **It returns domain receipts only**, via the per-chunk `domainIndices` map
   (`chunkResults[i]!`) — never a flat concat (T3).
3. **It commits before staging a group that would not fit**, so no group straddles a boundary (T4).
4. **`totalWrites` counts physical writes** (`groups.reduce((n, g) => n + 1 + g.interceptor.length, 0)`),
   not groups. This keeps `WriteOutcomeError`'s documented wording honest — `Errors.ts:14–15` says
   "`committedWrites` counts successful document **write actions**". A caller with an interceptor
   registered therefore sees larger numbers than before; that is the observable change ADR-0040
   accepts under "Capacity", and it is reachable only on an opted-in repository.

`FirestoreWriteBatch` in `src/core/QueryBuilder.ts:42–45` becomes
`(groups: WriteGroup[], operation: string) => Promise<FirebaseFirestore.WriteResult[]>`, and
`query()` at `:3996` binds a labelled wrapper instead of `.bind(this)`.

**Still to write** (the patch leaves every `interceptor` array empty): each of R1.1–R1.4 and
R1.6–R1.7 must populate `interceptor` from §6.3's collector instead of `[]`.

### 6.3 The interceptor runner — to write

Add to `src/core/FirestoreRepository.ts`, beside the prototype's `buildInterceptorWriter`. The
`assertSameDb` guard inside `buildInterceptorWriter` is already in the patch (T6) — **extend it to
`InterceptorReader` too**, which the patch does not include.

```ts
/**
 * Collects the writes every registered interceptor wants to stage alongside one domain write.
 *
 * Returns the staging closures, never a committed write: the caller decides whether they land in a
 * `WriteBatch` or a `Transaction`. In transaction mode the read phases have already run (see
 * {@link runInterceptorReads}) because Firestore requires all reads before all writes (T9).
 */
private collectInterceptorWrites(
  write: InterceptedWrite<T, W, WO>,
  reads: ReadonlyMap<string, unknown>,
): ((target: StagingTarget) => void)[] {
  if (this.interceptors.length === 0) return [];
  const staged: ((target: StagingTarget) => void)[] = [];
  for (const interceptor of this.interceptors) {
    staged.push(target => {
      const writer = this.buildInterceptorWriter(target);
      // Cast: the two interceptor flavours differ only in whether `reads` is present, and the
      // union's call signatures are not callable jointly. `reads` is keyed by interceptor name and
      // is `undefined` for a write-only interceptor, which is exactly its declared shape.
      (interceptor.write as (ctx: unknown) => void)({
        write,
        writer,
        reads: reads.get(interceptor.name),
      });
    });
  }
  return staged;
}

/**
 * Runs every read-capable interceptor's read phase, before any write is staged (T9).
 *
 * Keyed by interceptor name so each `write` phase receives its own read result. Names are required
 * to be unique at registration for exactly this reason.
 */
private async runInterceptorReads(
  write: InterceptedWrite<T, W, WO>,
  tx: FirebaseFirestore.Transaction,
): Promise<ReadonlyMap<string, unknown>> {
  const reads = new Map<string, unknown>();
  for (const interceptor of this.interceptors) {
    if (typeof interceptor.read !== 'function') continue;
    reads.set(interceptor.name, await interceptor.read({
      write,
      reader: this.buildInterceptorReader(tx),
    }));
  }
  return reads;
}
```

**`registerWriteInterceptor` must reject a duplicate `name`** (plain `Error`, D3) — `runInterceptorReads`
keys by name, so a duplicate would silently hand one interceptor another's read result. Add that
check to the prototype's one-line body.

### 6.4 The three branches at each single-document write site — to write

R2.1–R2.5 each become: no interceptor → today's direct `docRef.*` call, unchanged; batch mode → a
one-group `commitInChunks`; transaction mode → `db.runTransaction`. The shape, using `runUpdate`
(R2.3) as the worked example — the other four differ only in the domain closure and the
`InterceptedWrite` they build:

```ts
// ... after `this.assertNonEmptyUpdatePayload(...)` and the precondition branch at :2655-2657
const mode = this.interceptorMode();
const intercepted: InterceptedWrite<T, W, WO> = { kind: 'update', id, data: validData };

if (mode === 'none') {
  // UNCHANGED path — exactly today's code (:2658-2660).
  const writeResult = precondition
    ? await docRef.update(writePayload as any, precondition)
    : await docRef.update(writePayload as any);
  /* ...existing after-hook + return handling... */
} else if (mode === 'batch') {
  const [writeResult] = await this.commitInChunks(
    [
      {
        domain: (target: StagingTarget) =>
          precondition
            ? target.update(docRef, writePayload as any, precondition)
            : target.update(docRef, writePayload as any),
        interceptor: this.collectInterceptorWrites(intercepted, new Map()),
      },
    ],
    'update()',
  );
  /* ...existing after-hook + return handling, writeResult is the DOMAIN receipt... */
} else {
  this.assertNoWriteMetadataUnderTransactionMode(options, 'update()');
  await this.db.runTransaction(async tx => {
    const reads = await this.runInterceptorReads(intercepted, tx);   // ALL reads first (T9)
    if (precondition) tx.update(docRef, writePayload as any, precondition);
    else tx.update(docRef, writePayload as any);                      // then the primary write
    const target = tx as StagingTarget;
    for (const stage of this.collectInterceptorWrites(intercepted, reads)) stage(target);
  });
  /* ...existing after-hook + return handling; NO writeTime is available (P5)... */
}
```

Per-site domain closures and payloads:

| Site | Domain closure | `InterceptedWrite` |
| ---- | -------------- | ------------------ |
| R2.1 `create` | `target.set(docRef, validData)` | `{ kind: 'create', id: docRef.id, data: validData }` |
| R2.2 `createWithId` | `target.create(docRef, validData)` | `{ kind: 'create', id, data: validData }` |
| R2.3 `runUpdate` | `target.update(docRef, writePayload[, precondition])` | `{ kind: 'update', id, data: validData }` |
| R2.4 `upsert` create branch | `target.set(docRef, validData)` | `{ kind: 'create', id, data: validData }` |
| R2.5 `delete` | `target.delete(docRef[, precondition])` | `{ kind: 'delete', id, document: docData }` |

**R3.1–R3.4 (`*InTransaction`) join the caller's transaction** — they already have a `tx`, so there
is no mode branch and no `runTransaction`: run `runInterceptorReads(intercepted, tx)` **before** the
existing `tx.*` staging line, then stage the interceptor writes after it. Batch-mode and
transaction-mode interceptors behave identically here (§2.1), which is why `interceptorMode()` is not
consulted. `withMetadata` does not exist on these helpers (ADR-0037), so no throw is needed.

**The transaction clone (T8, R6).** Extend `FirestoreRepository.ts:4284–4287` to carry interceptors
alongside hooks:

```ts
// Preserve registered interceptors so a write through the transaction repo keeps the same
// enforcement guarantee (T8). Without this, every *InTransaction call on `txRepo` runs ZERO
// interceptors — the silent bypass ADR-0040 exists to eliminate.
txRepo.interceptors = [...this.interceptors];
```

### 6.5 The three refusals — to write

```ts
/**
 * Refuses a write path that cannot host a shared atomic boundary, naming the interceptors that
 * would otherwise be silently skipped.
 *
 * Mirrors {@link assertNoBulkHooksRegistered}, with one deliberate difference: there is no
 * `{ skipHooks: true }`-style acknowledgement. A hook is a notification and may be waived; an
 * interceptor is a guarantee, so "skip it" is not an honest option (ADR-0040 Decision 4).
 */
private assertNoInterceptorsRegistered(operation: string, reason: string): void {
  if (this.interceptors.length === 0) return;
  const names = this.interceptors.map(i => `'${i.name}'`).join(', ');
  throw new Error(
    `${operation} cannot run write interceptor(s) ${names}: ${reason} Use the single-document ` +
      'write methods (or the fixed-batch helpers, for a write-only interceptor), or unregister ' +
      'the interceptor.',
  );
}
```

Call sites and reasons:

| Site | Call |
| ---- | ---- |
| R4.1 `bulkWrite` (`:3419`, beside the existing `:3423` guard) | `this.assertNoInterceptorsRegistered('bulkWrite()', 'BulkWriter commits per operation, so there is no shared atomic boundary.')` |
| R4.2 `recursiveDelete` (`:3614`, after `validateId`) | `this.assertNoInterceptorsRegistered('recursiveDelete()', 'db.recursiveDelete streams name-only snapshots across collections this repository does not model, so no honest interceptor payload exists.')` |
| R4.3 `recursiveDeleteCollection` (`:3655`, first statement) | same reason string, operation `'recursiveDeleteCollection()'` |

R4.1's guard is **unconditional** — it must run even when `{ skipHooks: true }` is passed, so place
it *outside* the `if (options?.skipHooks !== true)` at `:3423`.

### 6.6 The `withMetadata` throw — to write

```ts
/**
 * Rejects `{ withMetadata: true }` while a transaction-mode interceptor is active.
 *
 * A transaction exposes no per-operation receipt (probe P5: `tx.create(...)` returns the
 * `Transaction`), so any `writeTime` here would be fabricated or transaction-level. Same reasoning
 * that keeps `withMetadata` off the `*InTransaction` helpers (ADR-0037). The message names the
 * interceptor that forced the mode union, because the caller who hits this typically did not
 * register it (ADR-0040 Decision 7).
 */
private assertNoWriteMetadataUnderTransactionMode(
  options: { withMetadata?: boolean } | undefined,
  operation: string,
): void {
  if (options?.withMetadata !== true) return;
  const forcing = this.interceptors
    .filter(i => typeof i.read === 'function')
    .map(i => `'${i.name}'`)
    .join(', ');
  throw new Error(
    `${operation} cannot return { withMetadata: true }: write interceptor(s) ${forcing} declare a ` +
      'read phase, so this write runs in a transaction, and Firestore exposes no per-operation ' +
      'write receipt inside a transaction. Remove the read phase to run in a write batch, or drop ' +
      'withMetadata.',
  );
}
```

Call it in the **transaction branch only** of R2.1–R2.5 (six surfaces once `patch` and `upsert` are
counted through `runUpdate`). Do **not** call it in the batch branch — batch receipts survive and
`withMetadata` must keep working there (T10). Do **not** add it to the bulk helpers — §6.2 invariant 1
already refuses them wholesale, so it would be unreachable (R7).

### 6.7 The member-partition type-test fix — to write

`src/tests/types/write-override-warning.type-test.ts`, in the **`NonWrite`** union (`:43–74`),
alphabetically between `'readSchema'` (`:66`) and `'runInTransaction'` (`:67`):

```ts
  | 'registerWriteInterceptor'
```

Do **not** add it to `Write` and do **not** add it to `REPOSITORY_WRITE_METHODS` (T5).

### 6.8 Size estimate

| Area | Files | ± lines |
| ---- | ----- | ------- |
| `prototype.patch` (apply verbatim) | 4 | +247 / −33 |
| §6.3–§6.6 runner, branches, refusals, throw | 1 (`FirestoreRepository.ts`) | +420 |
| Tests (§8) | 4 new + 1 edited | +780 |
| Docs + ADR (§9) | 6 | +180 |
| **Total** | **~14** | **≈ +1,630 / −35** |

---

## §7 — Implementation sequence

Order matters where stated.

1. **Check out the existing branch — do not create one.** `git fetch && git checkout
   feat/108-write-interceptors && git rebase origin/main`. This plan directory is already on it. If
   `main` moved, **re-run the §3.5 enumeration** (`grep -n "commitInChunks\|await docRef\." …`) and
   correct any drifted line numbers before editing. Confirm Node 24 (`node --version`).
2. **Apply the prototype.** `git apply docs/plans/issue-108-repository-write-interceptors/prototype.patch`,
   then `npm run test:types && npm run lint && npm run test:unit` — all three must be clean before
   you write a line. This is your known-good floor. Commit:
   `refactor(repository): make commitInChunks group-aware (#108)`.
   **Then read every `PROTOTYPE (#108)` marker and replace it with real JSDoc** —
   `grep -rn "PROTOTYPE (#108)" src/` must return **nothing** before you open the PR.
3. **Fix the transaction clone (T8) immediately**, at `FirestoreRepository.ts:4284–4287`. Do this
   *before* wiring any write site: the patch ships this bug, and every later step you test through
   `runInTransaction` will silently pass without it.
4. **Write the runner** (§6.3) — `collectInterceptorWrites`, `runInterceptorReads`,
   `buildInterceptorReader`, the duplicate-name check, and the `assertSameDb` extension to the
   reader. Before the write sites, so they have something to call.
5. **Wire the four fixed-batch helpers + two query terminals** (R1.1–R1.4, R1.6–R1.7): replace each
   `interceptor: []` with `this.collectInterceptorWrites(...)`. Do these **before** the
   single-document sites — they are the simplest consumers of the runner and they prove receipt
   mapping (T3) early, while the failure is easy to localize.
6. **Wire the five single-document sites** (§6.4, R2.1–R2.5), one at a time, running
   `test:integration:emulator` after each. `runUpdate` (R2.3) covers three public methods at once, so
   do it first and confirm `update`, `patch`, **and `upsert`'s update branch** all route through it.
7. **Wire the five `*InTransaction` helpers** (R3.1–R3.4). Reads before writes (T9).
8. **Add the refusals** (§6.5) and the `withMetadata` throw (§6.6).
9. **Fix the member-partition type-test** (§6.7). `npm run test:types`.
10. **Write the tests** (§8), then **mutation-check the load-bearing ones**: `git stash` the source
    change, confirm each new test **fails**, `git stash pop`. Record which ones you checked in
    `notes.md`.
11. **Docs and ADR bookkeeping** (§9). Includes the built-HTML grep for `:::` asides.
12. **Full gate** (§10). Report failures honestly, with output.

### Anti-instructions — do NOT

- **Do not commit unless asked**, beyond the commits §7 names. Do not push, tag, or open the PR
  without being asked.
- **Do not create ADR-0044.** ADR-0040 exists (B1); flip its status.
- **Do not add an ADR-0017 amendment blockquote, and do not touch any living-index footer.** #108 is
  not in the #30–#41 deferral set (B2), and all 15 footers already read "remaining deferral (#41)"
  (B3). Copying the deferral pattern here is a real, previously-shipped failure mode.
- **Do not mark `StagingTarget` or `WriteGroup` `@internal`** (T2/N4). It breaks the published
  `.d.ts` while the whole gate stays green.
- **Do not spell the writer as `Pick<WriteBatch, …>`, and do not cast `tx as WriteBatch`** (T1/N1b).
- **Do not add `registerWriteInterceptor` to `REPOSITORY_WRITE_METHODS` or to `BYPASS_PATHS`**
  (`writeOverrideWarning.ts:21–40`, `:59–245`) — it is a registration, not a write, and listing it
  would invent a bypass that does not exist (T5).
- **Do not touch `src/core/CollectionGroup.ts` or `src/vector/**`.** Both are read-only surfaces with
  no write terminal and no `commitInChunks` (§3.9). They look in scope and are not.
- **Do not propagate interceptors in `subcollection()`, `withSchema()`, or `withSchemaArgs()`.** T8
  tells you to copy them in `runInTransaction` — that is the **only** clone site, because `txRepo`
  stands in for `this` on the same collection and model (R6, §3.9). A subcollection is a different
  collection with a different model; a parent's interceptor could not build a valid payload for it.
- **Do not widen the interceptor `write` phase to `Promise<void>`** (T9). Put I/O in `read`.
- **Do not move `upsert`'s existence pre-read inside a boundary, and do not change which hook family
  each branch fires** (T11). The TOCTOU window is pre-existing (ADR-0019) and out of scope.
- **Do not extract the interceptor code into a new module.** `src/core/writeOverrideWarning.ts` sits
  in **neither** coverage gate; a new module would too, silently exempting the write path's most
  load-bearing new logic from both gates. Keep it in `FirestoreRepository.ts`, which the integration
  gate owns (§3.6).
- **Do not add a `{ skipInterceptors: true }` escape hatch to `bulkWrite`.** Hooks may be waived;
  a guarantee may not (§6.5).
- **Do not write a chunk-boundary test that expects a 501-op batch to fail** — it passes vacuously
  (T7/P3).
- **Do not fold in the `writeOverrideWarning` field-style detection** (ADR-0043's deferral to "the
  ADR-0040 choke point"). Out of scope (§2); note it in `notes.md`.
- **Do not claim the `^12` / `^13` `check:consumer` legs pass** — you cannot run them locally (§5.1).
- **Do not run `readme-sync`.** Both READMEs are verified unaffected (B5).

---

## §8 — Test specification

Every test below must **fail on the unfixed baseline** — §7 step 10 requires you to prove it by
`git stash`. A test that passes both ways guards nothing.

### 8.1 Gate ownership by changed path

| Changed path | Owning gate | Command |
| ------------ | ----------- | ------- |
| `src/core/FirestoreRepository.ts` | **integration** | `test:coverage:gate:integration` |
| `src/core/QueryBuilder.ts` | **integration** | `test:coverage:gate:integration` |
| `src/index.ts` | **unit** | `test:coverage:gate:unit` (thresholds `100/100/65`) |
| `src/tests/types/*.type-test.ts` | neither (type-only) | `test:types` |

**Paths in neither gate: none.** All runtime code lands in `FirestoreRepository.ts` /
`QueryBuilder.ts`, both integration-gated — that is why §7's anti-instructions forbid extracting a
new module.

### 8.2 Type tests — `src/tests/types/write-interceptors.type-test.ts` (new)

| id | Asserts | Observable when it fails | Guards |
| -- | ------- | ----------------------- | ------ |
| **TT-1** | Both `const a: StagingTarget = batch` and `const b: StagingTarget = tx` compile; a `Pick<WriteBatch, 'create' \| 'set' \| 'update' \| 'delete'>` alias **rejects** `tx` (asserted with a live `@ts-expect-error`). | `test:types` reports an assignment error, or an *unused* `@ts-expect-error` — the latter is what fires if someone "fixes" `StagingTarget` back to a `Pick`. | **T1** |
| **TT-2** | On `kind: 'delete'`, `write.document` is `FirestoreDocument<T>`; on `'create'` it is `CreateOutput<WO>`; on `'update'` it is `UpdateInput<W>` — via `ExpectEqual`/`AssertTrue` (the ADR-0041 asserted-guard pattern; a bare `type X = …` emits nothing). | `TS2344: Type 'false' does not satisfy the constraint 'true'`. | §6.1 (3) |
| **TT-3** | `R` flows from `read` to `write`'s `reads` with exact inference, and a write-only interceptor's `write` context has **no** `reads`. | `TS2344`, or a missing-property error. | §6.1 (4) |
| **TT-4** | A sibling payload is checked against the **target** repo's write model — two live `@ts-expect-error`s for an unknown key and a wrong value type. | Unused-directive error. | §6.1 (6) |
| **TT-5** | `StagingTarget` and `WriteGroup` are **not** importable from `'flintfire'` (live `@ts-expect-error` on the root import), while the seven public types are. | Unused-directive error if someone re-exports them from `src/index.ts`. | §6.1 |

Existing type-test to edit: `write-override-warning.type-test.ts` (§6.7). Its `Missing` guard is the
regression test for T5 — no new test needed.

### 8.3 Unit tests — `src/tests/unit/writeInterceptors.unit.test.ts` (new)

Mocked `Firestore`; no emulator. These cover the pure decision logic.

| id | Asserts | Observable when it fails | Guards |
| -- | ------- | ----------------------- | ------ |
| **U-1** | `interceptorMode()` is `'none'` with none registered, `'batch'` with only write-only ones, `'transaction'` as soon as **any** registered interceptor has a `read` — including when a write-only one was registered first. | Mode string mismatch. | ADR-0040 D7 |
| **U-2** | With no interceptor registered, `create` / `update` / `delete` call `docRef.set` / `.update` / `.delete` **directly** and `db.batch()` / `db.runTransaction` are **never** called (jest mock call counts). | A batch/transaction spy records a call → additivity (D8) broken. | ADR-0040 D8 |
| **U-3** | `registerWriteInterceptor` throws on a **duplicate `name`**, and the message contains the name. | No throw → `runInterceptorReads` would hand one interceptor another's read result. | §6.3 |
| **U-4** | `commitInChunks` throws when a **single group's** size (`1 + K`) exceeds 500, and the message names the operation. | Infinite loop, or a split group. | **T4** |
| **U-5** | `assertNoWriteMetadataUnderTransactionMode` throws only when `withMetadata === true` **and** mode is `'transaction'`; the message names **only** the read-capable interceptors (not write-only ones registered alongside). | Throws in batch mode (breaks `withMetadata`), or a message with no name. | **T10** |
| **U-6** | The three refusals throw with the operation name and every interceptor name; `bulkWrite` refuses **even with `{ skipHooks: true }`**. | `skipHooks` smuggles a write past a guarantee. | §6.5 |

> `src/index.ts`'s unit gate is `functions: 65` and it is an export-only barrel — the seven new type
> re-exports are **types**, contributing no functions and no lines. No `packageExports.unit.test.ts`
> change is required for type-only exports; confirm by reading that file before deciding (it asserts
> **runtime** exports).

### 8.4 Integration tests — `src/tests/integration/repository-write-interceptors.integration.test.ts` (new)

| id | Asserts | Observable when it fails | Guards |
| -- | ------- | ----------------------- | ------ |
| **I-1** | Batch mode: **each of the six** single-document writes (`create`, `createWithId`, `update`, `patch`, `upsert`-create, `upsert`-update, `delete`) commits the sibling document atomically. Read both documents back. | The sibling is absent → the guarantee does not hold on that path. | §2.1 row 1 |
| **I-2** | Transaction mode: the same six, with a read-capable interceptor whose `read` value influences the sibling payload. | Sibling absent, or carries the pre-read value. | §2.1 row 1 |
| **I-3** | An interceptor that **throws** aborts the write: the primary document is **unchanged/absent** too. | Primary committed without its sibling → refusal is not a refusal. | ADR-0040 D4, **P7** |
| **I-4** | Batch mode, all five fixed-batch helpers + `query().update()` + `query().delete()`: every domain document **and** every sibling lands. | A sibling missing on one path → the partial sweep this plan exists to prevent. | §2.1 row 3 |
| **I-5** | Inside `runInTransaction`, a write through the callback's `repo` **runs the interceptor** (sibling lands). | Sibling absent → the T8 silent bypass. Must fail against `prototype.patch` unfixed. | **T8** |
| **I-6** | `bulkCreate(rows, { withMetadata: true })` with one interceptor registered returns **exactly `rows.length`** receipts, and each `writeTime` equals the one observed for **that** document (`getByIdWithUpdateTime`) — not an interceptor's. | Length doubles, or timestamps belong to sibling writes. | **T3** |
| **I-7** | `bulkDelete(ids, { withMetadata: true })` with one interceptor returns `writeTimes.length === count`. | Length > count → the documented contract at `:3180` breaks. | **T3** |
| **I-8** | Chunk boundaries fall between groups: with 1 interceptor (group size 2) and **260 documents** (520 physical writes → 2 chunks), every domain document **and** every sibling exists, and the domain `writeTime`s form exactly **two** distinct commit timestamps with no group split across them. **Do not assert an error at 501** (T7/P3). | Three-plus timestamp clusters, or a missing sibling at the boundary. | **T4**, **T7** |
| **I-9** | Transaction mode: an interceptor whose `read` runs correctly does **not** hit the SDK ordering error; and a hand-built `*InTransaction` flow where the caller writes *before* the ORM runs reads surfaces `Firestore transactions require all reads to be executed before all writes` (P4's exact message). | No error where one is expected, or a different message. | **T9**, **P4** |
| **I-10** | `{ withMetadata: true }` **throws** under transaction mode on all six single-document surfaces, and **succeeds** under batch mode on the same six. | Throws in batch mode, or silently returns a fabricated `writeTime`. | **T10** |
| **I-11** | An interceptor writing through a repository built on a **second `Firestore` instance** throws before any commit, and neither document exists afterwards. | The write "succeeds" and is readable nowhere (P8b). | **T6** |
| **I-12** | `bulkWrite` (with and without `{ skipHooks: true }`), `recursiveDelete`, and `recursiveDeleteCollection` each **throw**, message naming the operation and the interceptor; and each **succeeds normally** with no interceptor registered. | A silent bypass — the exact hole ADR-0040 calls "the only silent bypass in the matrix". | §6.5 |
| **I-13** | `query().update()` / `query().delete()` / all four fixed-batch helpers **throw** under **transaction** mode, message naming the operation. | A read-capable interceptor silently running per-chunk. | §2.1 row 3 ⚠️ |
| **I-14** | With **no** interceptor registered, a representative write on every path behaves byte-identically to today (receipts, hook order, return shapes). | Any diff → additivity (D8) broken for existing consumers. | ADR-0040 D8 |
| **I-15** | Two interceptors registered: both run, in **registration order**, and the first to throw stops the second (assert the second never staged). | Ordering unspecified in practice → §5.5 becomes an accident. | §5.5 |

### 8.5 Trap-coverage matrix — every trap, at every site it can occur

| Trap | Site it can occur at | Test that fails | The observable |
| ---- | -------------------- | --------------- | -------------- |
| **T1** | `StagingTarget` declaration | `TT-1` | `test:types` error, or an unused `@ts-expect-error` |
| **T2** | `StagingTarget` / `WriteGroup` JSDoc | §10 **declaration-emit leg** (no jest test can see this) | `TS2304: Cannot find name 'StagingTarget'` when compiling `dist/**/*.d.ts`. **No suite reaches this** — the gate leg is the guard. |
| **T3** | `bulkCreate` | `I-6` | receipt count ≠ row count; `writeTime` ≠ the document's own |
| **T3** | `bulkCreateWithIds` | `I-6` (parameterized over both) | same |
| **T3** | `bulkUpdate` / `bulkPatch` | `I-6` (parameterized) | same |
| **T3** | `bulkDelete` | `I-7` | `writeTimes.length !== count` |
| **T4** | `commitInChunks` loop, > 500 physical writes | `I-8` | >2 distinct commit timestamps, or a missing sibling at the boundary |
| **T4** | single oversized group | `U-4` | no throw / hang |
| **T5** | `write-override-warning.type-test.ts` | its own `Missing` guard | `TS2344` |
| **T6** | `InterceptorWriter` (4 members) | `I-11` | write reports success, document readable nowhere |
| **T6** | `InterceptorReader` (`get`) | `I-11` (second case: read through a foreign repo) | read resolves against the wrong instance |
| **T7** | `I-8`'s own design | `I-8` asserts timestamp clustering, **not** an error | a test that expects a 501-op failure passes on the emulator regardless (P3) |
| **T8** | `runInTransaction` clone `:4284` | `I-5` | sibling absent; **must fail against unfixed `prototype.patch`** |
| **T9** | transaction branch of R2.1–R2.5 | `I-9` | SDK ordering error surfaces where reads run late |
| **T9** | R3.1–R3.4 (`*InTransaction`) | `I-9` second case | same message, at the caller's transaction |
| **T10** | six single-document surfaces | `I-10` | throw in batch mode / fabricated `writeTime` in transaction mode |
| **T10** | message names the interceptor | `U-5` | message lacks the forcing interceptor's name |
| **T11** | `upsert` | `I-1`/`I-2` (both branches asserted separately) | wrong hook family fires, or the pre-read moves |

**Note the T2 row.** No test in any suite can observe a broken `.d.ts` — `test:types` checks
`src/`, and `check:consumer` uses `skipLibCheck: true` by design (N4). That is why §10 adds a
declaration-emit leg rather than a test.

### 8.6 Gate headroom

Measured, not reasoned (§3.6). Lines (438 room) and branches (124 room) are comfortable. **Functions
are the binding constraint: 9 for `FirestoreRepository.ts`, 3 for `QueryBuilder.ts`.** This change
adds far more than 9 arrow functions (every `domain:`/`interceptor:` closure, four writer members,
one reader member, three guards, two runner methods). The gate holds **only** because I-1/I-2/I-4
execute every staging closure and I-11/I-12/I-13/U-3/U-4/U-5/U-6 execute every guard. If
`test:coverage:gate:integration` fails on **functions**, the cause is an unexercised closure, not a
threshold that needs lowering — **do not lower a threshold** (`scripts/check-coverage-gates.mjs:196–201`).

---

## §9 — Docs and ADR bookkeeping

Enumerate-and-check. This is the repo's main defect mode.

### 9.1 ADR — flip, do not create

- **`docs/adr/0040-repository-write-interceptors.md:3`** — `- **Status:** Proposed` → `Accepted`.
- **`docs/adr/README.md:70`** — the `Status` cell `Proposed` → `Accepted`. Use **ADR-0043's plain
  `Accepted`** (`:73`) rather than ADR-0041's "Accepted (v3.x, pending merge/release)" (`:71`):
  ADR-0043 is the closest precedent (also 2026-08-24, also shipped into 3.0.0 as a merged feature).
- **Two `> Amendment (3.0.0, issue #108)` blockquotes are required** — this is settled by §2.2, not
  conditional on what you find:
  1. **Decision 3** — its "identical `create` / `update` / `delete` signatures" wording is imprecise:
     the *parameter lists* are identical, the *return types* are not, so the shared writer type must
     return `unknown` and a `Pick<WriteBatch, …>` will not accept a `Transaction` (N1, N1b, T1).
  2. **Decision 1** — the restricted writer ships `set` in addition to `create` / `update` / `delete`,
     because `update` cannot address a sibling that does not exist yet (§5.4).

  Add a third only if you deviate further. Write all of them in ADR-0040's own voice, and do **not**
  edit its original Decision text — amendment blockquotes are historical snapshots.
- **NOT required, with proof:** no new ADR (B1); no ADR-0017 amendment (B2); no living-index footer
  change in any of the 15 files that carry one (B3).

### 9.2 Starlight — `guides/advanced/patterns.md`

The section was pre-structured for exactly this (B6).

- **`:483` `## Enforced Denormalization`** — insert a new **`### 1. Register a write interceptor`**
  before the current `### 1.` at `:489`, and renumber: facade `### 1.`→`### 2.`, why-not-subclass
  `### 2.`(`:563`)→`### 3.`, hooks `### 3.`(`:586`)→`### 4.`.
- **`:608` `### Choosing`** — rewrite the table. Interceptors become the answer for "atomic **and**
  enforced on every path"; the facade demotes to "read-dependent composition / narrowing the
  surface"; hooks stay "eventual consistency is fine".
- **`:29`** — the table-of-contents anchor `- [Enforced denormalization](#enforced-denormalization)`
  is unchanged (the `##` heading text does not move).
- Document, in the new §1: mode-by-inference, the **coverage matrix (§2.1) including every
  refusal**, the `withMetadata` interaction (T10), the capacity consequence
  (`floor(500 / (1 + K))` documents per chunk, so `WriteOutcomeError` `partially-committed` becomes
  reachable below 500 documents), the same-`Firestore`-instance requirement (T6), and **registration
  order / fail-fast** (§5.5).

### 9.3 Starlight — the rest

- **`reference/repository.md`** — add a `### Write interceptors` subsection under `## Writes`
  (`:226`), covering `registerWriteInterceptor`, both interceptor shapes, and the writer/reader
  surface. Cross-link `guides/advanced/patterns/#1-register-a-write-interceptor`. Also update the
  `static suppressWriteOverrideWarning` prose at **`:105–113`**, which currently points only at the
  facade.
- **`guides/concepts/lifecycle-hooks.md`** — two edits. **`:88–99`** ("Three write paths deliberately
  fire nothing") must say that `recursiveDelete` / `recursiveDeleteCollection` now **throw** when an
  interceptor is registered — this is the ADR's headline: the matrix's only *silent* bypass becomes
  loud. **`:180–183`** repeats the claim and needs the same qualification. Also state plainly that a
  hook is **not** a substitute for an interceptor (`HookContext` still carries no `tx`).
- **`reference/types.md`** — add rows for the seven newly exported types.
- **`reference/scope-and-capabilities.md`** — add write interceptors to the **supported** matrix
  (above the `## Deferred to v3.x` heading at `:50`). **Do not touch the "Deferred to v3.x" table** —
  its single row is #41 at `:57`, and interceptors were never listed there (B4).
- **`guides/migration-v2-to-v3.md`** — grep it; interceptors are new API in an unreleased 3.0.0, so
  there is nothing to migrate *from*. If the grep is empty, **say so in `notes.md`** rather than
  leaving it implicit.
- **Do not touch the frozen `docs/2.0/` archive.**

### 9.4 `writeOverrideWarning.ts` — the redirect half only (B7)

`src/core/writeOverrideWarning.ts:303`:

```ts
    `Prefer a facade that owns the write paths (see "Enforced denormalization" in the docs). ` +
```

becomes a pointer to `registerWriteInterceptor` first, with the facade retained as the
read-dependent fallback. The warning itself **stays** — interceptors add a correct path, they do not
remove the wrong one (issue #108, "Retires the last resort in #103"). Also update the `@see ADR-0040`
note at `:10` (currently "future choke-point extension") and the `formatWriteOverrideWarning` JSDoc
at `:285–287`, which says "when ADR-0040 interceptors ship, only the redirect half of this string
needs editing" — that is now.

> **An existing unit test forbids the new wording, deliberately.**
> `src/tests/unit/writeOverrideWarning.unit.test.ts:235–241` asserts
> `expect(message).not.toMatch(/interceptor/i)` under the comment _"D4 durability: do not point at
> unshipped ADR-0040 interceptors."_ It will fail the moment you edit the redirect — that is the test
> working as designed. **Invert the assertion** (assert the message now _does_ name
> `registerWriteInterceptor`) and update the comment to say interceptors have shipped. Do **not**
> delete the test, and do not weaken it to a bare `toBeDefined()` — it is the only guard on the
> redirect's content. Keep the `expect(message).toContain('Enforced denormalization')` assertion at
> `:238`: the docs section keeps that heading (§9.2).

### 9.5 The `:::` aside trap — mandatory

`website/**/*.md` is **prettier-exempt** (`.prettierignore`), and a `:::note` / `:::tip` /
`:::caution` whose closing fence lands on a content line renders as a literal `:::` on the published
page. **Neither `check:docs` nor `docs:build` catches it.** This shipped live twice (#33, #34).
`patterns.md:553` already contains a `:::tip[...]` block — match its exact blank-line style. After
`npm run docs:build`, grep the built HTML:

```bash
grep -rn ':::' website/dist/ | grep -v '\.js\|\.css\|\.map' | head
```

**Expected result: no rows.** A row means an aside fence leaked into rendered content.

### 9.6 Verified-unaffected — declare, do not leave implicit

`README.md` and `npm-readme.md` (B5); `src/core/CollectionGroup.ts`; `src/vector/**`;
`src/express/index.ts`; `src/core/Errors.ts`; `src/core/ErrorParser.ts` (§3.9).

---

## §10 — Gate and commit

Run the full 14 legs. Report real output; if a leg fails, say so with the output rather than
re-characterizing it.

```bash
npm run test:types && npm run lint && npm run check:format && npm run test:unit && npm run test:integration:emulator && npm run test:unit:coverage && npm run test:coverage:gate:unit && npm run test:integration:coverage && npm run test:coverage:gate:integration && npm run build && npm run check:package && npm run check:consumer && npm run check:docs && npm run docs:build
```

Plus two legs this change specifically requires:

```bash
# 15. Declaration emit — the ONLY thing that catches T2/N4. Nothing in the 14 legs does.
npx tsc --noEmit --strict --module nodenext --moduleResolution nodenext \
  dist/core/FirestoreRepository.d.ts dist/core/QueryBuilder.d.ts dist/index.d.ts
# expected: exit 0, no output. TS2304 here = a @internal type leaked into a public signature.

# 16. Rendered-aside check (§9.5), after docs:build
grep -rn ':::' website/dist/ | grep -v '\.js\|\.css\|\.map' | head
# expected: NO ROWS.
```

Also run, and expect **no rows** from each:

```bash
grep -rn "PROTOTYPE (#108)" src/          # every marker replaced with real JSDoc (§7 step 2)
grep -rn "actions: ((batch: FirebaseFirestore.WriteBatch) => void)\[\]" src/   # old flat shape gone
```

And re-run all three probes (§0) — P1 must exit 0; P2/P8b's observations must match §3.2/§3.3.

### Baseline suite counts (measured on `42314e8`, clean tree)

| Suite | Baseline | Requirement |
| ----- | -------- | ----------- |
| unit | **36 suites / 468 tests** | must **go up** (§8.3 adds one suite) |
| integration | **37 suites / 548 tests** | must **go up** (§8.4 adds one suite) |
| `check:docs` | 205 files clean-tree / **206 with this plan directory** | may rise; must stay `✓` |
| `check:package` | 102 files, allowlist satisfied | must stay `✓` |

Type tests contribute no suite/test count — they are checked by `tsc`, not jest.

### Commit

Conventional Commits (commitlint runs on `commit-msg`). §7 names an intermediate refactor commit;
the feature commit:

```
feat(repository): guarantee write interceptors run in the primary write's atomic boundary (#108)
```

### Breaking-or-not ruling

**Not breaking.** Every new code path requires a `registerWriteInterceptor` call that no existing
consumer makes (ADR-0040 D8), and `U-2`/`I-14` assert the zero-interceptor path is unchanged.
`commitInChunks` is `private`, and `WriteGroup`/`StagingTarget` are not re-exported from
`src/index.ts`, so no public type changes shape. Two observable changes exist and both are gated on
opting in: `WriteOutcomeError`'s `committedWrites`/`totalWrites` count physical writes (§6.2
invariant 4), and `partially-committed` becomes reachable below 500 documents (ADR-0040
"Capacity"). This folds into the unreleased **3.0.0**, so no `BREAKING CHANGE:` footer.

---

## §11 — Definition of done

- [ ] **§1** — API spelled `registerWriteInterceptor` with a positional writer (D2); every refusal
      is a plain `Error` (D3); one PR (D1).
- [ ] **§2** — every cell of the §2.1 matrix implemented or refused; nothing from "out of scope"
      folded in.
- [ ] **§3** — line numbers re-verified after the §7 step 1 rebase; every "deliberately NOT changed"
      surface still untouched.
- [ ] **§4** — T1…T11 each have a passing test (or, for T2, the §10 leg 15), and each was
      mutation-checked per §7 step 10.
- [ ] **§5** — `notes.md` records: the `^12`/`^13` `check:consumer` legs not run locally (5.1), the
      `set` addition flagged for review (5.4), the registration-order contract (5.5), and the
      still-deferred field-style override check (5.6).
- [ ] **§6** — `prototype.patch` applied; **`grep -rn "PROTOTYPE (#108)" src/` returns nothing**;
      the tx clone carries interceptors (T8); `StagingTarget`/`WriteGroup` are not `@internal` and
      not re-exported.
- [ ] **§7** — steps run in order; **nothing in the anti-instruction list violated**.
- [ ] **§8** — new type / unit / integration suites added; the trap-coverage matrix (§8.5) holds in
      both directions; both coverage gates pass **on functions** without any threshold edit.
- [ ] **§9** — ADR-0040 flipped to `Accepted` in both the file and `README.md:70`; no new ADR; no
      ADR-0017 amendment; no living-index footer touched; `patterns.md` renumbered; `repository.md`,
      `lifecycle-hooks.md`, `types.md`, `scope-and-capabilities.md` updated;
      `writeOverrideWarning.ts` redirect updated; **the §9.5 built-HTML `:::` grep returned no rows**.
- [ ] **§10** — all 14 legs plus legs 15–16 pass, with output pasted; both suite counts went up;
      all three probes re-run and matching.
- [ ] **`git rm -r docs/plans/issue-108-repository-write-interceptors/`** — the plan directory is
      removed in this PR, in a **final cleanup commit after review** (while it is present the
      reviewer can read `notes.md` and the plan in Files-changed; once deleted the directory nets to
      zero there). Review → delete → merge.

---

## §12 — Pre-handoff verification

What I ran before pushing this plan, and what came back.

| Check | Command / method | Result |
| ----- | ---------------- | ------ |
| §6.1/§6.2 blocks compile as written | the scoped prototype's own `npm run test:types` leg | **0 diagnostics.** Reached after fixing exactly the 5 real sites N3 predicted (6 initial diagnostics incl. 1 cascading TS2719). |
| §6.2's 2-arg `commitInChunks` compiles | same, after wiring `operation` through all 7 sites + the bound type | **0 diagnostics** |
| The public shape infers as §6.1 claims | scratch `src/tests/types/*.type-test.ts` with `ExpectEqual`/`AssertTrue` + 3 `@ts-expect-error`s; removed after | **0 diagnostics**, all three directives live (N7) |
| Every `from '…'` specifier §6 uses | read `node_modules/firebase-admin/lib/firestore/index.d.ts:25` re-export allowlist, then compiled the imports | `Transaction`, `WriteBatch`, `WriteResult`, `Precondition`, `DocumentReference`, `SetOptions` all resolve from `'firebase-admin/firestore'` (N2) |
| **Declaration emit** | `npm run build`, then `tsc --strict --module nodenext` over `dist/**/*.d.ts` | **Found a real defect (N4/T2):** `@internal` + `stripInternal` → `TS2304` ×2 in the published `.d.ts`, with `build`/`test:types`/`check:package`/`check:consumer` **all green**. Re-verified **0** diagnostics after dropping `@internal`. |
| Prototype against the real gate | `test:types`, `lint`, `check:format`, `test:unit`, `test:integration:emulator`, `build` | all pass — **36/468** unit, **37/548** integration, i.e. unchanged, confirming the refactor is behavior-preserving |
| Every §9 / §10 shell command | ran each | `check:docs` ✓ 205 files; `check:package` ✓ 102 files; `grep -rn "denormaliz\|interceptor" README.md npm-readme.md` → **no rows (expected — proves B5)**; `grep -rn "remaining deferral" docs/adr/*.md` → 15 files, **all "#41"** (expected — proves B3); `grep -n commitInChunks src/core/CollectionGroup.ts src/vector/*.ts` → **no rows (expected — proves §3.9)** |
| Baseline suite counts | both suites, clean tree | unit **36 suites / 468 tests**; integration **37 suites / 548 tests** |
| Gate headroom | parsed `coverage/integration/lcov.info` against `scripts/check-coverage-gates.mjs` | §3.6 — **functions is the binding constraint** (9 / 3 room), lines and branches comfortable |
| Probes re-run from repo root | P1, P2–P8, P8b | P1 exit 0; P2–P8 and P8b as recorded in §3.2/§3.3 |
| Unresolved conditionals | re-read §§2–9 | **None.** Resolved by reading: `stripInternal` (tsconfig.json:11); `check:consumer`'s `skipLibCheck` (`scripts/check-packed-consumer.mjs:111`); whether #108 is an ADR-0017 deferral (`0017…md:43–49` → no); whether any living-index footer needs editing (grep → no); whether the READMEs are affected (grep → no); whether a `scope-and-capabilities` row moves (`:57` → no); whether `CollectionGroup`/`vector` have write terminals (grep → no). Two checks are deliberately left to the implementer as **greps with stated expected results**, not conditionals: `packageExports.unit.test.ts` (§8.3 note) and `migration-v2-to-v3.md` (§9.3). |

**Bounds on this table:** §5.3 is the honest limit — the prototype covers the refactor and the type
scaffolding, so §6.3–§6.6's *runtime* behavior is specified and compiled but not executed. §5.1's
`^12`/`^13` consumer legs were not run.

---

## Appendix — probe inventory

| File | What it proves |
| ---- | -------------- |
| `probes/P1-shared-writer-type.ts` | N1a/N1b — an `unknown`-returning structural type accepts both `WriteBatch` and `Transaction`; `Pick<WriteBatch, …>` rejects `Transaction`. Backs **T1**. Promoted to committed test **TT-1**. |
| `probes/P2-boundary-semantics.mjs` | P2 (receipts 1:1 across mixed ops), P3 (emulator does not enforce 500 → **T7**), P4 (reads-before-writes message → **T9**), P5 (no per-op receipt in a transaction → §6.6), P6 (read-only transaction message), P7 (a failed attempt commits nothing). |
| `probes/P8b-cross-instance-staging.mjs` | P8b — cross-`Firestore`-instance staging is silently accepted and the write is readable through neither instance. Backs **T6**. Promoted to committed test **I-11**. |
| `prototype.patch` | The gate-green group-aware refactor + type scaffolding (§6.1–§6.2). **Contains the T8 bug on purpose-of-record** — it does not propagate interceptors to the transaction clone; §7 step 3 fixes it first. |
