# ADR-0041: Export a read-only query builder type (`ReadOnlyQuery`)

- **Status:** Proposed
- **Date:** 2026-08-23
- **Deciders:** Reggie O'Farrell
- **Related:** Issue [#100](https://github.com/reggieofarrell/flintfire/issues/100);
  [v3 docs audit](https://github.com/reggieofarrell/flintfire/blob/0ef66cb3888496d0959a82ec2068546265be5928/docs/audits/2026-08-23-website-docs-audit.md)
  (finding H1, follow-up L-A); refines [ADR-0021](0021-v3-query-builder-api-cleanups.md)
  (query-builder API); same type-level-contract shape as [ADR-0028](0028-distributive-omit-id.md);
  independent of [ADR-0040](0040-repository-write-interceptors.md)

## Context

An application that wants to expose a repository's reads while withholding the query builder's write
terminals (`query().update()` / `query().delete()`) has no sound way to express that today. This is
not hypothetical: it is the composition-facade pattern the docs will recommend for enforced
denormalization (audit finding H1), and the obvious approach silently fails.

```typescript
declare const q: Omit<FirestoreQueryBuilder<O, O, O>, 'update' | 'delete'>;
await q.update({ status: 'shipped' }); // ✗ blocked
await q.where('status', '==', 'pending').update({ status: 'shipped' }); // ✓ COMPILES — leak
await q.orderBy('status').delete(); // ✓ COMPILES — leak
```

The chainable clause methods return `this`, typed as the full builder, so the `Omit` holds only on
the immediate object — one `.where(...)` restores the write terminals. A consumer who writes the
`Omit` reasonably believes the writes are gone.

**The behavior that makes this fixable:** TypeScript resolves a `this` return type against the
**declared type of the receiver**, not the runtime class. Narrowing therefore _does_ survive a
fluent chain, provided the declared type is itself the narrow one. `Omit` fails only because it
leaves `this` pointing at the full builder — not because fluent chains are inherently unnarrowable.

Two consequences of the current class layout matter here. `FirestoreQueryBuilderBase` is already
write-free — `update` and `delete` are declared only on the concrete `FirestoreQueryBuilder` — but
it is not exported. And five read members (`whereFilter`, `select`, `whereId`, `orderById`,
`collectionCount`) live on the concrete class rather than the base, because their types differ
between the collection and collection-group builders (`whereId` vs `wherePath`, `orderById` vs
`orderByPath`, `collectionCount` vs `groupCount`, and `select`'s concrete return type). That
placement is deliberate and cannot be flattened without losing the distinction.

Both candidate shapes below were compiled against real source and verified to hold at every chain
depth, including through `select()`'s `DeepPartial` narrowing.

## Decision

We will export a **`ReadOnlyQuery<…>`** type whose chainable methods return `ReadOnlyQuery` instead
of `this`, covering every read member of the query builder — including the five that live on the
concrete class — and excluding `update` and `delete`.

1. **Self-returning, not `Omit`-based.** Every clause method's declared return type is
   `ReadOnlyQuery<…>`, so the narrowing is preserved transitively. `select(...)` returns
   `ReadOnlyQuery` re-parameterized with `FirestoreDocument<DeepPartial<T>>`, matching the concrete
   builder's projection narrowing.

2. **Structural, not nominal.** `repo.query()` is assignable to `ReadOnlyQuery` **with no cast** — a
   facade annotates its return type and is done. No wrapper object, no runtime cost, no new
   construction seam.

3. **Parameters are derived from the real builder, not restated.**

   ```typescript
   where(...a: Parameters<QB['where']>): ReadOnlyQuery<…>;
   ```

   Only the _return_ type is overridden, so a signature change on `FirestoreQueryBuilder` propagates
   automatically and parameter drift is structurally impossible.

4. **A drift guard pins the member set**, asserted in `src/tests/types/`:

   ```typescript
   type Missing = Exclude<keyof QB, keyof ReadOnlyQuery<…> | 'update' | 'delete'>; // must be `never`
   ```

   A read method added to the builder but not to `ReadOnlyQuery` fails the type gate. This was
   verified to fire on a deliberately incomplete `ReadOnlyQuery`.

5. **Type-level only, stated as such.** A cast still reaches `update()`. We will not ship a runtime
   `Proxy` wrapper: the purpose is compile-time enforcement of an application's own boundary, and a
   runtime guard would add public surface and a construction seam for no additional guarantee
   against a caller who is deliberately casting.

6. **Additive.** A new exported type; no existing signature changes, no behavior changes.

## Consequences

**Easier.** An application can hand out a real query builder — full filtering, ordering, projection,
aggregation, pagination, streaming, listeners — with the write terminals provably absent. That
removes the need for the workaround the docs would otherwise have to prescribe (exposing only
terminating read helpers such as `countByStatus` / `listByStatus` so no builder escapes), and lets
audit finding H1's caveat be **deleted** rather than maintained.

**Harder / costs.** `ReadOnlyQuery` is a parallel surface over the query builder, so it is a drift
risk by construction. Decisions 3 and 4 exist specifically to bound that: parameters cannot drift at
all, and a missing member fails the type gate. What remains unguarded is a _newly added_ read method
being added to both places with mismatched intent, which review must catch.

**A maintenance note for future readers.** The `Missing` guard looks like inert type noise. It is
not: without it, `ReadOnlyQuery` silently falls behind the builder. And `ReadOnlyQuery` must not be
"simplified" back to `Omit<FirestoreQueryBuilder<…>, 'update' | 'delete'>` — that reintroduces the
leak this ADR exists to close, and it does so silently, because the `Omit` still blocks the
immediate call.

**Backward compatibility.** None at risk on arrival. Note the forward commitment, though: once
consumers annotate facades with `ReadOnlyQuery`, its shape is a public contract, and removing a
member from it is a breaking change.

**Scope left open.** Whether the collection-group builder wants the same treatment — it declares no
`update` / `delete` at all, so it may need nothing.

## Alternatives considered

- **`Omit<FirestoreQueryBuilder<…>, 'update' | 'delete'>` in consumer code.** Rejected: it is the
  defect. Verified to leak after any clause call.
- **Export the existing `FirestoreQueryBuilderBase`.** Tempting, and nearly free — the base is
  already write-free and merely unexported, and a base-typed variable never regains the write
  terminals. Rejected as the primary answer because it is **lossy**: `whereFilter`, `select`,
  `whereId`, `orderById`, and `collectionCount` live on the concrete class for a real reason (see
  Context), so a facade typed as the base loses five read methods. Exporting the base additionally
  as a documented "minimal read surface" remains possible later.
- **Move those five members down into the base.** Rejected: their types differ between the
  collection and collection-group builders, which is exactly why they are on the concrete classes.
  Flattening them would erase the distinction the two builders exist to express.
- **A `Mode extends 'rw' | 'ro'` type parameter on `FirestoreQueryBuilder`, with `update` / `delete`
  conditional on it.** Works in principle (`this` preserves type arguments), but adds a fifth
  generic parameter to an already four-parameter exported class, and conditional-member types
  produce poor errors. Rejected as disproportionate.
- **A runtime `Proxy` read-only wrapper.** Rejected — see decision 5.
- **Document the leak and prescribe terminating read helpers.** This is the interim state and what
  the audit currently specifies. Rejected as the end state: it asks every consumer to give up the
  query builder because of a type-system detail the library can fix once.

## References

- Issue [#100](https://github.com/reggieofarrell/flintfire/issues/100) — tracking
- [v3 docs audit](https://github.com/reggieofarrell/flintfire/blob/0ef66cb3888496d0959a82ec2068546265be5928/docs/audits/2026-08-23-website-docs-audit.md)
  — finding H1 (the facade rewrite that surfaced this) and follow-up L-A (the verified shapes). The
  audit was working material, removed in `80ece9a`; permalinked at `0ef66cb`.
- `src/core/QueryBuilder.ts` — `FirestoreQueryBuilderBase` vs `FirestoreQueryBuilder` member split
- [ADR-0028](0028-distributive-omit-id.md) — precedent for a purely type-level exported-helper
  decision
- [TypeScript: polymorphic `this` types](https://www.typescriptlang.org/docs/handbook/2/classes.html#this-types)
