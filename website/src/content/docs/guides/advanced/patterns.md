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

Extend `FirestoreRepository` and call its public methods from your helpers:

```typescript
import { FirestoreRepository, makeValidator } from 'flintfire';
import { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const userSchema = z.object({
  email: z.email(),
  active: z.boolean(),
});

type User = z.infer<typeof userSchema>;

class UserRepository extends FirestoreRepository<User> {
  constructor(db: Firestore) {
    // Pass a validator when the subclass needs the same runtime validation `withSchema` provides.
    // `withSchema` always returns a plain `FirestoreRepository` — it cannot construct your subclass.
    super(db, 'users', makeValidator(userSchema));
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

Design constraints for subclasses:

- Build custom logic on the **public** API (`create`, `getById`, `findByField`, `query()`,
  transactions, hooks, and so on). Collection refs, validators, and other internals are `private`
  and are not available to subclasses.
- `super(db, path, makeValidator(schema))` is enough for the common case. The constructor falls back
  to the validator's own schema bundle, so `repo.schemas`, `repo.readSchema`, `validate()` and
  `safeValidate()` all work — you do not need to pass a `RepositorySchemaSet` as well.
- **If you use a write overlay, pass the schema bundle explicitly.** `makeValidator(writeSchema)`
  derives its bundle from whatever schema you hand it, so `schemas.read` would be the *write*
  schema — and read validation would then accept `FieldValue` sentinels that a read should reject.
  Mirror what `withSchema` does: build the validator from the write schema, then pass a bundle whose
  `read` is the real read schema.

  ```typescript
  const validator = makeValidator(userWriteSchema);
  super(db, 'users', validator, undefined, undefined, {
    read: userSchema, // the READ schema — not the write overlay
    create: validator.schemas.create,
    update: validator.schemas.update,
    stored: userStoredSchema ?? userSchema,
  });
  ```

- `schemas.stored` is not populated by the fallback. It is only consulted by `collectionGroup()`, to
  reject a stored shape that collides with group identity (`path` / `parentPath`), so supply it if
  you use collection-group queries with a divergent stored shape.
- Prefer composition (below) when you would rather not re-wire `withSchema`'s options
  (`writeSchema`, `storedSchema`, `readConverter`, `sentinelPolicy`, `allowLegacyDatastoreIds`)
  through positional `super(...)` arguments.
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
import type { DataOf, ID, UpdateInput } from 'flintfire';

const orderRepo = FirestoreRepository.withSchema(db, 'orders', orderSchema);
const userRepo = FirestoreRepository.withSchema(db, 'users', userSchema);

type Order = DataOf<typeof orderRepo>;

class OrderService {
  constructor(
    private readonly orders: typeof orderRepo,
    private readonly users: typeof userRepo,
  ) {}

  // Reads: terminating helpers (see the note below on why the query builder is not exposed).
  getById(id: ID) {
    return this.orders.getById(id);
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

:::note[Why reads are terminating helpers rather than a query builder]
Returning the query builder would hand back `query().update()` and `query().delete()`, and narrowing
it does **not** work: `Omit<FirestoreQueryBuilder<…>, 'update' | 'delete'>` blocks only the immediate
call, because the chainable clause methods return `this` (typed as the full builder). A single
`.where(...)` restores the write terminals:

```typescript
declare const q: Omit<FirestoreQueryBuilder<Order, Order, Order>, 'update' | 'delete'>;
await q.update({ status: 'shipped' }); // ✗ blocked
await q.where('status', '==', 'pending').update({ status: 'shipped' }); // ✓ compiles — leak
```

So expose terminating helpers (`count()`, `paginate()`, `get()` called inside the facade) and let no
builder escape.
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
