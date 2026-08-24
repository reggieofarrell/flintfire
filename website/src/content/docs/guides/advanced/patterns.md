---
title: 'Advanced Patterns'
description:
  'Custom repository methods, audit logging, caching, event-driven updates, and denormalization with
  FlintFire.'
---

Production-tested recipes that compose FlintFire's hooks, transactions, and repository extension
points into larger architectural patterns.

Most of these recipes lean on two building blocks:
[lifecycle hooks](/flintfire/guides/concepts/lifecycle-hooks/) to react to writes, and
[transactions](/flintfire/guides/working-with-data/transactions/) to keep connected writes
atomic. Where a recipe uses the `withSchema` factory, remember that the schema **must not** declare
a top-level `id` — the factory rejects it at construction, because the document name is the sole
source of `id`. See [schema validation](/flintfire/guides/concepts/schema-validation/) for
details.

The recipes below are independent; jump to whichever one fits your problem:

- [Custom repository methods](#custom-repository-methods)
- [Audit logging](#audit-logging)
- [Caching layer](#caching-layer)
- [Full-text search](#full-text-search)
- [Event-driven architecture](#event-driven-architecture)
- [Multi-database pattern](#multi-database-pattern)
- [Data archiving](#data-archiving)
- [Rate limiting](#rate-limiting)
- [Enforced denormalization](#enforced-denormalization)

## Custom repository methods

Adding domain-specific helpers on top of a collection repository is a supported extension point.
Choose **subclassing** when callers should keep the full `FirestoreRepository` surface (plus your
methods), or **composition** when you want a narrower app-owned API (or when you prefer to keep
`withSchema` as the construction path).

### Subclassing

Extend `FirestoreRepository` and call its public methods from your helpers. Prefer
`FirestoreRepository.withSchemaArgs(...)` when the subclass needs schema validation — it performs the
same argument assembly `withSchema` does, so the read / write / stored split is correct by
construction (including write overlays):

```typescript
import { FirestoreRepository } from 'flintfire';
import { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const userSchema = z.object({
  email: z.email(),
  active: z.boolean(),
});

type User = z.infer<typeof userSchema>;

class UserRepository extends FirestoreRepository<User> {
  constructor(db: Firestore) {
    // `withSchema` always returns a plain `FirestoreRepository` — it cannot construct your subclass.
    // `withSchemaArgs` returns the constructor tuple `withSchema` would pass; spread it into super.
    super(...FirestoreRepository.withSchemaArgs(db, 'users', userSchema));
  }

  async findByEmail(email: string) {
    return this.findByField('email', email);
  }

  async deactivate(id: string) {
    return this.patch(id, { active: false });
  }
}

export const userRepo = new UserRepository(db);
```

Write overlay (cast-free combinator writes) — same helper, no hand-rolled schema bundle:

```typescript
import { FirestoreRepository, zNumberWrite } from 'flintfire';
import { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const userSchema = z.object({
  email: z.email(),
  active: z.boolean(),
  loginCount: z.number(),
});
const userWrite = z.object({
  email: z.email(),
  active: z.boolean(),
  loginCount: zNumberWrite(), // number | FieldValue.increment(...)
});

type User = z.output<typeof userSchema>;
type UserWrite = z.input<typeof userWrite>;
type UserParsed = z.output<typeof userWrite>;

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

Design constraints for subclasses:

- Build custom logic on the **public** API (`create`, `getById`, `findByField`, `query()`,
  transactions, hooks, and so on). Collection refs, validators, and other internals are `private`
  and are not available to subclasses.
- **Use `withSchemaArgs` for any schema-backed subclass.** It is the documented path: `schemas.read`
  is always the read schema, `schemas.stored` is always populated, and options like `readConverter`,
  `sentinelPolicy`, `parentPath`, and `allowLegacyDatastoreIds` stay in a named bag instead of
  positional `undefined`s. Calling `makeValidator(writeSchema)` alone and spreading that into
  `super(...)` is still possible (the constructor is public) but leaves `schemas.read` as the write
  overlay — read validation would then accept `FieldValue` sentinels a read should reject.
- **Your declared stored generic `S` is checked against `storedSchema`.** If you pass a
  `storedSchema` whose shape differs from the read model (because a `readConverter` reshapes reads,
  say), the `S` in your `extends FirestoreRepository<T, W, S, WO>` clause has to agree with it — a
  contradiction is a compile error at `super(...)`, not a silent mismatch. That matters because `S`
  is what types `collectionGroup()` and its field paths. The check rejects an unrelated `S` and one
  *wider* than the stored schema (which would invent field paths that nothing at rest has); a
  *narrower* `S` is allowed, since it only under-reports. Plain repositories, where the stored shape
  equals the read shape, need nothing extra.
- **Subclassing adds methods; it does not enforce invariants.** Overriding a write method intercepts
  only that method — most write paths do not route through it. If you need a rule that holds on
  every write, see [Enforced denormalization](#enforced-denormalization).

### Composition

Wrap a `withSchema` (or plain) repository and expose only the methods your app needs. This is the
same shape used by the [caching](#caching-layer) and [rate limiting](#rate-limiting) recipes, and by
the NestJS provider pattern in [Framework Integration](/flintfire/guides/integrations/express/):

```typescript
import { FirestoreRepository } from 'flintfire';

class UserRepository {
  private repo = FirestoreRepository.withSchema(db, 'users', userSchema);

  findByEmail(email: string) {
    return this.repo.findByField('email', email);
  }

  deactivate(id: string) {
    return this.repo.patch(id, { active: false });
  }

  // Delegate any other public methods your callers still need:
  getById(id: string) {
    return this.repo.getById(id);
  }
}

export const userRepo = new UserRepository();
```

Composition keeps validation and factory options on `withSchema`, while your wrapper owns the
convenience surface.

## Audit Logging

Track all data changes for compliance and debugging. A dedicated audit repository records who did
what, and lifecycle hooks feed it automatically on every create, update, and delete.

```typescript
// services/audit-log.service.ts
class AuditLogService {
  private auditRepo = new FirestoreRepository<AuditLog>(db, 'audit_logs');

  async record(action: string, data: any, userId?: string) {
    await this.auditRepo.create({
      action,
      data,
      userId: userId || 'system',
      timestamp: new Date().toISOString(),
      ipAddress: getCurrentIpAddress(),
      userAgent: getCurrentUserAgent(),
    });
  }
}

export const auditLog = new AuditLogService();

// Apply to all repositories
userRepo.on('afterCreate', async user => {
  await auditLog.record('user_created', user, user.id);
});

userRepo.on('afterUpdate', async ({ id }) => {
  const user = await userRepo.getById(id);
  if (user) {
    await auditLog.record('user_updated', user, id);
  }
});

userRepo.on('afterDelete', async user => {
  await auditLog.record('user_deleted', { id: user.id }, user.id);
});
```

Note the hook payload shapes: `afterCreate` receives the full created document, `afterUpdate`
receives only `{ id }` (so re-read the document if you need the new values), and `afterDelete`
receives the full persisted document that was just removed.

## Caching Layer

Add Redis caching to reduce Firestore reads. Wrap the repository so reads check the cache first and
writes invalidate it.

```typescript
// repositories/cached-user.repository.ts
import { Redis } from 'ioredis';

class CachedUserRepository {
  private repo = FirestoreRepository.withSchema(db, 'users', userSchema);
  private cache = new Redis(process.env.REDIS_URL);
  private cacheTTL = 300; // 5 minutes

  async getById(id: string): Promise<FirestoreDocument<User> | null> {
    // Check cache first
    const cached = await this.cache.get(`user:${id}`);
    if (cached) {
      return JSON.parse(cached);
    }

    // Fallback to Firestore
    const user = await this.repo.getById(id);
    if (user) {
      await this.cache.setex(`user:${id}`, this.cacheTTL, JSON.stringify(user));
    }

    return user;
  }

  async update(id: string, data: Partial<User>): Promise<FirestoreDocument<User> | null> {
    await this.repo.update(id, data);
    // Invalidate cache
    await this.cache.del(`user:${id}`);
    return this.repo.getById(id);
  }

  async create(data: Omit<User, 'createdAt' | 'updatedAt'>): Promise<{ id: ID }> {
    return this.repo.create({
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // Delegate other methods to repo...
  query() {
    return this.repo.query();
  }
}

export const cachedUserRepo = new CachedUserRepository();
```

`userSchema` here must **not** declare a top-level `id`, since `FirestoreRepository.withSchema`
rejects it at construction — the document name is the sole source of `id`.

## Full-Text Search

Integrate with Algolia or Elasticsearch for full-text search. For Standard-edition Firestore and
Core operations there is no native full-text index, so mirror your documents into a search service
and keep the two in sync with hooks. (Firestore Enterprise's pre-GA Pipeline query model adds a
preview full-text search stage, but it requires the Enterprise edition and is not yet GA; an
external search service remains the recommendation for production Core-operation workloads. This ORM
wraps Core operations — see
[Scope & capabilities](/flintfire/reference/scope-and-capabilities/).)

```typescript
// services/search.service.ts
import algoliasearch from 'algoliasearch';

class SearchService {
  private client = algoliasearch(process.env.ALGOLIA_APP_ID!, process.env.ALGOLIA_ADMIN_KEY!);
  private usersIndex = this.client.initIndex('users');
  private productsIndex = this.client.initIndex('products');

  async indexUser(user: FirestoreDocument<User>) {
    await this.usersIndex.saveObject({
      objectID: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
    });
  }

  async deleteUser(userId: string) {
    await this.usersIndex.deleteObject(userId);
  }

  async searchUsers(query: string) {
    const { hits } = await this.usersIndex.search(query);
    return hits;
  }
}

export const searchService = new SearchService();

// Sync with Algolia on user changes
userRepo.on('afterCreate', async user => {
  await searchService.indexUser(user);
});

userRepo.on('afterUpdate', async ({ id }) => {
  const user = await userRepo.getById(id);
  if (user) {
    await searchService.indexUser(user);
  }
});

userRepo.on('afterDelete', async user => {
  await searchService.deleteUser(user.id);
});
```

## Event-Driven Architecture

Publish domain events to a message queue. Repository hooks emit events, and any number of consumers
subscribe to them — decoupling side effects (email, analytics, inventory) from the write path.

```typescript
// services/event-publisher.service.ts
import { EventEmitter } from 'events';

class EventPublisher extends EventEmitter {
  async publish(event: string, data: any) {
    this.emit(event, data);
    // Also publish to external queue (RabbitMQ, SQS, etc.)
    await messageQueue.publish(event, data);
  }
}

export const eventPublisher = new EventPublisher();

// Publish events on repository actions
userRepo.on('afterCreate', async user => {
  await eventPublisher.publish('user.created', user);
});

orderRepo.on('afterCreate', async order => {
  await eventPublisher.publish('order.placed', order);
});

// Consumers can subscribe to events
eventPublisher.on('user.created', async user => {
  await emailService.sendWelcomeEmail(user.email);
  await analyticsService.trackSignup(user);
});

eventPublisher.on('order.placed', async order => {
  await inventoryService.reserveStock(order);
  await notificationService.notifyWarehouse(order);
});
```

## Multi-Database Pattern

Use different databases for different data types — for example, a primary database for transactional
data and a separate database for analytics/reporting. Each database gets its own `Firestore`
instance, and repositories are bound to the instance they read and write.

```typescript
// config/database.ts
import { getFirestore } from 'firebase-admin/firestore';

// Primary database for transactional data
export const primaryDb = getFirestore(primaryApp);

// Analytics database for reporting
export const analyticsDb = getFirestore(analyticsApp);

// repositories/user.repository.ts
export const userRepo = FirestoreRepository.withSchema(primaryDb, 'users', userSchema);

// repositories/analytics.repository.ts
export const userAnalyticsRepo = new FirestoreRepository<UserAnalytics>(
  analyticsDb,
  'user_analytics',
);

// Sync analytics data
userRepo.on('afterCreate', async user => {
  await userAnalyticsRepo.create({
    userId: user.id,
    signupDate: user.createdAt,
    source: user.source,
    plan: user.plan,
  });
});
```

## Data Archiving

Archive documents to a separate collection before permanently deleting them from the primary
collection. The generic helper works against any repository.

```typescript
class ArchivingService {
  private archiveRepo = new FirestoreRepository<ArchivedDocument>(db, 'archived_documents');

  async archiveAndDelete<T extends object>(
    repo: FirestoreRepository<T>,
    id: string,
  ): Promise<void> {
    // Get document
    const doc = await repo.getById(id);
    if (!doc) {
      throw new NotFoundError('Document not found');
    }

    // Archive to separate collection
    await this.archiveRepo.create({
      originalCollection: repo.getCollectionPath(),
      originalId: id,
      data: doc,
      archivedAt: new Date().toISOString(),
    });

    // Permanently delete from original collection
    await repo.delete(id);
  }
}

export const archivingService = new ArchivingService();

// Usage
await archivingService.archiveAndDelete(userRepo, 'user-123');
```

The generic parameter is constrained with `T extends object` to match `FirestoreRepository`'s own
constraint. For stronger guarantees you can run the read, the archive write, and the delete inside a
single [transaction](/flintfire/guides/working-with-data/transactions/).

## Rate Limiting

Implement rate limiting at the repository level by wrapping write methods and consuming a token
before each call.

```typescript
// decorators/rate-limited-repository.ts
import { RateLimiterMemory } from 'rate-limiter-flexible';

class RateLimitedRepository<T extends object> {
  private rateLimiter = new RateLimiterMemory({
    points: 100, // 100 requests
    duration: 60, // per 60 seconds
  });

  constructor(private repo: FirestoreRepository<T>) {}

  async create(data: CreateInput<T>, userId: string): Promise<{ id: ID }> {
    await this.rateLimiter.consume(userId);
    return this.repo.create(data);
  }

  async update(id: ID, data: UpdateInput<T>, userId: string): Promise<{ id: ID }> {
    await this.rateLimiter.consume(userId);
    return this.repo.update(id, data);
  }

  // Delegate other methods...
}

export const rateLimitedUserRepo = new RateLimitedRepository(userRepo);
```

As with the archiving helper, the generic parameter is constrained with `T extends object` so it
satisfies `FirestoreRepository`'s type bound.

## Enforced Denormalization

When a denormalized field must never drift — an order's status mirrored onto its user, a counter that
has to match its source — you need the rule to hold on **every** write, not just the one you
remembered to route. This section is about that guarantee.

### 1. Use a facade that owns the write paths

Hold the repositories **private** inside a service and expose only the operations you have written.
Each one wraps the primary write and its denormalized sibling in a single transaction, so they commit
together or not at all. The bypass paths are not intercepted — they are simply **unreachable**.

```typescript
import { FirestoreRepository } from 'flintfire';
import type { DataOf, ID, ReadOnlyQuery, UpdateInput } from 'flintfire';

const orderRepo = FirestoreRepository.withSchema(db, 'orders', orderSchema);
const userRepo = FirestoreRepository.withSchema(db, 'users', userSchema);

type Order = DataOf<typeof orderRepo>;

class OrderService {
  constructor(
    private readonly orders: typeof orderRepo,
    private readonly users: typeof userRepo,
  ) {}

  // Reads: hand out a ReadOnlyQuery (or keep curated terminal read helpers).
  getById(id: ID) {
    return this.orders.getById(id);
  }
  query(): ReadOnlyQuery<Order> {
    return this.orders.query();
  }
  countByStatus(status: Order['status']) {
    return this.orders.query().where('status', '==', status).count();
  }
  listByStatus(status: Order['status'], pageSize: number, cursor?: string | null) {
    return this.orders
      .query()
      .where('status', '==', status)
      .orderBy('updatedAt')
      .paginate(pageSize, cursor);
  }

  // The only write path — primary write and denormalized sibling in one transaction.
  async setStatus(id: ID, status: Order['status']): Promise<{ id: ID }> {
    return this.orders.runInTransaction(async (tx, repo) => {
      const order = await repo.getInTransaction(tx, id);
      if (!order) throw new Error(`Order ${id} not found`);

      const patch: UpdateInput<Order> = { status, updatedAt: new Date().toISOString() };
      await repo.updateInTransaction(tx, id, patch);
      await this.users.updateInTransaction(
        tx,
        order.userId,
        { lastOrderId: id, lastOrderStatus: status },
        { merge: true },
      );

      return { id };
    });
  }
}
```

Because `orders` and `users` are `private`, `orderService.update(...)`, `.upsert(...)`,
`.bulkUpdate(...)`, `.bulkWrite(...)`, `.delete(...)`, `.recursiveDeleteCollection(...)` and the rest
are **compile errors** — there is no path to a write that skips `setStatus`.

:::tip[Handing out the query builder safely]
`ReadOnlyQuery` makes `update()` / `delete()` absent at every chain depth — annotate
`query(): ReadOnlyQuery<Order>` and return `this.orders.query()` with no cast. A bare
`Omit` of those two members does **not** work: TypeScript resolves `this` against the declared
receiver, so the first `.where(...)` hands the full builder back. The guarantee is compile-time
only; a deliberate cast still reaches the write terminals. See
[Read-only view](/flintfire/reference/query-builder/#read-only-view).

:::

### 2. Why not subclass and override the write methods?

Because an override is reached by almost nothing. Overriding `update` intercepts `update()` and
`patch()` (which delegates to it) — and **nothing else**:

| Family   | Override is reached by | Bypassed                                                                                                                             |
| -------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `update` | `update()`, `patch()`  | `upsert()`, `bulkUpdate()`, `bulkPatch()`, `query().update()`, `bulkWrite()`, `updateInTransaction()`, `patchInTransaction()`         |
| `create` | `create()`             | `createWithId()`, `bulkCreate()`, `bulkCreateWithIds()`, `upsert()`, `createInTransaction()`, `createWithIdInTransaction()`, `bulkWrite()` |
| `delete` | `delete()`            | `bulkDelete()`, `query().delete()`, `deleteInTransaction()`, `bulkWrite()`, `recursiveDelete()`, `recursiveDeleteCollection()`        |

`upsert()` is the sharpest surprise: on an existing document it behaves as an update, but it does not
route through `update()`, so an override never sees it. The transaction-scoped `repo` handed to
`runInTransaction` is also a plain `FirestoreRepository`, not your subclass, so writes inside a
transaction callback never re-enter an override either.

Overriding is still the right tool for **adding** behavior to one entry point — see
[Custom repository methods](#custom-repository-methods). It is not a mechanism for enforcing an
invariant.

### 3. Hooks: broad coverage, but not atomic

A `before*` hook plus its `beforeBulk*` counterpart covers far more paths than an override, and
`bulkWrite` **throws** rather than silently skipping when a bulk hook is registered:

| Family   | Hooks to register                    | Coverage                                                                                      |
| -------- | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `update` | `beforeUpdate` + `beforeBulkUpdate`  | all update paths; `bulkWrite` throws                                                          |
| `create` | `beforeCreate` + `beforeBulkCreate`  | all create paths; `bulkWrite` throws                                                          |
| `delete` | `beforeDelete` + `beforeBulkDelete`  | all delete paths; `bulkWrite` throws — **but `recursiveDelete()` and `recursiveDeleteCollection()` run no hooks and do not throw** |

Two limits decide whether hooks are enough for you:

- **A hook cannot join the caller's transaction.** `HookContext` carries `event`, `execution`,
  `retryable` and `attempt` — no transaction handle — so a hook cannot write a sibling document
  *atomically* with the primary write. Use hooks when eventual consistency is acceptable; use the
  facade when it is not.
- **On the delete side there is a silent gap.** The two recursive deletes fire no delete hooks at all
  (see
  [operations that run no hooks](/flintfire/guides/concepts/lifecycle-hooks/#operations-that-run-no-hooks)),
  so a delete invariant enforced by hooks does not hold across them.

### Choosing

| You need                                            | Use                                                       |
| --------------------------------------------------- | --------------------------------------------------------- |
| A denormalized write that is **atomic** with its primary write | The facade (§1)                                  |
| Broad coverage where eventual consistency is fine   | Hooks (§3), minding the recursive-delete gap              |
| Extra behavior on one specific method               | A subclass override ([custom methods](#custom-repository-methods)) |
