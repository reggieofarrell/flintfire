---
title: "@reggieofarrell/firestore-orm"
description: Type-safe Firestore ORM for the Firebase Admin SDK — validation,
  hooks, and a fluent query builder.
template: splash
hero:
  title: "@reggieofarrell/firestore-orm"
  tagline: Type-safe Firestore for the Firebase Admin SDK. Repositories, Zod
    validation, lifecycle hooks, and a fluent query builder — built for Node.js
    backends.
  actions:
    # Include `base` explicitly (same trailing-slash footgun as the current splash — see index.md).
    - text: Get started
      link: /flintfire/2.0/getting-started/
      icon: right-arrow
      variant: primary
    - text: GitHub
      link: https://github.com/reggieofarrell/flintfire
      icon: external
      variant: minimal
slug: "2.0"
---

## Why `@reggieofarrell/firestore-orm`?

* **Type-safe repositories** — one consistent API per collection, inferred from your Zod schemas.
* **Validation on writes** — schemas run before Firestore sees the payload; sentinels stay atomic.
* **Lifecycle hooks** — `before*` / `after*` hooks around create, update, and delete.
* **Fluent queries** — filters, pagination, aggregations, streaming, and real-time listeners.
* **Admin SDK native** — Express, NestJS, Cloud Functions, or any Node.js server.

## Where to go next

1. **[Getting Started](/flintfire/2.0/getting-started/)** — install peers, define a schema, create and query
   documents.
2. **[Documentation overview](/flintfire/2.0/overview/)** — full guide index by topic.
3. **[Core Concepts](/flintfire/2.0/guides/core-concepts/)** — repository pattern, converters, and delete
   semantics.
4. **[API Reference](/flintfire/2.0/guides/api-reference/)** — every `FirestoreRepository` /
   `FirestoreQueryBuilder` signature.
