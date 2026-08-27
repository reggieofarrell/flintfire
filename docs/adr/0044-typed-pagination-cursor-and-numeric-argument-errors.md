# ADR-0044: Typed pagination-cursor errors and numeric argument TypeErrors

- **Status:** Accepted
- **Date:** 2026-08-27
- **Deciders:** maintainer
- **Related:** Pagination query builders; vector-search input validation; Express adapter

## Context

Opaque pagination cursors cross an untrusted boundary. FlintFire previously reported malformed,
foreign-source, and deleted-document cursors with plain `Error` instances whose only discriminator
was message text. Applications therefore had to parse mutable strings to return a client error, and
were tempted to preserve or log the untrusted token or decoded Firestore path.

Local numeric guards in pagination and vector APIs also threw plain `Error`. These failures are
caller argument misuse, distinct from Firestore, query-composition, and application failures, but
the error type did not express that distinction.

## Decision

We will:

1. Export one `InvalidPaginationCursorError` class carrying a required
   `InvalidPaginationCursorReason` discriminant: `'malformed'`, `'source_mismatch'`, or `'stale'`.
   Its message is stable and non-sensitive. The class never retains the cursor token, decoded path,
   parser failure, or another cause.
2. Raise that class from collection and collection-group opaque pagination. Typed query bounds
   continue to expose their existing Admin SDK behavior because they do not decode FlintFire's
   opaque cursor token.
3. Map the class to HTTP 400 in the optional Express adapter and serialize only
   `{ error: 'InvalidPaginationCursorError', reason }`.
4. Throw the built-in `TypeError` for invalid numeric arguments validated locally: pagination page,
   page-size, offset, and limit-to-last values; vector query components, dimensions, limits, and
   distance thresholds. Messages remain descriptive but are not the machine-readable contract.
5. Keep nonnumeric and query-composition misuse on ordinary `Error` unless it already has a more
   specific public class.

## Consequences

- API layers can map cursor failures without regular expressions or message matching.
- Consumers can distinguish invalid numeric call arguments with `instanceof TypeError` without a
  FlintFire-specific class.
- Existing consumers that assert only `Error` continue to work because both new forms extend
  `Error`. Consumers that assert the exact base constructor or message text must update.
- Adding a cursor failure category requires extending the public reason union, its safe message map,
  adapter tests, and documentation together.
- Firestore SDK numeric errors that bypass local guards are not relabeled; this decision covers
  FlintFire-owned argument validation only.

## Alternatives considered

- **One class per cursor failure category** — rejected because one discriminated class is easier to
  map and extend while preserving exhaustive handling through the reason union.
- **Keep plain `Error` and standardize messages** — rejected because strings are presentation, not a
  durable application contract.
- **Attach the token, path, or parser cause for diagnostics** — rejected because those values are
  untrusted and could leak through logs or HTTP serialization.
- **Create a custom numeric-argument error** — rejected because JavaScript's built-in `TypeError`
  already represents a value that violates a function's argument contract.
- **Use `RangeError` for out-of-range numbers** — rejected in favor of one consistent numeric misuse
  contract across wrong types, non-finite values, non-integers, and disallowed ranges.

## References

- `src/core/Errors.ts`
- `src/core/QueryBuilder.ts`
- `src/core/CollectionGroup.ts`
- `src/vector/VectorSearch.ts`
- `src/vector/vectorEmbeddingSchema.ts`
- `src/express/index.ts`
