# FlintFire v3 docs audit — `website/` vs. the codebase

**Date:** 2026-08-23 · **Audited version:** `flintfire@3.0.0` (`ef77b57`) · **Scope:** the published
Starlight site, `website/src/content/docs/**` (37 pages, 8,374 lines, current v3 tree). The frozen
`website/src/content/docs/2.0/` archive was deliberately **excluded** — it is a v2 snapshot.

## Method

Every finding below was checked against the actual code, not against memory or another doc page.

1. **Ground truth from the built contract.** Public API extracted from `dist/**/*.d.ts` (the exact
   published surface, with `stripInternal` applied) plus `src/**` for behavior.
2. **Export coverage.** Programmatic diff of every name exported from `src/index.ts`,
   `src/vector/index.ts`, and `src/express/index.ts` against the docs.
3. **Snippet compilation.** All **208** ` ```typescript ` blocks were extracted and type-checked
   against the real source (`strict`, `NodeNext`), both as one program with ambient fixtures and
   individually for the 34 self-contained snippets.
4. **Runtime probes.** Sentinel-policy and id-validation claims were executed against `dist/` rather
   than reasoned about.
5. **Link/anchor check.** `npm run check:docs` (validates Starlight slugs _and_ heading anchors).

**Result summary:** 5 high, 12 medium, 16 low. H1 was investigated further at the maintainer's
request and carries a **decision** — rewrite that section around composition; see its entry for the
emulator-probed coverage tables, the verified replacement shape, and the library follow-up. Internal
links and anchors in `website/` are **clean**.

---

## Resolution

**Applied on branch `docs/apply-v3-audit-findings`** (2026-08-23). 32 of 33 findings fixed in full;
one partially, noted below. The findings themselves are left as written above — they are the record
of what was wrong and why, and the rationale is still the best explanation of each fix.

Verified after the edits, not assumed:

- All **210** current-version TypeScript snippets re-extracted and re-compiled against real source;
  the 35 self-contained ones individually — **zero** genuine API errors.
- `check:docs` ✓ (190 files, links and heading anchors), `check:format` ✓, `lint` ✓, `test:types` ✓,
  `docs:build` ✓ (61 pages, Pagefind index built).
- H1's replacement facade is now pinned by
  `src/tests/types/enforced-denormalization-facade.type-test.ts` — 13 `@ts-expect-error` guards, so
  the section cannot silently rot again. That fixture is the structural fix for _why_ H1 shipped: no
  gate compiled doc snippets.

**L16 applied partially (2 of 4).** The two blocks that could be made valid TypeScript without
losing anything were fixed (`guides/advanced/vector-search.md`'s object literals now assign to
consts; `guides/working-with-data/queries.md`'s chain fragments are now complete statements). The
two remaining blocks — `guides/integrations/cloud-functions.md` and
`guides/working-with-data/subcollections.md` — are **method-signature displays**, which cannot be
valid standalone TypeScript without changing what they communicate (a method signature is not a
statement). Retagging them to a plain fence would cost syntax highlighting for no benefit today,
since no gate compiles doc snippets. Leave them; a future snippet gate should carry an exclusion
marker instead.

---

## High severity

### H1 — The documented repository-subclassing example does not compile (and the pattern cannot enforce what it claims)

`guides/advanced/patterns.md:438` ("Subclassing for Enforced Denormalization")

The `OrderRepository` example overrides `update` and `patch` with the return type
`Promise<{ id: ID } | FirestoreDocument<Order>>`. The base methods are overloaded, and the union is
not assignable to the `{ returnDoc: true }` overload, so the class fails to compile:

```
patterns.md:438 s024.ts(32,18): error TS2416: Property 'update' in type 'OrderRepository' is not
  assignable to the same property in base type 'FirestoreRepository<Order, Order, Order, Order>'.
    Type '{ id: string; }' is not assignable to type 'Omit<Order, "id"> & { readonly id: string; }'
patterns.md:438 s024.ts(66,18): error TS2416: Property 'patch' … (same cause)
```

Verified in isolation with only `flintfire` on the path — this is not a fixture artifact.

**Why it matters:** `guides/concepts/core-concepts.md` points at this section as the authority for a
**supported** extension point ("subclass `FirestoreRepository` or wrap a `withSchema` instance —
both are supported"), and `patterns.md` itself calls overriding write entry points a design
constraint to follow. A reader copying it hits two type errors immediately.

**Is subclassing viable at all?** Yes — but not for the goal this section claims. Investigated
empirically (see below); the section needs a rewrite, not a signature patch.

_The type problem is fixable._ Four override shapes were compiled against real source:

| Shape                                                                                      | Result                                                                                           |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Repeat the base's **full overload set** in the subclass, then one implementation signature | ✅ compiles clean; call sites still resolve `{ returnDoc: true }` → document, default → `{ id }` |
| Property-style `override update: FirestoreRepository<Order>['update'] = …`                 | ✅ compiles, but the body loses its return typing (`Promise<any>`)                               |
| Narrow to the default overload only (`options?: … & { returnDoc?: false }`)                | ❌ TS2416 — cannot drop the `returnDoc: true` call signature                                     |
| The docs' current shape, even with the `patch` override removed                            | ❌ TS2416 — the union return is not assignable to the document-returning overload                |

Also: **the `patch` override should just be deleted.** `patch` delegates to `this.update`
(`src/core/FirestoreRepository.ts:2548-2561`), so overriding `update` already covers it — the
separate `patch` override is redundant _and_ the source of the second compile error.

_The overload trap is not specific to `update`._ `create` (3 overloads) and `delete` (2 overloads)
fail identically. `delete` is the nastiest: the _obvious_ override returning `Promise<void>` is
rejected, because the base's first overload returns `Promise<WriteMetadata>`. The full-overload-set
shape fixes all three.

_The semantic problem is not fixable this way — for any of the three families._ The section's
premise is to "guarantee that base document updates always include connected denormalized writes."
An override cannot deliver that guarantee. Probed against the emulator with an instrumented
subclass, an override is reached by **2 of 9** update paths, **1 of 8** create paths, and **1 of 7**
delete paths:

| Family   | Override reached      | Bypassed                                                                                                                                       |
| -------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `update` | `update()`, `patch()` | `upsert()` [exists], `bulkUpdate()`, `bulkPatch()`, `query().update()`, `bulkWrite`, `updateInTransaction()`, `patchInTransaction()`           |
| `create` | `create()`            | `createWithId()`, `bulkCreate()`, `bulkCreateWithIds()`, `upsert()` [new], `createInTransaction()`, `createWithIdInTransaction()`, `bulkWrite` |
| `delete` | `delete()`            | `bulkDelete()`, `query().delete()`, `deleteInTransaction()`, `bulkWrite`, `recursiveDelete()`, `recursiveDeleteCollection()`                   |

`create` and `delete` are _worse_ than `update` because `patch` → `this.update`
(`src/core/FirestoreRepository.ts:2548-2561`) is the **only** internal self-delegation in the entire
class — a grep for `this.create(` / `this.delete(` / `this.bulkCreate(` etc. returns nothing.
`upsert` leaks on both sides: its update branch calls the private `runUpdate` (`:2840`) and its
create branch inlines the write, so neither override sees it. Relatedly, the callback repo from
`runInTransaction` is a plain `FirestoreRepository`, not the subclass (`:4093`) — which avoids
recursion, but also means writes inside the callback never re-enter an override.

**Hooks cover what overrides cannot — with one silent gap on delete.** Same paths, with the
per-document _and_ bulk hook registered for each family:

| Family                                         | Hooks fire | Gap                                                                                                                 |
| ---------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `update` (`beforeUpdate` + `beforeBulkUpdate`) | 8 of 9     | `bulkWrite` ⚠️ **throws** (loud refusal)                                                                            |
| `create` (`beforeCreate` + `beforeBulkCreate`) | 6 of 7     | `bulkWrite` ⚠️ **throws** (loud refusal)                                                                            |
| `delete` (`beforeDelete` + `beforeBulkDelete`) | 4 of 7     | `bulkWrite` ⚠️ throws — but `recursiveDelete()` and `recursiveDeleteCollection()` run **no hooks and do not throw** |

The `bulkWrite` throw is the property you want for an invariant: `assertNoBulkHooksRegistered`
refuses to start when any bulk hook is registered (unless `{ skipHooks: true }`), so the bypass is
loud. **`recursiveDelete` / `recursiveDeleteCollection` are the only silent bypass in the whole
matrix** — they are documented as hook-free in `guides/concepts/lifecycle-hooks.md`, but a
delete-side invariant enforced by hooks has a real hole there that a create- or update-side one does
not.

The one thing hooks cannot do is the section's _atomic sibling write_: `HookContext` carries `event`
/ `execution` / `retryable` / `attempt` and **no `tx` handle**, so a hook cannot join the caller's
transaction.

**DECISION (maintainer, 2026-08-23): rewrite the section around composition.** The "Subclassing for
Enforced Denormalization" section will be replaced with a composition-based facade. Docs site
**not** yet changed — this entry is the spec for that edit.

Rationale: an override cannot enforce anything (2/9, 1/8, 1/7 coverage above), and hooks cannot join
the caller's transaction, so neither mechanism delivers "enforced _and_ atomic". A facade delivers
it by construction — the bypass paths are **unreachable** rather than intercepted.

**Sequencing (amended 2026-08-23).** [ADR-0040](../adr/0040-repository-write-interceptors.md)
proposes repository write interceptors, which will become the _primary_ answer for this section once
implemented. Write this rewrite so interceptors can slot in **additively** rather than forcing a
second teardown:

- Structure the section as numbered subsections, with the facade at the position interceptors will
  later occupy as §1 — so landing ADR-0040 means inserting a section and demoting the facade to the
  read-dependent fallback, not rewriting the page.
- Keep the coverage tables and the "not subclassing" framing **mechanism-agnostic**; they stay
  correct under either answer.
- Do **not** forward-reference ADR-0040 in the published guide. It is `Proposed`, and the docs site
  should not advertise unshipped API. The sequencing intent lives here, not on the site.

### Spec for the replacement section

Keep the surrounding structure; replace the example. The facade holds the repositories as `private`,
so the only reachable writes are the ones it declares, and each wraps the primary write plus its
denormalized sibling in one `runInTransaction`.

**Non-obvious constraint — and it is preventable, see the follow-up below.**
`Omit<FirestoreQueryBuilder<…>, 'update' | 'delete'>` does **not** hold: clause methods return
`this` (typed as the full builder), so a single `.where(...)` hands the write terminals straight
back. Verified:

```typescript
declare const q: Omit<FirestoreQueryBuilder<O, O, O>, 'update' | 'delete'>;
await q.update({ status: 'shipped' }); // ✗ blocked
await q.where('status', '==', 'pending').update({ status: 'shipped' }); // ✓ COMPILES — leak
await q.orderBy('status').delete(); // ✓ COMPILES — leak
```

**Until the library ships a read-only builder type** (follow-up L-A below), the section must expose
**terminating** read helpers instead (`getById`, `countByStatus`, `listByStatus` → `count()` /
`paginate()` internally) so no builder escapes. Once that type exists, the section can hand back a
real query builder and this caveat is deleted rather than maintained — so write the read-helper
paragraph as a self-contained block that can be swapped out.

The replacement example was written and type-checked against real source: every read/write helper
compiles, and **all 12** bypass paths — `update`, `patch`, `upsert`, `createWithId`, `bulkUpdate`,
`bulkPatch`, `bulkWrite`, `delete`, `bulkDelete`, `recursiveDelete`, `recursiveDeleteCollection`,
and `query()` — are compile errors (asserted with `@ts-expect-error`, so an unused directive fails
the build).

### Also required by this decision

1. **Retitle** the section — "Enforced Denormalization" (drop "Subclassing").
2. **Keep** "Custom repository methods → Subclassing" unchanged. It compiles today and is the right
   tool for convenience helpers. Add one cross-reference: subclassing adds methods, it does not
   enforce invariants.
3. **Add a caveat to that subclassing section** that a subclass built with
   `super(db, path, makeValidator(schema))` gets validation but **no `schemas`**, so `validate()` /
   `safeValidate()` / `repo.schemas` throw or return `undefined` (the constructor's 6th argument is
   what populates them).
4. **Add the coverage tables above** (or a condensed form) to the new section, so a reader choosing
   between override / hooks / facade can see why.
5. If a hook-based variant is offered as the non-atomic alternative, state the delete-side gap:
   `recursiveDelete` / `recursiveDeleteCollection` fire no hooks **and do not throw**.
6. **Add the new snippet to a typecheck fixture** (`src/tests/types/`) so it cannot rot again — this
   finding existed because no doc snippet is currently compiled by any gate.

### Library follow-up (out of scope for the docs fix)

**L-A — ship a `ReadOnlyQuery` builder type so the `Omit` leak above is impossible.** Small,
additive, and independent of everything else here. Recorded as
[ADR-0041](../adr/0041-read-only-query-builder-type.md), tracked in
[#100](https://github.com/reggieofarrell/flintfire/issues/100). Two shapes were compiled against
real source and **both hold at any chain depth**:

- **Export the existing `FirestoreQueryBuilderBase`.** Nearly free — it is already write-free
  (`update` / `delete` live only on the concrete subclass) and is simply not exported. `this` types
  resolve to the _declared_ type of the receiver, not the runtime class, so a base-typed variable
  never regains the write terminals. **But it is lossy:** `whereFilter`, `select`, `whereId`,
  `orderById`, and `collectionCount` live on the concrete class (their types differ between the
  collection and collection-group builders, which is why they are not on the base), so a facade
  would lose five read methods.
- **A self-returning `ReadOnlyQuery<…>` type (recommended).** Chainable methods return
  `ReadOnlyQuery` instead of `this`, so narrowing survives every clause call _and_ through
  `select()`'s `DeepPartial` narrowing. `repo.query()` is assignable to it structurally, **with no
  cast**. It can include all five concrete-class read methods, so nothing is lost.

Two details that make the recommended shape maintainable:

- **Derive parameters from the real builder** —
  `where(...a: Parameters<QB['where']>): ReadOnlyQuery<…>` — so only the _return_ type is overridden
  and parameter drift is impossible.
- **Add a drift guard** so a read method added to the builder cannot silently go missing:

  ```typescript
  type Missing = Exclude<keyof QB, keyof ReadOnlyQuery<…> | 'update' | 'delete'>;
  // must be `never`; assert it in src/tests/types/
  ```

  Verified to fire correctly on a deliberately incomplete `ReadOnlyQuery`.

Caveat to document: this is **type-level only**. A cast still reaches `update()` / `delete()`. A
runtime `Proxy` wrapper could close that, but it is likely not worth the surface — the facade's
purpose is compile-time enforcement.

Recorded here because the docs fix documents a workaround, not a capability. Enforced
denormalization and the planned transactional outbox want the **same** missing primitive: _a write
that exposes its atomic boundary._ `docs/design/transactional-outbox.md` already hits it, in
"Convenience methods for ordinary writes" —

```ts
// Unsafe: a crash can occur between these writes.
await orderRepo.create(order);
outbox.enqueue(/* no shared atomic boundary */);
```

— and proposes `outbox.runInTransaction(repo, ({ tx, repo, enqueue }) => …)` /
`repo.createWithOutbox(...)` as Phase 4. Generalize `enqueue` to "any sibling write" and that same
primitive covers denormalization, audit rows, and counters. Worth filing as an issue against #80 so
the two features are designed once. The three shapes, cheapest first:

- **Expose `tx` on the transaction branch of `HookContext`.** Small: `buildHookContext` already has
  that branch. Lets a hook do atomic sibling writes — but only when the caller is _already_ in a
  transaction, so it does not cover plain `update()`.
- **An atomic-boundary write API** (`updateAtomic(id, data, ({ tx, repo }) => …)`). Honest and
  general, but opt-in per call site — convenient, not enforcing.
- **Registered write interceptors that the repository guarantees or refuses.** The only shape that
  is genuinely _enforced_. Hard parts are already reasoned through in the outbox design doc: batch
  accounting (N domain + N interceptor writes halves the 500-op chunk), refusing `bulkWrite` (no
  shared atomic boundary — the existing `assertNoBulkHooksRegistered` is the precedent), and
  Firestore's all-reads-before-writes rule. `recursiveDelete*` would have to **throw** rather than
  silently skip.

### H2 — Troubleshooting example reads a field off `createInTransaction`'s `{ id }` result

`reference/troubleshooting.md:46` (§2 "Hooks in Transactions")

```typescript
const result = await repo.runInTransaction(async (tx, repo) => {
  const doc = await repo.createInTransaction(tx, data); // → { id: ID }
  return doc;
});
await sendEmail(result.email); // error TS2339: Property 'email' does not exist on type '{ id: string; }'
```

`createInTransaction` returns `{ id: ID }` — a transaction cannot read a document back after writing
it. The variable name `doc` reinforces the wrong mental model, and this is fixture-independent (the
return type is fixed regardless of schema).

**Why it matters:** it directly contradicts v3 breaking change #6, which the migration guide states
explicitly ("`createInTransaction` returns `{ id }` only"). The snippet's whole point is
post-transaction side effects, so the wrong shape is the payload of the lesson.

**Fix:** return the data the side effect needs from the callback alongside the id, e.g.
`return { id: doc.id, email: data.email }`.

### H3 — Every sentinel example in the dot-notation guide throws under the v3 default

`guides/working-with-data/dot-notation.md:206-229` ("FieldValue Sentinels")

The examples use `FieldValue.*` against `userRepo` — a plain `withSchema(db, 'users', userSchema)`
repository with no `writeSchema` overlay. v3 defaults to `sentinelPolicy: 'strict'`, under which a
plain field accepts **no** sentinel. Executed against `dist/`:

```
THROWS  create: createdAt = serverTimestamp()  -> ZodError  (→ ValidationError)
THROWS  update: loginCount = increment(1)      -> ZodError
THROWS  update: tags = arrayUnion("beta-user") -> ZodError
THROWS  update: tags = arrayRemove("legacy")   -> ZodError
```

(`deprecatedField: FieldValue.delete()` does not throw at the validator, but it is an undeclared key
— Zod strips it, the payload reduces to `{}`, and the repository then rejects it as an empty update
under ADR-0014. So it fails too, just with a different message.)

**Why it matters:** this is the guide a reader lands on when they search "dot notation sentinel". It
is the only page in the docs whose sentinel examples lack a combinator overlay — every other page
(`concepts/field-value-sentinels.md`, `concepts/timestamps.md`,
`working-with-data/subcollections.md`) correctly builds one first.

**Fix:** give the section its own repository with a combinator `writeSchema`
(`loginCount: zNumberWrite()`, `tags: zArrayWrite(z.string())`,
`createdAt: z.union([z.string(), zSentinel('serverTimestamp')])`,
`deprecatedField: withDelete(...)`), or add an inline note plus a link to the strict-mode setup.

### H4 — The migration guide's `toFirestore` → hook recipe fails under strict mode

`guides/migration-v2-to-v3.md:495-508` ("Relocate `toFirestore` write transforms into hooks")

The recommended v3 replacement is:

```typescript
const userRepo = FirestoreRepository.withSchema(db, 'users', userSchema, {
  readConverter: userReadConverter,
  storedSchema: userStoredSchema,
});
userRepo.on('beforeCreate', async data => {
  data.updatedAt = FieldValue.serverTimestamp();
});
userRepo.on('beforeUpdate', async data => {
  data.updatedAt = FieldValue.serverTimestamp();
});
```

Hooks run **before** validation (`src/core/FirestoreRepository.ts:1504`), so the mutated payload is
what strict mode validates. With no `writeSchema` overlay and `updatedAt` declared as
`z.string().datetime()`, the parse fails and every write throws `ValidationError` — same runtime
evidence as H3.

**Why it matters:** this is the prescribed upgrade path for a v2 pattern, sitting two sections after
the guide's own warning that strict mode is now the default (#7). Following #7 breaks the recipe in
#the-hook-section.

**Fix:** add a `writeSchema` overlay to the snippet (`updatedAt: zDateWrite()` or
`z.union([z.string(), zSentinel('serverTimestamp')])`) and note the interaction with breaking change
#7 explicitly.

### H5 — `patchInTransaction` documented as taking no options

`guides/working-with-data/dot-notation.md:174`

> "For merge-style transaction updates without options, `patchInTransaction(tx, id, data)` is the
> always-merge convenience alias (**it takes no options**)."

Actual signature (`dist/core/FirestoreRepository.d.ts:2283`):

```typescript
patchInTransaction(tx, id, data, options?: { lastUpdateTime?: FirebaseFirestore.Timestamp }): Promise<void>
```

`guides/working-with-data/transactions.md` gets this right ("it does accept `{ lastUpdateTime? }`
for optimistic concurrency"), so the two pages contradict each other.

**Why it matters:** `lastUpdateTime` is a v3 feature. A reader who trusts this page concludes
optimistic concurrency is unavailable inside a transaction and works around a limitation that
doesn't exist.

**Fix:** replace the parenthetical with `{ lastUpdateTime? }` and link to
`transactions.md#transaction-write-helpers`.

---

## Medium severity

### M1 — `update` / `patch` option bags disagree across three pages

Actual: `UpdateOptions = { merge?, returnDoc?, withMetadata?, lastUpdateTime? }`; `patch` accepts
`{ returnDoc?, withMetadata?, lastUpdateTime? }`.

| Location                                                        | Claim                                       | Missing                          |
| --------------------------------------------------------------- | ------------------------------------------- | -------------------------------- |
| `reference/types.md` (`UpdateOptions`)                          | all four                                    | — (correct)                      |
| `reference/repository.md:251-253`                               | full `patch` overloads                      | — (correct)                      |
| `guides/working-with-data/crud-operations.md:117`               | `{ merge?, returnDoc?, lastUpdateTime? }`   | `withMetadata`                   |
| `guides/working-with-data/crud-operations.md:121`               | `patch` → `{ returnDoc?, lastUpdateTime? }` | `withMetadata`                   |
| `guides/working-with-data/crud-operations.md:30` (code comment) | "no merge option, only `{ returnDoc? }`"    | `withMetadata`, `lastUpdateTime` |
| `guides/working-with-data/dot-notation.md:89`                   | `update()` → `{ merge?, returnDoc? }`       | `withMetadata`, `lastUpdateTime` |
| `guides/working-with-data/dot-notation.md:97`                   | `patch()` "only option is `{ returnDoc? }`" | `withMetadata`, `lastUpdateTime` |

Opt-in write metadata is a headline v3 feature; it is invisible on the two pages a reader is most
likely to be on while writing update code. **Fix:** state the full bag once and link to
`reference/types.md#updateoptions` from the guides instead of restating it.

### M2 — `reference/types.md` omits 12 exported types

The page opens "Types re-exported from the package entry point (`flintfire`)". Twelve are absent:

`AggregationResult`, `AggregationSpec`, `AggregationSpecEntry`, `AverageAggregation`,
`BulkWriteOperation`, `BulkWriteOperationKind`, `BulkWriteOptions`, `BulkWriteResult`,
`CountAggregation`, `QueryExplainResult`, `QueryExplainStreamResult`, `SumAggregation`.

Five of them — `AggregationSpecEntry`, `AverageAggregation`, `BulkWriteOperationKind`,
`CountAggregation`, `SumAggregation` — appear **nowhere** in the v3 docs. The other seven are
mentioned by name in `reference/query-builder.md` / `reference/repository.md` but never given a
shape. All twelve back v3-new APIs (`aggregate`, `bulkWrite`, `explain`/`explainStream`).

**Fix:** add the twelve entries (structural shapes for the `BulkWrite*` family in particular, since
`bulkWrite` callers must construct `BulkWriteOperation` values by hand).

### M3 — `bulkWrite`: two of five operation verbs, per-op preconditions, and `failedAttempts` are undocumented

`BulkWriteOperationKind = 'create' | 'set' | 'update' | 'patch' | 'delete'`, and the `update` /
`patch` / `delete` variants each accept `lastUpdateTime?`. `BulkWriteResult` failures may carry
`failedAttempts?: number`.

The docs show only `create` / `update` / `delete`
(`guides/working-with-data/crud-operations.md:261-265`). `set` appears once, in passing, in
`reference/errors.md:118`; `patch` as a bulkWrite verb, per-op `lastUpdateTime`, and
`failedAttempts` appear nowhere.

**Fix:** document the full five-verb union with its per-verb fields (only `create` may omit `id`;
only `update`/`patch`/`delete` take `lastUpdateTime`) and add `failedAttempts` to the result shape.

### M4 — `upsert` fires **different hooks depending on whether the document exists**

`src/core/FirestoreRepository.ts:2833-2857`: `upsert` does an existence pre-read, then routes to
`runUpdate` (firing `beforeUpdate` / `afterUpdate`) when the document exists, and to the create path
(firing `beforeCreate` / `afterCreate`) when it does not.

This existence-dependent dispatch is documented **nowhere** — a grep for `upsert` near any
hook/`beforeCreate`/`beforeUpdate` term across the v3 tree returns nothing.

**Why it matters:** a hook author writing audit or cache-invalidation logic has no way to predict
which of their handlers `upsert` will run. **Fix:** add a row to the
`guides/concepts/lifecycle-hooks.md` payload/dispatch section and a note on `upsert` in
`reference/repository.md`.

### M5 — Performance cost table contradicts its own prose and omits three read-costing operations

`guides/designing/performance.md`

- The table row for `delete()` says **"1 delete"**; the "What Happens Under the Hood" section 30
  lines below says **"1 read + 1 delete"**. The prose is right (`delete` does an existence pre-read
  and throws `NotFoundError`).
- **`upsert(id, data)` is absent** — it does a `getById` pre-read, so it is **1 read + 1 write**.
- **`bulkDelete(ids)` is absent** — it does a single `db.getAll` existence pre-read, so it is **N
  reads + M deletes**.
- **`query().delete()` is absent** (`query().update()` is listed) — it is 1 read + 1 delete per
  match.

This is the page a reader consults to reason about their Firestore bill. **Fix:** add the three rows
and correct the `delete()` row.

### M6 — Performance page claims Admin SDK document caching that does not exist

`guides/designing/performance.md`: the benchmark row
`getById() | 1 | ~30ms | Cached locally after first read`, and under **Notes**, "Firestore has
built-in caching for frequently accessed docs".

The Firebase **Admin** SDK has no local document cache or offline persistence — that is a client-SDK
(web/mobile) feature. FlintFire is Admin-SDK-only by design (stated on this very site). **Fix:**
drop both claims, or scope them explicitly to gRPC channel reuse, which is what actually persists
between calls.

### M7 — `beforeCreate` / `beforeBulkCreate` payloads carry an `id` the docs never mention

Actual hook payload types:

- `BeforeCreateHookFn<W>` → `CreateInput<W> & { readonly id?: ID }` — **absent** for auto-id
  `create()`, **present and readonly** for `createWithId` and `upsert`.
- `BeforeBulkCreateHookFn<W>` → `readonly (CreateInput<W> & { readonly id: ID })[]` — the id is
  **always present**, pre-generated before the hook runs
  (`src/core/FirestoreRepository.ts:1709-1721`).

The `guides/concepts/lifecycle-hooks.md` payload table says only "The create payload (before
validation)" / "An array of create payloads (before validation)", while it _does_ spell out the id
for `beforeUpdate` (`data & { id }`) and `afterCreate`. **Fix:** document both, including the
optionality asymmetry — it's the only way a `beforeCreate` hook can know its target id.

### M8 — `validate` / `safeValidate` detach and re-attach `id`; docs imply the opposite

`src/core/FirestoreRepository.ts` (`parseReadValue` / `safeParseReadValue`) strips `id` from the
input **before** `readSchema.parse(...)` and re-attaches it to the result.

`guides/concepts/schema-validation.md` says these methods "run against the **converted** read shape
— after any `readConverter` transform and the `id` overlay" and then, two paragraphs later, "keys
**not** declared in the read schema are **stripped** from the returned value". Since a read schema
may never declare `id`, the two statements together imply `id` is dropped — and give no hint that a
**strict** read schema (`z.strictObject` / `.strict()`) works, which it only does because of the
detach step.

**Fix:** state that `id` is separated before parsing and re-attached afterward, and that strict read
schemas are therefore supported.

### M9 — Prototype-pollution rejection in the dot-notation helpers is undocumented

`src/utils/dotNotation.ts` rejects any path segment in `{'__proto__', 'prototype', 'constructor'}`
(CWE-1321 guard) from `expandDotNotation`, `mergeDotNotationUpdate`, and `validateDotNotationPath`.

Both helper tables (`reference/helpers.md` and `guides/working-with-data/dot-notation.md`) describe
`validateDotNotationPath` as throwing only on "empty, starts or ends with a `.`, or contains an
empty segment", and describe the other two with no mention of throwing at all.

These helpers are documented as safe to use on untrusted request keys, so the guard is exactly the
behavior a reader needs to know about. **Fix:** add the forbidden-segment rule to all three rows.

### M10 — `FirestoreRepository.raw()` is recommended by the reference but never used by any guide

`reference/repository.md:66` introduces `raw<T>()` and says "Prefer this over the positional
constructor when you need a raw repository with options — it keeps a security-relevant flag like
`allowLegacyDatastoreIds` discoverable instead of a trailing positional boolean."

Every guide steers readers to the positional constructor instead: `getting-started.md` ("construct
`new FirestoreRepository<User>(db, 'users')` instead"), `guides/concepts/core-concepts.md`,
`guides/working-with-data/subcollections.md`, `guides/advanced/patterns.md`. `raw()` appears in only
three places sitewide, none of them a guide.

**Fix:** use `FirestoreRepository.raw<T>(db, path)` in the guides' unvalidated-repository examples.

### M11 — Migration guide contradicts itself on empty `query().update()` payloads

`guides/migration-v2-to-v3.md:125`:

> "`query().update(...)` now returns the number of documents **actually written** (payloads that
> sanitized to empty are not counted), not the matched count."

Under ADR-0014 an empty sanitized payload **throws** `ValidationError`
(`src/core/QueryBuilder.ts:1917`, called inside the write loop) — it is never "not counted". The
same page states this correctly in #10 ("`query().update()` now throw a `ValidationError` for an
empty patch"). Because the payload is uniform across matches, the returned count now always equals
the matched count when the call succeeds, making the "not the matched count" contrast obsolete.

**Fix:** delete the parenthetical and the stale contrast; point at #10.

### M12 — Express guide asserts that spreading `req.body` is safe

`guides/integrations/express.md:148`:

> "`update(id, data, { returnDoc: true })` returns the updated document. The `id` field is always
> stripped from write payloads, so spreading `...req.body` is safe."

The `id`-stripping half is **correct and verified** (`stripTopLevelId` runs unconditionally, before
validation, for validated _and_ raw repositories). But "so spreading `...req.body` is safe"
overstates it: for any field the schema _does_ declare — the docs' own `userSchema` declares
`status` and `role` — spreading the body is textbook mass assignment. The route examples spread
`req.body` into both `create` and `update`.

This site has a dedicated `guides/designing/security-boundary.md` page ("input validation and
authorization are entirely your application's responsibility"), which the flat "is safe" undercuts.
**Fix:** narrow the claim to `id` and add a sentence on picking fields explicitly (or a request-DTO
schema) for anything privilege-bearing.

---

## Low severity

| #   | Location                                                                                                                                                                       | Finding                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | `reference/repository.md:401`                                                                                                                                                  | References a type **`WriteInput`** that does not exist in the public API (or anywhere in `src/` outside one test comment). The real types are `CreateInput<W>` / `UpdateInput<W>`.                                                                                                                                                  |
| L2  | `reference/repository.md:341`, `guides/migration-v2-to-v3.md:62`                                                                                                               | Say an id is rejected when it "contains `/`, `.`, `..`". Only the exact values `.` and `..` are rejected — runtime-verified: `a.b`, `user.name@example.com`, and even `a..b` are **accepted**. `guides/concepts/document-identity.md` and `reference/errors.md` state this correctly ("**is** `.` or `..`"); these two pages don't. |
| L3  | `reference/errors.md:78`, `guides/concepts/document-identity.md:64`                                                                                                            | The `InvalidDocumentIdReason` rejection lists omit `not_string` and `invalid_utf8` (lone surrogate). `reference/types.md` names the type but never enumerates its seven values.                                                                                                                                                     |
| L4  | `reference/repository.md`                                                                                                                                                      | `isSubcollection()` is missing from the reference (it appears only in the subcollections guide). The `readSchema` / `createSchema` / `updateSchema` convenience getters are undocumented sitewide — only `schemas?.read` etc. are shown.                                                                                            |
| L5  | `guides/working-with-data/queries.md:334`                                                                                                                                      | "throws if `pageSize` is less than or equal to `0`". `assertPositiveInt` also rejects non-integers, so `paginate(2.5)` throws. `reference/query-builder.md` says "positive integer" correctly.                                                                                                                                      |
| L6  | `guides/concepts/read-converters.md:30-45`                                                                                                                                     | Extends the canonical `userSchema` with `createdAt: z.instanceof(Timestamp)` and says the read model "exposes" a `Date` / "read back a Date". Every page that defines `userSchema` uses `createdAt: z.string().datetime()`, so the read type is `string`; the `as User` cast hides the mismatch.                                    |
| L7  | `getting-started.md:80-84` and 5 other pages                                                                                                                                   | Uses zod-3-era `z.string().email()` / `z.string().datetime()`. Both compile on the installed zod 4.4.3 but are deprecated in favor of `z.email()` / `z.iso.datetime()`, and `^4.0.0` is the only supported peer range.                                                                                                              |
| L8  | `guides/advanced/vector-search.md`                                                                                                                                             | Calls `isVectorFieldValue` a "**type guard**". Its signature is `(value: unknown) => boolean` — not a type predicate, so it narrows nothing.                                                                                                                                                                                        |
| L9  | `guides/migration-v2-to-v3.md:277`                                                                                                                                             | "landed in the same **unreleased** 3.0.0 window" — stale now that 3.0.0 has shipped.                                                                                                                                                                                                                                                |
| L10 | `guides/migration-v2-to-v3.md:316`                                                                                                                                             | Link text reads "Core Concepts" but the target is `guides/designing/schema-evolution/#normalizing-across-schema-changes`.                                                                                                                                                                                                           |
| L11 | `guides/advanced/vector-search.md` (`vectorEmbeddingSchema`)                                                                                                                   | Undocumented: the factory **throws** at schema-construction time when `dimensions` is not a positive integer `<= VECTOR_MAX_DIMENSIONS`.                                                                                                                                                                                            |
| L12 | `reference/helpers.md:64`, `guides/concepts/timestamps.md:102`                                                                                                                 | `convertMillisToTimestamp(ms)` throws `TypeError` on a non-finite number, but the tables note the throw only for its sibling `convertTimestampToMillis` — an asymmetry that reads as intentional.                                                                                                                                   |
| L13 | `reference/scope-and-capabilities.md:~120`                                                                                                                                     | Describes `FirestoreQueryBuilder.getUnderlyingQuery()` as "`@internal` and returns `Query<any>`". It is `@internal` _and_ stripped from the published `.d.ts` (`stripInternal: true`), so typed consumers cannot call it at all without a cast. Worth saying so.                                                                    |
| L14 | `guides/integrations/nestjs.md:137`                                                                                                                                            | "The `afterCreate` hook receives the freshly created **document** (including its generated `id`)." It receives the parsed _write output_ (`z.output<writeSchema>` + `id`), never a read-back — the distinction v3 breaking change #6 exists to make.                                                                                |
| L15 | `guides/working-with-data/queries.md:~528`                                                                                                                                     | `// analyzed.documents: User[]` — the mapped rows are `FirestoreDocument<User>[]`. Small, but it's the exact conflation v3's identity model removes.                                                                                                                                                                                |
| L16 | `guides/advanced/vector-search.md:81`, `guides/integrations/cloud-functions.md:32`, `guides/working-with-data/queries.md:169`, `guides/working-with-data/subcollections.md:51` | Four blocks are fenced ` ```typescript ` but are illustrative fragments that cannot parse as TS (bare object literals, a lone method signature, chain fragments). Harmless for rendering; they defeat any future snippet-typecheck gate. Consider ` ```ts ` → plain ` ``` ` or a `title=` marker for these.                         |

---

## Out of scope but blocking `release:verify`

`npm run check:docs` currently **fails** — 3 broken links, all in in-repo docs, not `website/`:

```
docs/adr/0039-flintfire-package-and-repository-rename.md:7    ../plans/flintfire-v3-release/PLAN.md
docs/adr/0039-flintfire-package-and-repository-rename.md:117   ../plans/flintfire-v3-release/notes.md
docs/adr/0039-flintfire-package-and-repository-rename.md:122   ../plans/flintfire-v3-release/PLAN.md
```

`docs/plans/flintfire-v3-release/` was removed in `ef77b57` ("chore: cleanup old plan files") while
ADR-0039 still links to it. `check:docs` is a step in `release:verify`, so this gate is red on
`main`. Per the ADR guidance in `CLAUDE.md`, ADRs should reference source and other ADRs rather than
mutable plan files — the fix is probably to drop the three links.

Separately, `src/benchmarks/performance.test.ts` (the harness behind the
`guides/designing/performance.md` benchmark table) is still v2-shaped: it declares
`type TestDoc = z.infer<typeof testDocSchema> & { id?: ID }` — a top-level `id`, which v3 rejects —
and imports an unused `string` from `zod`. It also needs a manually-supplied service-account file,
so the table's absolute millisecond figures are not reproducible from the repo and carry no
environment or date qualifier.

---

## Verified correct (no action)

Recording what was checked and found accurate, so the next audit can skip it.

- **Internal links and heading anchors** across the whole `website/` tree — clean (`check:docs`
  validates Starlight slugs _and_ `#anchor` fragments against target heading slugs).
- **Every `import … from 'flintfire' | 'flintfire/vector' | 'flintfire/express'` in the docs**
  resolves to a real export — zero mismatches across all 37 pages.
- **All 33 exported values** (classes, error types, combinators, dot-notation and timestamp helpers,
  `parseFirestoreError`) appear in the docs; all 19 `/vector` exports do too.
- **`reference/repository.md`** — every documented overload, option shape, and return type matches
  `dist/core/FirestoreRepository.d.ts`, including `getMany`'s four `fieldMask` × `withMetadata`
  overloads, `delete` → `Promise<WriteMetadata>`, and `bulkDelete` → `{ count, writeTimes }`.
- **`reference/query-builder.md`** — matches `dist/core/QueryBuilder.d.ts`, including
  `distinctValues<K extends Extract<KeysOf<OmitId<T>>, string>>`, the `paginate` / `offsetPaginate`
  / `paginateWithCount` / `stream` return shapes, and the collection-group difference table
  (`update`/`delete` genuinely absent from the group builder).
- **`reference/errors.md`** — the `parseFirestoreError` mapping table matches
  `src/core/ErrorParser.ts` exactly, including the load-bearing claim that the index check sits
  **above** the blanket code-9 branch.
- **`guides/integrations/express.md`** error table — matches `src/express/index.ts`
  status-for-status (400/400/404/503/409/412/500/500) and body-for-body.
- **Numeric claims spot-checked against dependencies:** transaction default `maxAttempts` = **5**
  (`DEFAULT_MAX_TRANSACTION_ATTEMPTS`); BulkWriter retries = **10** (`MAX_RETRY_ATTEMPTS`);
  `VECTOR_MAX_DIMENSIONS` = 2048; `VECTOR_MAX_LIMIT` = 1000; `aggregate` max 5 is server-enforced,
  not local, exactly as documented.
- **Peer ranges** in `getting-started.md` match `package.json` (`firebase-admin ^12 || ^13 || ^14`,
  `zod ^4`, `engines.node >=22`).
- **`ReadOnlyTransactionalRepository` membership** — the transactions guide's list matches the
  interface member-for-member, including the correct omission of `safeValidate`.
- **`guides/concepts/timestamps.md`**, **`guides/concepts/field-value-sentinels.md`**,
  **`reference/troubleshooting.md`** (all 11 sections), **`overview.md`** (matches
  `website/astro.config.mjs` sidebar), and the `vectorEmbeddingSchema` forged-`{_values}` /
  nominal-`instanceof` claims — all accurate.
- **Snippet compilation:** of the 34 self-contained snippets compiled individually against real
  source, only H1 was a genuine API failure; the rest of the diagnostics were expected fragment
  artifacts (missing `z` import in an excerpt, NestJS decorators, Jest globals, and the intentional
  v2 "before" examples that are _supposed_ to fail to compile).
