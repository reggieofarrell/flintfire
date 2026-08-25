/**
 * Compile gate for the write-interceptor snippets published in the docs (issue #108 / ADR-0040),
 * checked by `npm run test:types` via tsc — NOT jest. This file is never executed.
 *
 * WHY THIS EXISTS: nothing else compiles a documentation code block. This repo has already shipped a
 * guide whose subclass snippet did not type-check (see
 * `enforced-denormalization-facade.type-test.ts`), and the first draft of the interceptor guide
 * repeated it — `write.data.userId` is `string | FieldValue | undefined` on the `'update'` branch,
 * because an update payload carries only the fields being written. That is a real constraint of the
 * API and the guide now teaches it; this file is what keeps the published snippet honest.
 *
 * The snippets below are **verbatim copies**. When either doc changes, change this file with it:
 *  - `website/src/content/docs/guides/advanced/patterns.md` → `### 1. Register a write interceptor`
 *  - `website/src/content/docs/reference/repository.md` → `### Write interceptors`
 */
import { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository } from '../../index.js';

declare const db: Firestore;

const orderSchema = z.object({
  userId: z.string(),
  status: z.enum(['pending', 'shipped']),
});
const userSchema = z.object({
  lastOrderId: z.string().optional(),
  lastOrderStatus: z.string().optional(),
});
const auditSchema = z.object({
  orderId: z.string(),
  event: z.string().optional(),
  revision: z.number().optional(),
});

const orderRepo = FirestoreRepository.withSchema(db, 'orders', orderSchema);
const userRepo = FirestoreRepository.withSchema(db, 'users', userSchema);
const auditRepo = FirestoreRepository.withSchema(db, 'audit', auditSchema);

/* ---------------------------------------------------------------------------------------------- *
 * patterns.md — "### 1. Register a write interceptor", first snippet (write-only).
 * ---------------------------------------------------------------------------------------------- */

orderRepo.registerWriteInterceptor({
  name: 'mirror-order-status-onto-user',
  write: ({ write, writer }) => {
    // `write` is discriminated on `kind`: 'create' | 'update' | 'delete'.
    if (write.kind === 'delete') {
      // A delete hands over the whole STORED document, so the owning user is always known.
      writer.update(userRepo, write.document.userId, { lastOrderStatus: 'deleted' });
      return;
    }
    if (write.kind === 'create') {
      // A create carries the full validated document.
      writer.set(
        userRepo,
        write.data.userId,
        { lastOrderId: write.id, lastOrderStatus: write.data.status },
        { merge: true },
      );
      return;
    }
    // An UPDATE payload carries only the fields being written, so both are optional here — the
    // types say so, rather than letting you address `undefined`. A write-only interceptor can mirror
    // only what the caller actually supplied; to fill the gap, read the order (next example).
    const { userId, status } = write.data;
    if (typeof userId === 'string' && typeof status === 'string') {
      writer.set(
        userRepo,
        userId,
        { lastOrderId: write.id, lastOrderStatus: status },
        { merge: true },
      );
    }
  },
});

/* ---------------------------------------------------------------------------------------------- *
 * patterns.md — "#### The mode is inferred, not declared" (read-capable).
 * ---------------------------------------------------------------------------------------------- */

orderRepo.registerWriteInterceptor({
  name: 'order-revision',
  // Runs BEFORE any write is staged: Firestore requires all reads in a transaction to precede all
  // writes, which is why `write` below is synchronous. Put I/O here, never there.
  read: async ({ write, reader }) => await reader.get(auditRepo, write.id),
  write: ({ write, writer, reads }) => {
    // `reads` is typed exactly as `read` returned it — here `FirestoreDocument<Audit> | null`.
    writer.set(auditRepo, write.id, { orderId: write.id, revision: (reads?.revision ?? 0) + 1 });
  },
});

/* ---------------------------------------------------------------------------------------------- *
 * repository.md — "### Write interceptors", closing snippet.
 * ---------------------------------------------------------------------------------------------- */

orderRepo.registerWriteInterceptor({
  name: 'order-audit-trail',
  write: ({ write, writer }) => {
    if (write.kind === 'delete') {
      writer.delete(auditRepo, write.id);
      return;
    }
    writer.set(auditRepo, write.id, { orderId: write.id, event: write.kind }, { merge: true });
  },
});

/* ---------------------------------------------------------------------------------------------- *
 * Which member to use when the sibling's write model has REQUIRED fields.
 *
 * `set` creates the document when it is absent, so its payload is the target's COMPLETE write model
 * on both branches — `{ merge: true }` only controls whether unmentioned fields survive, it does not
 * make the payload partial. A partial payload cannot produce a document that satisfies its own
 * schema, and because reads are not validated the result would come back typed as complete while
 * missing its required fields.
 *
 * So a write that touches a SUBSET of fields is `update`, which fails when the document is missing.
 * That failure is the guard rail: you do not want an order write conjuring a half-formed member
 * record. This block pins both halves.
 * ---------------------------------------------------------------------------------------------- */

const memberSchema = z.object({
  displayName: z.string(),
  email: z.string(),
  lastOrderStatus: z.string().optional(),
});
const memberRepo = FirestoreRepository.withSchema(db, 'members', memberSchema);

orderRepo.registerWriteInterceptor({
  name: 'mirror-onto-a-required-field-model',
  write: ({ write, writer }) => {
    if (write.kind !== 'create') return;

    // Touching ONE field on a member that must already exist: `update`.
    writer.update(memberRepo, write.data.userId, { lastOrderStatus: write.data.status });

    // Creating or replacing a member outright needs the whole document, merge or not.
    writer.set(memberRepo, write.data.userId, {
      displayName: 'Ada',
      email: 'ada@example.com',
      lastOrderStatus: write.data.status,
    });
    writer.set(
      memberRepo,
      write.data.userId,
      { displayName: 'Ada', email: 'ada@example.com' },
      { merge: true },
    );

    // Hoisted so each refusal below is a single line: a multi-line call reports the error on the
    // argument's line, which a `@ts-expect-error` above the call does not cover.
    const partial = { lastOrderStatus: write.data.status };
    const merge = { merge: true } as const;
    // @ts-expect-error `set` creates when absent, so a partial payload is refused even under merge
    writer.set(memberRepo, write.data.userId, partial, merge);
    // @ts-expect-error ...and refused without merge, for the same reason
    writer.set(memberRepo, write.data.userId, partial);
    // @ts-expect-error a partial update is still checked against the target's model
    writer.update(memberRepo, write.data.userId, { notAField: 1 });
  },
});

/* ---------------------------------------------------------------------------------------------- *
 * The calls the guide shows AFTER registering — every one of these must be a legal write.
 * ---------------------------------------------------------------------------------------------- */

async function documentedCalls(): Promise<void> {
  await orderRepo.update('order-1', { status: 'shipped' });
  await orderRepo.upsert('order-2', { userId: 'user-1', status: 'pending' });
  await orderRepo.bulkUpdate([{ id: 'order-3', data: { status: 'shipped' } }]);
  await orderRepo.query().where('status', '==', 'pending').update({ status: 'shipped' });
}
void documentedCalls;
