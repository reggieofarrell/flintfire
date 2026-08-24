/**
 * Type-level tests for the enforced-denormalization facade documented in
 * `website/src/content/docs/guides/advanced/patterns.md`, checked by `npm run test:types` via tsc
 * (NOT jest). This file is never executed.
 *
 * WHY THIS EXISTS: the published guide previously showed a `FirestoreRepository` subclass that
 * overrode `update` / `patch`. It did not compile (the base methods are overloaded, so a union
 * return type is not assignable — TS2416), and it could not enforce anything: an `update` override
 * is reached only by `update()` and `patch()`, while `upsert`, the bulk helpers, `query().update()`,
 * `bulkWrite` and the transaction helpers all bypass it. No gate compiled doc snippets, so the
 * breakage shipped. This file pins the replacement.
 *
 * The contract this pins:
 *  - The facade's read helpers and its single transactional write path type-check verbatim, exactly
 *    as the guide shows them.
 *  - EVERY write path is unreachable through the facade. The repositories are `private`, so each
 *    bypass below is a compile error rather than a silent write that skips the denormalized sibling.
 *  - The facade does NOT hand back a query builder. `Omit<FirestoreQueryBuilder, 'update'|'delete'>`
 *    does not hold — clause methods return `this` (the full builder), so one `.where(...)` restores
 *    the write terminals. The `leakIsReal` guard below pins that fact, so if a future change makes
 *    `Omit` sufficient (see ADR-0041) this test fails loudly and the guide can be simplified.
 *
 * Each `@ts-expect-error` FAILS the type-check if the line below it stops being an error; every
 * un-annotated call must type-check.
 */
import { z } from 'zod';
import { Firestore } from 'firebase-admin/firestore';
import { FirestoreRepository, FirestoreQueryBuilder } from '../../index.js';
import type { DataOf, ID, UpdateInput } from '../../index.js';

declare const db: Firestore;

const orderSchema = z.object({
  userId: z.string(),
  status: z.enum(['pending', 'shipped']),
  updatedAt: z.string(),
});
const userSchema = z.object({
  lastOrderId: z.string().optional(),
  lastOrderStatus: z.string().optional(),
});

const orderRepo = FirestoreRepository.withSchema(db, 'orders', orderSchema);
const userRepo = FirestoreRepository.withSchema(db, 'users', userSchema);
type Order = DataOf<typeof orderRepo>;

/** The facade exactly as the guide documents it. */
class OrderService {
  constructor(
    private readonly orders: typeof orderRepo,
    private readonly users: typeof userRepo,
  ) {}

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

const orders = new OrderService(orderRepo, userRepo);

/** The documented surface must type-check. */
async function documentedSurfaceCompiles() {
  const doc = await orders.getById('o1');
  const total: number = await orders.countByStatus('pending');
  const page = await orders.listByStatus('pending', 20);
  const written: { id: ID } = await orders.setStatus('o1', 'shipped');
  return [doc, total, page.items, page.nextCursor, written];
}

/** Every write path must be unreachable — twelve guards, one per bypass. */
async function everyWritePathIsBlocked() {
  // @ts-expect-error  update() is not on the facade
  await orders.update('o1', { status: 'shipped' });
  // @ts-expect-error  patch() is not on the facade
  await orders.patch('o1', { status: 'shipped' });
  // @ts-expect-error  upsert() is not on the facade (it bypasses an `update` override entirely)
  await orders.upsert('o1', { userId: 'u', status: 'shipped', updatedAt: 't' });
  // @ts-expect-error  createWithId() is not on the facade
  await orders.createWithId('o2', { userId: 'u', status: 'pending', updatedAt: 't' });
  // @ts-expect-error  create() is not on the facade
  await orders.create({ userId: 'u', status: 'pending', updatedAt: 't' });
  // @ts-expect-error  bulkUpdate() is not on the facade
  await orders.bulkUpdate([{ id: 'o1', data: { status: 'shipped' } }]);
  // @ts-expect-error  bulkPatch() is not on the facade
  await orders.bulkPatch([{ id: 'o1', data: { status: 'shipped' } }]);
  // @ts-expect-error  bulkWrite() is not on the facade
  await orders.bulkWrite([{ op: 'update', id: 'o1', data: { status: 'shipped' } }]);
  // @ts-expect-error  delete() is not on the facade
  await orders.delete('o1');
  // @ts-expect-error  bulkDelete() is not on the facade
  await orders.bulkDelete(['o1']);
  // @ts-expect-error  recursiveDelete() is not on the facade
  await orders.recursiveDelete('o1');
  // @ts-expect-error  recursiveDeleteCollection() is not on the facade
  await orders.recursiveDeleteCollection();
  // @ts-expect-error  no query builder escapes, so query().update()/delete() are unreachable
  await orders.query();
}

/**
 * Pins WHY the facade exposes terminating read helpers instead of the builder: `Omit` narrowing is
 * defeated by the fluent `this` return type. If ADR-0041 lands a self-returning read-only type,
 * the second assertion here starts failing — which is the signal to update the guide.
 */
async function omitNarrowingLeakIsReal() {
  type Narrowed = Omit<FirestoreQueryBuilder<Order, Order, Order>, 'update' | 'delete'>;
  const q = orderRepo.query() as Narrowed;

  // @ts-expect-error  blocked on the immediate object …
  await q.update({ status: 'shipped' });

  // … but NOT after any clause call: `where()` returns `this`, typed as the full builder. No
  // `@ts-expect-error` here on purpose — this line compiling is the defect being documented.
  await q.where('status', '==', 'pending').update({ status: 'shipped' });
  await q.orderBy('updatedAt').delete();
}

export { documentedSurfaceCompiles, everyWritePathIsBlocked, omitNarrowingLeakIsReal };
