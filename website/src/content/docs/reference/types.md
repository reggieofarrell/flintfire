---
title: 'Exported Types'
description:
  'The types re-exported from the package entry point — FirestoreDocument, DataOf, FieldPaths,
  UpdateInput, SentinelPolicy, and more.'
---

Types re-exported from the package entry point (`flintfire`). For the classes
these types describe, see [FirestoreRepository](/flintfire/reference/repository/) and
[FirestoreQueryBuilder](/flintfire/reference/query-builder/) (which also documents
`FirestoreCollectionGroup` and `FirestoreCollectionGroupQueryBuilder`); for the runtime helpers, see
[Helpers & Utilities](/flintfire/reference/helpers/).

- **`ID`** — `string` document-identifier alias.
- **`RepositoryConstructorArgs<T, W, WO, S = any>`** — the positional constructor tuple for
  `FirestoreRepository`:
  `(db, collectionPath, validator?, parentPath?, readConverter?, schemas?, allowLegacyDatastoreIds?)`.
  The validator is required when `WO` diverges from `W` and optional when they match. `S` is the
  stored (at-rest) type, carried in the `schemas` slot so a subclass's declared `S` is checked against
  the `storedSchema` it passes. Returned by `FirestoreRepository.withSchemaArgs` so subclasses can
  spread it into `super(...)` (ADR-0042).
- **`RepositorySchemaSetFor<S = any>`** — the repository schema bundle
  (`read` / `create` / `update` / `stored?`), parameterized by the stored type. `stored` is
  `ZodObject<any> & ZodType<S>`, which is what makes the `S` check above possible.
  **`RepositorySchemaSet`** is the erased alias (`RepositorySchemaSetFor<any>`) and is what the
  `repo.schemas` getter returns — the stored type is checked on construction, not imposed on reads.
- **`FirestoreDocument<T>`** — the flat read-result shape. For a concrete `T`, equivalent to
  `Omit<T, 'id'> & { readonly id: ID }`; for unresolved generics it is a **distributive
  conditional** so union read models narrow correctly (ADR-0028). Returned by every read (`getById`,
  `getAll`, query terminals, hook payloads, …).
- **`DataOf<R>`** — extracts a repository's read-data type (`OmitId<T>`) without spelling the
  generics.
- **`StoredDataOf<R>`** — extracts a repository's stored-data type (`OmitId<S>`).
- **`DocumentOf<R>`** — extracts a repository's document result type
  (`FirestoreDocument<DataOf<R>>`); name a returned document type without spelling the generics.
- **`CollectionGroupDocument<T>`** — the read-result shape of a
  [collection-group query](/flintfire/guides/working-with-data/queries/#collection-group-queries):
  `Omit<T, 'id' | 'path' | 'parentPath'>` plus a readonly `id`, the full document `path`
  (`'users/u1/posts/p1'`), and the containing collection's `parentPath` (`'users/u1/posts'`). All
  plain strings, so a result stays JSON-serializable — rebuild a reference with `db.doc(row.path)`.
  Ids are not unique across a group, so `path` is the identity that distinguishes two rows. Compose
  it with the extractors to name a row: `CollectionGroupDocument<DataOf<typeof postRepo>>`. Both
  `FirestoreDocument` and `CollectionGroupDocument` distribute `Omit` over union read models
  (ADR-0028).
- **`DocumentMetadata`** — snapshot provenance paired with reads and detailed listeners: `ref`
  (live `DocumentReference` — not JSON-serializable), `path`, `parentPath`, `createTime`,
  `updateTime`, `readTime`. Delivered as a **sibling** of the document, never overlaid onto it.
- **`WithMetadata<D>`** — `{ doc: D; metadata: DocumentMetadata }`, returned by any read called with
  `{ withMetadata: true }`. `doc` stays JSON-serializable; `metadata.ref` does not.
- **`WriteMetadata`** — commit receipt `{ writeTime: Timestamp }` returned by a **non-transactional**
  write called with `{ withMetadata: true }`. This is the Admin SDK write-result timestamp, **not**
  `DocumentMetadata.updateTime` and not a JSON field on the document body. Absent from every
  `*InTransaction` helper.
- **`WriteResultWithMetadata<R>`** — `R & WriteMetadata` (for example `{ id, writeTime }`). Prefer
  this enrichment over a universal `{ result, metadata }` wrapper so default callers keep reading
  `.id`.
- **`DetailedDocumentChange<R>`** — one mapped `docChanges()` entry: `type`, `doc`, `metadata`,
  `oldIndex`, `newIndex`. For `type: 'removed'`, `doc` and `metadata` describe the document as it
  last was — branch on `type`, not on `exists`.
- **`DetailedQuerySnapshot<R>`** — detailed listener payload: `docs`, `changes`, `size`, `empty`,
  `readTime`.
- **`InvalidDocumentIdReason`** — machine-readable cause carried by `InvalidDocumentIdError`:
  `'not_string' | 'empty' | 'contains_slash' | 'reserved_dot_segment' | 'reserved_namespace' |
  'too_long' | 'invalid_utf8'` (the error class is documented in
  [Error Handling](/flintfire/reference/errors/)).
- **`HookEvent`** — union of supported lifecycle hook names.
- **`HookContext<E>`** — second argument to every lifecycle hook: `event`, `execution`
  (`'direct'` | `'transaction'`), `retryable`, and (on the transaction branch only) diagnostic
  `attempt: number | null`. See [Lifecycle Hooks](/flintfire/guides/concepts/lifecycle-hooks/).
- **`WriteOutcome`** — discriminated persistence outcome carried by `WriteOutcomeError` (see
  [Error Handling](/flintfire/reference/errors/)).
- **`UpdateOptions`** — `{ merge?: boolean; returnDoc?: boolean; withMetadata?: boolean;
  lastUpdateTime?: Timestamp }`. `returnDoc` and `withMetadata` are mutually exclusive.
- **`ReadConverter<T>`** — read-only converter: the `fromFirestore(snapshot) => T` mapper passed as
  `readConverter` (the repository builds the full `FirestoreDataConverter` internally). See
  [Read Converters](/flintfire/guides/concepts/read-converters/).
- **`SafeResult<T>`** — `{ success: true; data } | { success: false; error: ValidationError }`
  returned by `safeValidate`.
- **`PaginatedResult<T>`** — `{ items; nextCursor; hasMore }` from cursor pagination.
- **`DeepPartial<T>`** — recursively-optional `T` (nested map properties optional too); the terminal
  result shape after `select(...)`. It recurses into **every object not assignable to the leaf set**
  (there is no plain-map predicate); leaf values are preserved whole — scalars, `Date`, Firestore
  value classes (`Timestamp`, `GeoPoint`, `DocumentReference`, `FieldValue`, vector values), byte
  values (`Uint8Array`/`Buffer`), functions, and arrays. The leaf test is distributive over unions.
  A custom class instance produced by a `readConverter` as a field value is not a known leaf, so it
  recurses and its methods type as optional after a projection. Guarding only the field does not
  make such a method callable (`row.value?.method()` still errors — `method` is now optional too);
  guard the method as well (`row.value?.method?.()`) or assert the field back to its class type
  after a null check (`(row.value as ClassType).method()`).
- **`FieldPaths<T>` / `PathValue<T, P>`** — typed field-path union and the value type at a path.
  Query/builder surfaces compose these over the stored shape after synthetic-`id` removal
  (`FieldPaths<OmitId<S>>`). Declared literal keys beside a string index signature (for example
  `{ name: string } & Record<string, unknown>`, or the same shape with an explicit synthetic `id`)
  are preserved as typed paths; arbitrary dynamic map keys are not — use an SDK `FieldPath` for
  those. Nested intersections recover their declared children recursively. When the stored model
  also declares `id`, that key is excluded from typed paths (`FieldPaths<OmitId<S>>`) even though a
  string index still makes value-position access at `id` legal at the index value type on
  `StoredDataOf` / `OmitId<S>` itself.
- **`OmitId<S>`** — distributive synthetic-`id` removal for stored/read models. When a member
  explicitly declares a literal `id`, the helper omits it from the declared-key portion and
  reattaches any original string/number index signatures so declared siblings keep precise types
  while value-position dynamic indexing survives; otherwise it returns that member unchanged (so an
  intersection with `Record<string, unknown>` keeps both its declared keys and its value-position
  index signature). Use when annotating a reusable `QueryFilterFactory` predicate over a union
  model: `(f: QueryFilterFactory<OmitId<UnionStored>>) => …`. Prefer `StoredDataOf<typeof repo>` for
  repository-bound predicates. See ADR-0028.
- **`QueryFilterFactory<S>`** — the callback argument of
  [`whereFilter(...)`](/flintfire/reference/query-builder/): schema-aware `where` / `whereId` /
  `and` / `or` builders that return an SDK `Filter`. `and()` and `or()` throw when called with no
  filters. `Filter` itself is **not** re-exported — import it from `firebase-admin/firestore`, as
  with `FieldPath` and `WhereFilterOp`. Useful for extracting a reusable typed predicate — annotate
  the shape with `StoredDataOf<typeof repo>`, which already excludes the synthetic `id` from typed
  query paths (`FieldPaths<OmitId<S>>`) while retaining value-position index access when the stored
  model has a string index:
  `const mine = (f: QueryFilterFactory<StoredDataOf<typeof postRepo>>) => f.or(…)`. `S` is
  **invariant**: a predicate annotated with a different repository's shape (or one that still
  includes `id` as a declared typed path) is a compile error rather than silently accepted.
- **`CollectionGroupFilterFactory<S>`** — the collection-group counterpart, handed to
  `collectionGroup().query().whereFilter(...)`. Identical to `QueryFilterFactory<S>` except that the
  document-name helper is `wherePath(op, fullPathOrRef)` rather than `whereId(op, id)`, because a
  collection-group query matches `documentId()` against the **full document path**. Same invariance
  rules.
- **`ReadOnlyTransactionalRepository<T, S = T>`** — type-level surface for `{ readOnly: true }` /
  `runReadOnlyAt` transaction callbacks. Membership is **pure or transaction-scoped only**:
  `getInTransaction`, `getManyInTransaction`, `fromSnapshot`, `validate`, `id` / `newId`,
  `getCollectionPath`, and the `readSchema` / `schemas` accessors. Write helpers and
  non-transactional reads (`getById`, `getMany`, `getAll`, `query`) are absent from the type so they
  cannot bypass the transaction or `readTime`. The optional second type parameter `S` is the
  **stored** model used to type `fieldMask` paths on `getManyInTransaction` (mirroring `select()` /
  `where()`); it defaults to `T` so existing one-argument uses keep compiling. See
  [Transactions](/flintfire/guides/working-with-data/transactions/).
- **`UpdateInput<T>`** — update payload type; for a concrete `T`, `UpdateData<Omit<T, 'id'>>` (typed
  dot-notation paths). Distributes over union write models (ADR-0028).
- **`CreateInput<T>`** — create payload type; for a concrete `T`, `WithFieldValue<Omit<T, 'id'>>`;
  `id` is not a member. Distributes over union write models, so each branch is writable and
  cross-branch payloads stay rejected (ADR-0028).
- **`CreateOutput<T>`** — parsed create output (`Omit<T, 'id'>` for a concrete `T`) that
  after-create hooks observe. Distributes over unions (ADR-0028).
- **`Validator<Input, Output = Input>`** — validation contract produced by `makeValidator(...)`.
- **`RepositorySchemaSet`** — bundle of schemas attached to a repository: `read` / `create` /
  `update`, plus an optional `stored` carrying the effective at-rest shape (the supplied
  `storedSchema`, or the read schema when none was given). `stored` is what `collectionGroup()`
  inspects to reject a stored shape colliding with group identity; for the stored shape as a _type_,
  use `StoredDataOf<typeof repo>`.
- **`SentinelPolicy`** — `'permissive' | 'strict'` (the v3 default is `'strict'`).
- **`FieldValueKind`** — union of recognized Firestore sentinel kinds.
- **`BulkWriteOperationKind`** — `'create' | 'set' | 'update' | 'patch' | 'delete'`, the verb set
  [`bulkWrite`](/flintfire/reference/repository/) accepts.
- **`BulkWriteOperation<W>`** — one entry in a `bulkWrite` list, discriminated on `op`. Only
  `create` may omit `id`; only `update` / `patch` / `delete` accept `lastUpdateTime?`.
- **`BulkWriteResult`** — positional per-operation outcome, discriminated on `ok`. Successes carry
  `{ index, id, op, ok: true, writeTime }`; failures carry `{ index, id, op, ok: false, error }`
  plus an optional `failedAttempts` (present only when the backend rejected the write, absent for a
  validation or malformed-id rejection where nothing was attempted).
- **`BulkWriteOptions`** — `{ skipHooks?: boolean; throttling? }`. `skipHooks` is required when the
  repository has any bulk hook registered; `throttling` is forwarded verbatim to `db.bulkWriter`.
- **`CountAggregation`** — `{ kind: 'count' }`.
- **`SumAggregation<S>`** / **`AverageAggregation<S>`** — `{ kind: 'sum' | 'average', field }`, where
  `field` is a numeric stored path (`NumericFieldPaths<S> | FieldPath`).
- **`AggregationSpecEntry<S>`** — the union of the three above; **`AggregationSpec<S>`** is
  `Record<string, AggregationSpecEntry<S>>`, the alias → aggregation map
  [`aggregate(spec)`](/flintfire/reference/query-builder/) takes.
- **`AggregationResult<Spec>`** — the resolved result for a spec: each alias maps to `number` for
  `count` / `sum` and `number | null` for `average`.
- **`QueryExplainResult<R>`** — `{ metrics, documents }` from `explain()`. `documents` is `null` for
  a plan-only request and `R[]` (possibly `[]`) when `analyze: true`.
- **`QueryExplainStreamResult<R>`** — one chunk from `explainStream()`; `document` and `metrics` are
  both optional, because metrics arrive as a separate chunk from the documents.

The package also exports runtime helpers — validation combinators, timestamp utilities, and
dot-notation utilities — documented on the [Helpers & Utilities](/flintfire/reference/helpers/)
page. The vector-search extension (`flintfire/vector`) exports
`withVectorSearch`, `vectorEmbeddingSchema`, `VectorDistanceMeasure`, `isVectorFieldValue`, and
related constants — see [Vector Search](/flintfire/guides/advanced/vector-search/).
