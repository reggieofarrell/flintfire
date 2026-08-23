---
# Splash landing page for the published docs site (distinct from the Documentation overview page).
title: FlintFire
description:
  Type-safe, schema-aware Firestore data access for Node.js and the Firebase Admin SDK — validation,
  hooks, and a fluent query builder.
template: splash
hero:
  title: FlintFire
  tagline:
    Type-safe Firestore for the Firebase Admin SDK. Repositories, Zod validation, lifecycle hooks,
    and a fluent query builder — built for Node.js backends.
  image:
    html: |
      <span class="flintfire-hero-mark" style="display:inline-block;aspect-ratio:288/473;width:min(12rem,40vw);">
        <img
          src="/flintfire/flint-fire-icon-light.svg"
          alt="FlintFire"
          width="288"
          height="473"
          class="dark:sl-hidden"
          style="width:100%;height:100%;object-fit:contain;"
        />
        <img
          src="/flintfire/flint-fire-icon-dark.svg"
          alt="FlintFire"
          width="480"
          height="789"
          class="light:sl-hidden"
          style="width:100%;height:100%;object-fit:contain;"
        />
      </span>
  actions:
    # Include `base` explicitly: Starlight hero actions do not auto-prefix absolute `/…` links, and
    # relative `./…` links break when the splash URL is served without a trailing slash
    # (`/flintfire` → `./getting-started/` resolves to `/getting-started/`).
    - text: Get started
      link: /flintfire/getting-started/
      icon: right-arrow
      variant: primary
    - text: GitHub
      link: https://github.com/reggieofarrell/flintfire
      icon: external
      variant: minimal
---

## Why FlintFire?

- **Type-safe repositories** — one consistent API per collection, inferred from your Zod schemas.
- **Validation on writes** — schemas run before Firestore sees the payload; sentinels stay atomic.
- **Lifecycle hooks** — `before*` / `after*` hooks around create, update, and delete.
- **Fluent queries** — filters, pagination, aggregations, streaming, and real-time listeners.
- **Admin SDK native** — Express, NestJS, Cloud Functions, or any Node.js server.

## Where to go next

1. **[Getting Started](/flintfire/getting-started/)** — install peers, define a schema, create
   and query documents.
2. **[Documentation overview](/flintfire/overview/)** — full guide index by topic.
3. **[Core Concepts](/flintfire/guides/concepts/core-concepts/)** — repository pattern,
   converters, and delete semantics.
4. **[API Reference](/flintfire/reference/repository/)** — every `FirestoreRepository` /
   `FirestoreQueryBuilder` signature.
