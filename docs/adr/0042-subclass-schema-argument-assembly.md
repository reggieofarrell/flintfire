# ADR-0042: Expose `withSchema`'s argument assembly for subclasses

- **Status:** Accepted
- **Date:** 2026-08-23
- **Deciders:** Reggie O'Farrell
- **Related:** Issue [#102](https://github.com/reggieofarrell/flintfire/issues/102); refines
  [ADR-0007](0007-retire-curried-schema-factories.md) (value-inferred factories); touches the schema
  bundle from [ADR-0009](0009-explicit-read-validators.md) and the stored model from
  [ADR-0018](0018-document-identity-and-data-model.md); surfaced by the
  [v3 docs audit](https://github.com/reggieofarrell/flintfire/blob/0ef66cb3888496d0959a82ec2068546265be5928/docs/audits/2026-08-23-website-docs-audit.md)
  (H1 item 3)

## Context

Subclassing `FirestoreRepository` to add domain helpers is a documented, supported extension point,
and `withSchema` cannot construct a subclass — it always returns a plain `FirestoreRepository`. So a
subclass must wire its own validation through the positional constructor.

For the simple case that is already fine, and better than previously documented. The constructor
does `this.schemasInternal = schemas ?? validator?.schemas`, so
`super(db, path, makeValidator(schema))` inherits the validator's own bundle: `repo.schemas`,
`repo.readSchema`, `validate()` and `safeValidate()` all work. (The docs briefly claimed otherwise;
that claim was wrong and is corrected in the audit.)

**The write-overlay case is not fine, and it fails silently.** `withSchema` builds the validator
from the _write_ base and then **overrides `schemas.read`** with the real read schema:

```ts
const writeBase = options?.writeSchema ?? readSchema;
const validator = makeValidator(writeBase, undefined, { sentinelPolicy: options?.sentinelPolicy });
const schemas = Object.freeze({
  read: readSchema, // ← the override
  create: validator.schemas.create,
  update: validator.schemas.update,
  stored: options?.storedSchema ?? readSchema,
});
```

A subclass that calls `makeValidator(userWriteSchema)` and stops there skips that override, so
`schemas.read` _is_ the write overlay — and read validation then accepts `FieldValue` sentinels a
read should reject. Verified at runtime:

```
naive makeValidator(write)     read-parse of sentinel -> ACCEPTED  ✗   stored: undefined ✗
withSchemaArgs helper          read-parse of sentinel -> rejected  ✓   stored: set ✓
```

Nothing surfaces this. `validate()` does not throw; it simply over-permits. It is a correctness hole
rather than an inconvenience, and it selects for the users sophisticated enough to need an overlay
at all. Two smaller rough edges compound it: `readConverter` is positional argument 5 and
`allowLegacyDatastoreIds` argument 7, so reaching either means threading `undefined`s through
`super(...)`.

The constructor's parameter list is also a conditional tuple (`RepositoryConstructorArgs`): the
validator is optional when `W` and `WO` are mutually assignable and required when they diverge —
which is exactly the overlay case. Any helper must satisfy both branches.

## Decision

We will add a static that performs the same argument assembly `withSchema` already does, shaped for
spreading into `super(...)`.

1. **`FirestoreRepository.withSchemaArgs(db, collectionPath, readSchema, options?)`** returns the
   constructor argument tuple.

   ```typescript
   class StrictUserRepository extends FirestoreRepository<User, UserWrite, User, UserParsed> {
     constructor(db: Firestore) {
       super(
         ...FirestoreRepository.withSchemaArgs(db, 'users', userSchema, {
           writeSchema: userWrite,
           sentinelPolicy: 'strict',
         }),
       );
     }
   }
   ```

2. **The options bag matches the factories**, plus `parentPath`:
   `{ writeSchema?, storedSchema?, readConverter?, sentinelPolicy?, parentPath?, allowLegacyDatastoreIds? }`.
   No positional `undefined`s, and security-relevant flags stay discoverable — the same reasoning
   that motivated the named `raw()` entry point.

3. **The read / write / stored split is correct by construction.** `schemas.read` is always the read
   schema and `schemas.stored` is always populated, so the overlay hole is **unreachable** rather
   than documented.

4. **`withSchema` and `subcollection` share the same assembler** (`buildWithSchemaArgs`) that backs
   `withSchemaArgs`, so there is one assembly path instead of three that can drift. A future option
   added to the bag lands in all three call sites automatically. Each public entry point passes its
   own error-message `context` (`withSchema` / `subcollection` / `withSchemaArgs`), and
   `subcollection` additionally passes a `readSchemaContext` so its positional-argument label
   (`...subcollection(..., readSchema, ...)`) survives — every construction error the three
   factories can raise stays **byte-identical** to the pre-refactor wording, pinned by unit tests.

5. **The subclass's declared stored generic `S` is checked, not trusted.**
   `RepositoryConstructorArgs` takes a 4th parameter `S = any` and types its `schemas` slot
   `RepositorySchemaSetFor<S>`, so `super(...)` rejects an `extends` clause that contradicts the
   `storedSchema` passed alongside it. Without this the helper would fix the runtime bundle and
   leave a silent type-level hole in the same place — a documented caveat instead of an unreachable
   mistake, which is the outcome decision 3 exists to avoid. See Consequences for the direction the
   check runs in and why.

6. **Additive, with two backward-compatible type changes.** `withSchemaArgs` is a new static and no
   runtime behavior changes for existing callers. Two exported _types_ do change shape, both
   compatibly: `RepositoryConstructorArgs` gains a defaulted 4th parameter (its 3-argument form
   keeps its previous meaning), and `RepositorySchemaSet` becomes the erased alias
   `RepositorySchemaSetFor<any>` (identical for reading and for assigning a `ZodObject` into it).
   The `schemas` getter still returns the erased form, so no consumer is forced to name a stored
   type.

## Consequences

**Easier.** Subclassing becomes a one-liner for both the plain and the overlay case, and the silent
read-schema hole stops being reachable through the documented path. The subclassing guide loses a
caveat instead of gaining one.

**Harder / costs.** One more public static on an already-large class, and a name to live with. It
also does not make `withSchema` construct subclasses — subclasses still declare their own generics
in the `extends` clause, which is the part that cannot be inferred.

**Not a full fix for hand-rolled construction.** A subclass can still call the positional
constructor directly and reintroduce the hole. This makes the correct path easy and obvious; it does
not remove the incorrect one, because the constructor is public API.

**The stored generic `S` is checked too, not just the runtime bundle.** This was initially scoped
out and then pulled in, because the alternative was shipping a runtime fix beside a _documented_
type-level hole — the exact shape of problem this ADR argues against, and on a type
(`RepositoryConstructorArgs`) that becomes public in the same change, where the arity is cheapest to
get right once.

`RepositoryConstructorArgs` gains a 4th parameter `S = any`, and its `schemas` slot is typed
`RepositorySchemaSetFor<S>` — the existing `RepositorySchemaSet` becomes the erased alias
`RepositorySchemaSetFor<any>`, so consumer annotations keep their previous meaning. The stored slot
is `z.ZodObject<any> & z.ZodType<S>`: the `ZodObject` half preserves internal `.shape` access, the
`ZodType<S>` half carries the type. A subclass whose `extends` clause contradicts the `storedSchema`
it passes now fails at `super(...)`.

The check is **directional, by design**. Zod 4 declares `ZodType<out Output>` covariantly, so:

| Declared `S` vs `storedSchema` | Result       | Rationale                                              |
| ------------------------------ | ------------ | ------------------------------------------------------ |
| unrelated shape                | **rejected** | outright contradiction                                 |
| wider (a field at rest lacks)  | **rejected** | would invent collection-group field paths              |
| narrower (a subset)            | accepted     | under-reports paths only; unsound in neither direction |

Both unsound directions are caught; the safe one is permitted. Pinned by `@ts-expect-error` guards
in `src/tests/types/with-schema-args.type-test.ts`, including a deliberately un-guarded narrower
case so the asymmetry is explicit rather than accidental.

Costs: `RepositorySchemaSetFor` is one more exported type name, and `SS` on `withSchemaArgs` is now
load-bearing rather than decorative — commented so it is not erased "for simplicity", which would
silently return `S` to an unverified hand-declaration. The public _read_ surface is unchanged: the
`schemas` getter still returns the erased `RepositorySchemaSet`, so the stored type is checked on
the way in and not imposed on the way out.

**Backward compatibility.** None at risk. Note the forward commitment: the returned tuple shape
becomes public, so it must track `RepositoryConstructorArgs`. Deriving the return type from that
type rather than restating it keeps them in lockstep.

## Alternatives considered

- **Document the overlay caveat and move on.** This is the interim state (PR #101 shows the correct
  bundle inline in the guide). Rejected as the end state: the failure is silent over-permission in
  `validate()`, and a documented workaround for a silent correctness hole is the weakest available
  fix.
- **Make `withSchema` polymorphic** so `UserRepository.withSchema(...)` returns a `UserRepository`
  (`static withSchema<This extends typeof FirestoreRepository>(this: This, …)`). Rejected: the
  return type is _computed_ from the schema values
  (`FirestoreRepository<z.output<RS>, z.input<WS>, …>`), which does not reconcile with a subclass's
  own declared generics, and `new this(...)` cannot type-check against a subclass constructor whose
  signature differs (`constructor(db)`).
- **An options-bag constructor overload** (`super(db, path, { schema, writeSchema, … })`). Arguably
  cleaner at the call site, but it adds a branch to a constructor whose parameter list is already a
  conditional tuple, and it changes an existing public signature rather than adding to it.
- **Make the constructor derive `schemas.read` itself**, e.g. accept the read schema separately.
  Rejected: the constructor cannot know which of the schemas it was handed is the read one without a
  new parameter, which is the same change with worse ergonomics.
- **Leave `schemas.stored` unset in the fallback.** Considered acceptable (only `collectionGroup()`
  consults it), but since the helper has the read schema in hand there is no reason not to populate
  it.
- **Name the helper `argsFromSchema` (or `schemaArgs` / `configFromSchema`).** Rejected in favor of
  `withSchemaArgs`: the bare `args` does not say whose arguments, while `withSchemaArgs` parallels
  the factory it mirrors and reads as “the `withSchema` assembly, for `super(...)`.”

## References

- Issue [#102](https://github.com/reggieofarrell/flintfire/issues/102) — tracking
- `src/core/FirestoreRepository.ts` — `RepositoryConstructorArgs`, the constructor's
  `schemas ?? validator?.schemas` fallback, and `withSchema`'s assembly
- `src/core/Validation.ts` — `makeValidator`, which derives its bundle from whichever schema it is
  given (the root of the overlay hole)
- [v3 docs audit](https://github.com/reggieofarrell/flintfire/blob/0ef66cb3888496d0959a82ec2068546265be5928/docs/audits/2026-08-23-website-docs-audit.md)
  — H1 item 3, including the corrected claim that surfaced this (the audit was working material,
  removed in `80ece9a`; permalinked at `0ef66cb`)
