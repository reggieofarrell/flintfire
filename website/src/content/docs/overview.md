---
title: Documentation overview
description: Index of FlintFire docs — a Guides pillar (learn) and a Reference pillar (look up).
---

Topic index for `flintfire`. New to the library? Start with
[Getting Started](/flintfire/getting-started/), then follow the **Guides** pillar in order (the
sidebar gives you prev/next). Reach for the **Reference** pillar when you need an exact signature.

## How this is organized

The docs split into two pillars:

- **Guides** — learn the library in a sensible order: get started, the core concepts (the mental
  model), working with data day to day, designing your data model, advanced features, framework
  integrations, and upgrading.
- **Reference** — look up exact signatures and contracts: the repository and query-builder classes,
  exported types, runtime helpers, error classes, scope, and troubleshooting.

## Guides

### Get started

| Page                                               | What it covers                                 |
| -------------------------------------------------- | ---------------------------------------------- |
| [Getting Started](/flintfire/getting-started/) | Install, initialize, define a schema, and CRUD |
| [Documentation overview](/flintfire/overview/) | This page — the docs map                       |

### Core concepts

| Page                                                                                 | What it covers                                                 |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| [Core Concepts](/flintfire/guides/concepts/core-concepts/)                       | Repository pattern, the four generics, delete behavior         |
| [Document Identity](/flintfire/guides/concepts/document-identity/)               | Virtual identity, no top-level `id`, `repo.id()`, `whereId`    |
| [Schema Validation](/flintfire/guides/concepts/schema-validation/)               | Zod validation lifecycle, derived create/update schemas        |
| [Read Converters](/flintfire/guides/concepts/read-converters/)                   | Read-only `readConverter`, required `storedSchema`, id overlay |
| [Per-Field Sentinel Approval](/flintfire/guides/concepts/field-value-sentinels/) | Write combinators and `sentinelPolicy: 'strict'`               |
| [Timestamps ↔ Millis](/flintfire/guides/concepts/timestamps/)                    | `createMillisTimestampConverter` and the timestamp pattern     |
| [Lifecycle Hooks](/flintfire/guides/concepts/lifecycle-hooks/)                   | `before*`/`after*` hooks, payloads, and ordering               |

### Working with data

| Page                                                                        | What it covers                                                                          |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [CRUD Operations](/flintfire/guides/working-with-data/crud-operations/) | Create, read, update, delete, and bulk variants                                         |
| [Queries](/flintfire/guides/working-with-data/queries/)                 | Query builder, composite filters, collection groups, aggregations, streaming, real-time |
| [Transactions](/flintfire/guides/working-with-data/transactions/)       | `runInTransaction` and the transaction-scoped methods                                   |
| [Subcollections](/flintfire/guides/working-with-data/subcollections/)   | Nested collections, collection-group reads, per-instance converters                     |
| [Dot Notation](/flintfire/guides/working-with-data/dot-notation/)       | Field-path updates, merge/patch, and `FieldValue` sentinels                             |

### Designing your data

| Page                                                                            | What it covers                                           |
| ------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [Data Modeling](/flintfire/guides/designing/data-modeling/)                 | Maps vs subcollections, arrays, denormalized query flags |
| [ID Strategies](/flintfire/guides/designing/id-strategies/)                 | Auto, deterministic, and shared document ids             |
| [Schema Evolution](/flintfire/guides/designing/schema-evolution/)           | Read-side normalization without a data migration         |
| [Trust Boundary & Security](/flintfire/guides/designing/security-boundary/) | Admin SDK bypasses rules; validate at the boundary       |
| [Best Practices](/flintfire/guides/designing/best-practices/)               | Recommended patterns for production use                  |
| [Performance & Cost](/flintfire/guides/designing/performance/)              | Firestore cost model, optimization tips, benchmarks      |

### Advanced

| Page                                                               | What it covers                                       |
| ------------------------------------------------------------------ | ---------------------------------------------------- |
| [Real-time & Listeners](/flintfire/guides/advanced/real-time/) | `listenOne` and query `onSnapshot`                   |
| [Advanced Patterns](/flintfire/guides/advanced/patterns/)      | Custom repository methods, denormalization, and more |
| [Real-World Examples](/flintfire/guides/advanced/examples/)    | End-to-end e-commerce, multi-tenant, and social feed |
| [Vector Search](/flintfire/guides/advanced/vector-search/)     | The optional `./vector` extension and `findNearest`  |

### Integrations & upgrading

| Page                                                                              | What it covers                                     |
| --------------------------------------------------------------------------------- | -------------------------------------------------- |
| [Express](/flintfire/guides/integrations/express/)                            | Route handlers and the `errorHandler` middleware   |
| [NestJS](/flintfire/guides/integrations/nestjs/)                              | DI module/service/controller stack                 |
| [Cloud Functions & Triggers](/flintfire/guides/integrations/cloud-functions/) | Mapping trigger snapshots with `fromSnapshot`      |
| [Testing with the Emulator](/flintfire/guides/integrations/testing/)          | Testing repositories against the local emulator    |
| [Migrating from v2 to v3](/flintfire/guides/migration-v2-to-v3/)              | Breaking changes and step-by-step upgrade from 2.x |

## Reference

| Page                                                                     | What it covers                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| [FirestoreRepository](/flintfire/reference/repository/)              | Construction, reads, writes, identity, hooks, txns                       |
| [FirestoreQueryBuilder](/flintfire/reference/query-builder/)         | Filtering, projection, aggregation, pagination, collection-group builder |
| [Exported Types](/flintfire/reference/types/)                        | `FirestoreDocument`, `DataOf`, `FieldPaths`, …                           |
| [Helpers & Utilities](/flintfire/reference/helpers/)                 | Validation combinators, timestamp & dot-notation                         |
| [Error Handling](/flintfire/reference/errors/)                       | Error classes and `parseFirestoreError`                                  |
| [Scope & Capabilities](/flintfire/reference/scope-and-capabilities/) | Supported surface and deferred capabilities                              |
| [Troubleshooting](/flintfire/reference/troubleshooting/)             | Common errors and their fixes                                            |
