# ADR-0040: Repository write interceptors (enforced denormalization primitive)

- **Status:** Proposed
- **Date:** 2026-08-23
- **Deciders:** Reggie O'Farrell
- **Related:** [ADR-0032](0032-bulkwriter-high-throughput-writes-and-recursive-delete.md)
  (`bulkWrite` / recursive delete), [ADR-0035](0035-hook-delivery-and-write-outcome-errors.md) (hook
  delivery, `HookContext`), [ADR-0037](0037-write-metadata-opt-in.md) (`withMetadata`),
  [ADR-0038](0038-collection-wide-recursive-delete.md),
  [transactional outbox design](../design/transactional-outbox.md),
  [#80](https://github.com/reggieofarrell/flintfire/issues/80),
  [v3 docs audit](../audits/2026-08-23-website-docs-audit.md) (finding H1)

## Context

The published docs advertise **enforced denormalization** — "guarantee that base document updates
always include connected denormalized writes" — as a supported pattern, implemented by subclassing
`FirestoreRepository` and overriding write entry points. The v3 docs audit established that no
mechanism in the library actually delivers this. The findings below are emulator-verified, not
inferred.

**Overriding a write method intercepts almost nothing.** An instrumented subclass is reached by 2 of
9 update paths, 1 of 8 create paths, and 1 of 7 delete paths. `patch` → `this.update` is the
**only** internal self-delegation in the class; `upsert` leaks on both sides (its update branch
calls private `runUpdate`, its create branch inlines the write), and the callback repo from
`runInTransaction` is a base `FirestoreRepository`, not the subclass. The documented example also
fails to compile (`TS2416`): `update` / `create` / `delete` are overloaded, so an override returning
a union is not assignable to the base member.

**Hooks cover more but cannot be atomic.** With the per-document and bulk hook registered,
`beforeUpdate`+`beforeBulkUpdate` reach 8 of 9 paths, create 6 of 7, delete 4 of 7 — and `bulkWrite`
_throws_ rather than silently bypassing (`assertNoBulkHooksRegistered`). But `HookContext` carries
`event` / `execution` / `retryable` / `attempt` and **no transaction handle**, so a hook cannot join
the caller's transaction. Hooks give coverage without atomicity. `recursiveDelete` /
`recursiveDeleteCollection` fire no hooks **and do not throw** — the only silent bypass in the
matrix.

**The write surface is far more concentrated than the override coverage suggests.** There are 12
physical commit sites. Five are single-document writes with no atomic boundary today (`create`,
`createWithId`, `runUpdate`, `upsert`'s create branch, `delete`); six already commit atomically
through the private `commitInChunks` (four fixed-batch helpers plus the query builder's `update()` /
`delete()`, which receive it as a bound dependency); three cannot host a boundary at all
(`bulkWrite` via `BulkWriter`, and the two `db.recursiveDelete` paths). Notably `runUpdate` is a
single seam covering `update`, `patch`, **and** `upsert`'s update branch — the three an override
cannot reach.

**Firestore constrains which boundary is usable.** `WriteBatch` exposes `create()` (preserving
`createWithId`'s create-only semantics), `update(…, precondition?)` and `delete(…, precondition?)`
(preserving `lastUpdateTime`), and `commit(): Promise<WriteResult[]>` — so **write receipts
survive** and `{ withMetadata: true }` keeps working. `db.runTransaction<T>` returns only the
callback's value: **no per-operation receipt exists**, which is why `*InTransaction` helpers already
reject `withMetadata` (ADR-0037). `Transaction` and `WriteBatch` declare **identical** signatures
for `create` / `update` / `delete`, and `Transaction` adds `get` / `getAll`.

**Two existing invariants constrain the implementation.** `commitInChunks` maps receipts to actions
**positionally** (`writeResults[index]!.writeTime`), and `bulkDelete` depends on
`writeTimes.length === count`. It also chunks a **flat** action list at exactly 500, so a chunk
boundary can fall between a domain write and a write that must commit with it.

## Decision

We will add **repository write interceptors**: a registered callback that the repository guarantees
runs inside the primary write's atomic boundary on every write path it supports, or else **refuses
the write**. Both execution modes ship in **one release**.

1. **Interceptors are registered per repository and receive a restricted writer.** The callback gets
   the validated payload, the document id, the operation kind, and a writer that can only _enqueue_
   writes — it cannot commit, cannot access the underlying batch or transaction, and cannot read
   unless it declares a read phase. Sibling writes are addressed through a repository (so the target
   repository's validator applies) rather than a raw `DocumentReference`.

2. **The execution mode is inferred from the callback shape, not declared.** An interceptor with a
   `read` phase requires a transaction; one without runs in a write batch. A `mode` flag would be a
   second source of truth that can contradict the callback, and inference makes the cost
   self-documenting — you pay transaction semantics only when you asked to read.

3. **One writer interface backs both modes.** Because `WriteBatch` and `Transaction` declare
   identical `create` / `update` / `delete` signatures, an interceptor's write phase is
   mode-agnostic: the same code runs under either boundary with no adaptation.

4. **Coverage is explicit, and every gap is a refusal rather than a silent skip.**

   | Path                                                            | write-only (batch)                | read-capable (transaction)        |
   | --------------------------------------------------------------- | --------------------------------- | --------------------------------- |
   | `create`, `createWithId`, `update`, `patch`, `upsert`, `delete` | ✅                                | ✅                                |
   | `*InTransaction` helpers                                        | ✅ joins the caller's transaction | ✅ joins the caller's transaction |
   | fixed batches + `query().update()` / `query().delete()`         | ✅ chunked batch                  | ⚠️ refuse                         |
   | `bulkWrite`                                                     | ❌ throw                          | ❌ throw                          |
   | `recursiveDelete`, `recursiveDeleteCollection`                  | ❌ throw                          | ❌ throw                          |

   `bulkWrite` is refused because `BulkWriter` is per-operation with no shared atomic boundary — the
   same reason it already refuses registered bulk hooks (ADR-0032). The recursive deletes are
   refused because `db.recursiveDelete` streams name-only snapshots across collections this
   repository does not model, so no honest payload can be supplied. Read-capable interceptors are
   refused on the bulk paths because a transaction cannot be chunked and a 500-write/500-read
   transaction is contention-hostile.

5. **`commitInChunks` becomes group-aware.** It will take groups of actions (a domain write plus the
   interceptor writes that must commit with it) instead of a flat list, chunk only on group
   boundaries, and return **domain-write receipts only**. This preserves the positional receipt
   contract that `bulkCreate` and `bulkDelete` depend on. Interceptor writes are collected before
   chunking, so capacity is computed exactly and no declared operation budget is needed.

6. **`{ withMetadata: true }` throws when a transaction-mode interceptor is active.** Firestore
   exposes no per-operation receipt inside a transaction, so returning a fabricated or
   transaction-level `writeTime` would misrepresent the contract. This is the same reasoning that
   keeps `withMetadata` off the `*InTransaction` helpers (ADR-0037).

7. **Mode resolves per repository, as a union.** If any registered interceptor declares a read
   phase, every supported write on that repository runs under a transaction. The error raised for
   `withMetadata` must name the interceptor that forced the mode.

8. **The change is additive.** With no interceptor registered the existing code path is unchanged —
   single-document writes keep using `docRef.set()` / `create()` / `update()` / `delete()` directly.
   Registration is new API, `commitInChunks` is private, and every new throw is reachable only on a
   repository that opted in. No existing consumer observes a difference.

## Relationship to #80 (transactional outbox), and why interceptors ship first

The [outbox design](../design/transactional-outbox.md) states its central invariant as:

> An outbox event is durable only when its document and the domain write are committed by the same
> Firestore transaction or write batch.

That invariant _is_ a write interceptor. The two features are not neighbours that happen to overlap;
the outbox needs exactly the primitive this ADR defines, and the design doc already documents the
gap in "Convenience methods for ordinary writes":

```ts
// Unsafe: a crash can occur between these writes.
await orderRepo.create(order);
outbox.enqueue(/* no shared atomic boundary */);
```

Its answer is to defer ordinary-write support to **Phase 4** ("single-write transaction/batch
wrappers", `createWithOutbox`), leaving Phase 1 with only an explicit enqueue that requires the
application to hand-write a transaction around every write it wants covered.

**We will therefore build interceptors first.** The consequences of the reverse order are concrete:

- **Building the outbox first ships an incomplete reliability feature or a duplicate mechanism.**
  Either applications hand-write a transaction at every call site (the doc's own Phase 1
  limitation), or the outbox module grows a private atomic-boundary mechanism that later has to be
  reconciled with interceptors — two ways to attach a write to a commit, with different coverage and
  different refusal rules.
- **The hard problems are shared, and this ADR solves them once.** Batch capacity accounting (an
  event consumes a write in the same batch, so `N` domain writes plus their events no longer fit one
  500-op chunk), refusing `bulkWrite` for lack of a shared boundary, and transaction-retry semantics
  are all reasoned through in the outbox design doc and all resolved here for every consumer.
- **`enqueue` is expressible as an interceptor with no new machinery.** Outbox events are
  create-only writes under a stable scattered id; `create()` exists identically on `WriteBatch` and
  `Transaction`, so the restricted writer already covers it. Once interceptors exist,
  `outbox.enqueue(tx, …)` remains the low-level primitive and Phase 4's convenience wrappers become
  a thin adapter over interceptors rather than a separate subsystem.

Interceptors do **not** subsume the outbox. They provide the atomic boundary — synchronous intent
committed with the domain write. The outbox owns everything after that commit: durable state, lease
and claim protocol, retry with backoff, dead-lettering, and worker deployment. Neither replaces the
other, and #80's scope is unchanged apart from its ordering and the removal of its Phase 4 boundary
work.

Recommended sequencing: this ADR → outbox Phase 1 (event registry, enqueue implemented over
interceptors) + Phase 2 (worker), shipped together as #80 already requires.

## Consequences

**Easier.** Enforced denormalization becomes expressible and actually enforced: a maintained
denormalized field cannot drift, because every path either maintains it or fails loudly. Audit rows,
derived counters, and outbox events all become one mechanism. The `*InTransaction` helpers gain
read-capable interceptors essentially free, since a transaction is already open.

**Harder / costs.**

- **Capacity.** One domain write plus `K` interceptor writes yields `floor(500 / (1 + K))` documents
  per chunk. A 500-document `bulkCreate` with a single interceptor becomes two chunks, so
  `WriteOutcomeError` with `state: 'partially-committed'` becomes reachable where it previously was
  not. This is an observable behavior change, but only on a repository that registered an
  interceptor.
- **The mode-union footgun.** Registering one read-capable interceptor silently upgrades every
  supported write on that repository to a transaction, so `withMetadata` begins throwing for callers
  who never touched it. This needs a precise error message and prominent documentation.
- **Transaction ordering.** Firestore requires all reads before all writes, so the repository must
  run every interceptor read phase, then stage the primary write, then stage interceptor writes. An
  interceptor that reads after the caller has already written inside a `*InTransaction` flow will
  fail with the SDK's own error.
- **Three branches per single-document write site** (no interceptor / batch / transaction) instead
  of one, plus a group-aware `commitInChunks`.

**Backward compatibility.** No breaking change. No existing consumer's behavior changes, because
every new code path requires a registration that does not exist today.

**Forward compatibility.** Every refusal in the coverage matrix can later become a capability
**additively** — notably chunked transactions for bulk paths with read-capable interceptors. Turning
a throw into a supported operation breaks nothing.

**Retry safety.** Transaction contention re-runs the interceptor, but interceptors only _stage_
writes and a failed attempt never commits, so re-running is safe. This is a materially better
property than `after*` hooks, where a retry can duplicate an external effect (ADR-0035).

**Documentation.** The published "Subclassing for Enforced Denormalization" guide section is wrong
today and must change regardless of this ADR (audit finding H1). The recorded decision is to rewrite
it around a composition facade now, structured so interceptors slot in as the primary answer when
they land — with composition demoted to the read-dependent fallback — rather than requiring a second
teardown.

## Alternatives considered

- **Fix the documented subclass override.** Rejected. The overload set can be satisfied by
  redeclaring it in the subclass, but coverage stays at 2/9, 1/8, and 1/7. It would document an
  authoritative-looking mechanism that is really a single-entry-point hook.
- **Expose the transaction handle on `HookContext`.** Cheap — `buildHookContext` already has a
  transaction branch — and worth doing on its own merits, but insufficient as the answer: it only
  helps callers already inside a transaction, so a plain `update()` remains unprotected.
- **A composition facade as a library feature.** Kept as a _documented pattern_, rejected as the
  enforcement primitive: it enforces by construction, but it cannot compose with the bulk helpers,
  so it narrows the surface rather than guaranteeing the invariant. Note that one obstacle
  originally cited here is **not** real: `Omit<FirestoreQueryBuilder<…>, 'update' | 'delete'>` is
  indeed defeated by the fluent `this` return type, but a **self-returning** read-only builder type
  holds at any chain depth, so a facade does not have to hide the query builder — see
  [ADR-0041](0041-read-only-query-builder-type.md), an independent, additive type-level improvement
  that is not a prerequisite for this ADR.
- **An opt-in atomic-boundary write API** (`updateAtomic(id, data, ({ tx, repo }) => …)`). Honest
  and general, but opt-in per call site — convenient, not enforcing. Worth adding later as sugar
  over interceptors.
- **Transaction mode only.** Rejected: it would degrade `withMetadata` for every user of the feature
  and add a round trip to every single-document write, for a read capability most denormalization
  does not need.
- **Batch mode now, transaction mode in a later release.** Rejected. Both are achievable without a
  breaking change, so phasing buys nothing and costs the API simplification — a phased v2 would need
  an explicit `mode` flag and retrofitted async/context shapes purely to stay additive, where
  shipping together allows mode-by-inference.
- **Build the outbox (#80) first.** Rejected — see the relationship section above.

## References

- [Transactional outbox design](../design/transactional-outbox.md) and
  [#80](https://github.com/reggieofarrell/flintfire/issues/80)
- [v3 docs audit, finding H1](../audits/2026-08-23-website-docs-audit.md) — the emulator-probed
  coverage tables this ADR's Context section summarizes
- `src/core/FirestoreRepository.ts` — the five single-document write sites, `runUpdate`, and
  `commitInChunks`; `src/core/QueryBuilder.ts` — the bound `commitInChunks` write terminals
- [ADR-0037](0037-write-metadata-opt-in.md) — why `withMetadata` is absent from transactional writes
- [ADR-0032](0032-bulkwriter-high-throughput-writes-and-recursive-delete.md) — the refuse-loudly
  precedent for `bulkWrite` with registered bulk hooks
- [Firestore transactions and batched writes](https://firebase.google.com/docs/firestore/manage-data/transactions)
