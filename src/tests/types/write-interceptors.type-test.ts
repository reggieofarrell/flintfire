/**
 * Type-level contract for repository write interceptors (issue #108 / ADR-0040), checked by
 * `npm run test:types` via tsc — NOT jest (`isolatedModules` skips type-checking). Never executed.
 *
 * The contract this pins (plan §8.2):
 *  - TT-1: `StagingTarget` accepts BOTH a `WriteBatch` and a `Transaction`, and the tempting
 *    `Pick<WriteBatch, …>` spelling does NOT accept a `Transaction`. This is the one assertion that
 *    catches the whole trap: the `Pick` version type-checks perfectly while only batch mode is
 *    wired, then fails late — and the tempting fix (`tx as unknown as WriteBatch`) discards the
 *    compiler's only proof that both boundaries accept the same calls.
 *  - TT-2: `InterceptedWrite` narrows on `kind` — `'delete'` carries the whole stored document,
 *    `'create'` the validated create OUTPUT, `'update'` the update input.
 *  - TT-3: `R` flows from a read-capable interceptor's `read` into its `write` context's `reads`
 *    with exact inference, and a write-only interceptor's `write` context has NO `reads`.
 *  - TT-4: an interceptor's sibling payload is type-checked against the TARGET repository's write
 *    model, not the intercepted repository's.
 *  - TT-5: `StagingTarget` and `WriteGroup` are NOT re-exported from the package root (that is what
 *    keeps them off the public API — they are deliberately not `@internal`, because `stripInternal`
 *    would erase them from the emitted `.d.ts` while `WriteGroup` still references `StagingTarget`).
 *
 * Guards use the ADR-0041 asserted-guard pattern: a bare `type X = …` alias emits no diagnostic, so
 * every equality is forced through `AssertTrue<ExpectEqual<…>>`. Each `@ts-expect-error` FAILS the
 * type-check if the line below it stops being an error, and every un-annotated line must compile.
 */
import { Firestore, Transaction, WriteBatch } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository } from '../../index.js';
import type { StagingTarget } from '../../core/FirestoreRepository.js';
import type {
  CreateOutput,
  FirestoreDocument,
  ID,
  InterceptedWrite,
  InterceptedWriteKind,
  InterceptorReader,
  InterceptorWriter,
  ReadCapableInterceptor,
  UpdateInput,
  WriteInterceptor,
  WriteOnlyInterceptor,
} from '../../index.js';

type ExpectEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertTrue<T extends true> = T;

declare const db: Firestore;
declare const batch: WriteBatch;
declare const tx: Transaction;

/* ---------------------------------------------------------------------------------------------- *
 * TT-1 — the shared staging surface accepts both SDK boundaries; a `Pick` spelling does not.
 * ---------------------------------------------------------------------------------------------- */

// Both assignments MUST compile. If `StagingTarget`'s members stop returning `unknown`, the
// `Transaction` assignment below breaks — which is the whole point of this pair.
const stagedBatch: StagingTarget = batch;
const stagedTx: StagingTarget = tx;
void stagedBatch;
void stagedTx;

/**
 * The natural-but-wrong spelling. `WriteBatch` and `Transaction` declare byte-identical PARAMETER
 * lists for these members but different RETURN types, so a `Pick` off `WriteBatch` rejects a
 * `Transaction`. The directive below is live: "fix" `StagingTarget` back to a `Pick` and this file
 * reports an unused `@ts-expect-error` instead.
 */
type PickedWriter = Pick<WriteBatch, 'create' | 'set' | 'update' | 'delete'>;
const pickedBatch: PickedWriter = batch;
void pickedBatch;
// @ts-expect-error a Pick<WriteBatch, …> does NOT accept a Transaction (their return types differ)
const pickedTx: PickedWriter = tx;
void pickedTx;

/* ---------------------------------------------------------------------------------------------- *
 * Repositories used by the remaining assertions.
 * ---------------------------------------------------------------------------------------------- */

const orderSchema = z.object({
  userId: z.string(),
  status: z.enum(['pending', 'shipped']),
  // A defaulted field makes the create OUTPUT differ from the create INPUT, so TT-2's `'create'`
  // assertion is checked against the parsed output rather than the caller's payload.
  revision: z.number().default(0),
});
const auditSchema = z.object({
  orderId: z.string(),
  revision: z.number(),
});

const orderRepo = FirestoreRepository.withSchema(db, 'orders', orderSchema);
const auditRepo = FirestoreRepository.withSchema(db, 'audit', auditSchema);

type OrderRead = z.output<typeof orderSchema>;
type OrderWrite = z.input<typeof orderSchema>;
type OrderWriteOutput = z.output<typeof orderSchema>;
type OrderIntercepted = InterceptedWrite<OrderRead, OrderWrite, OrderWriteOutput>;

/* ---------------------------------------------------------------------------------------------- *
 * TT-2 — `InterceptedWrite` narrows on `kind`.
 * ---------------------------------------------------------------------------------------------- */

type KindUnion = AssertTrue<ExpectEqual<InterceptedWriteKind, 'create' | 'update' | 'delete'>>;
type KindsMatchTheUnion = AssertTrue<ExpectEqual<OrderIntercepted['kind'], InterceptedWriteKind>>;

type DeleteBranch = Extract<OrderIntercepted, { kind: 'delete' }>;
type CreateBranch = Extract<OrderIntercepted, { kind: 'create' }>;
type UpdateBranch = Extract<OrderIntercepted, { kind: 'update' }>;

// A delete carries the whole stored document, not merely an id — sound because every delete path in
// the repository pre-reads its document before staging the delete.
type DeleteCarriesDocument = AssertTrue<
  ExpectEqual<DeleteBranch['document'], FirestoreDocument<OrderRead>>
>;
type DeleteHasNoData = AssertTrue<ExpectEqual<keyof DeleteBranch, 'kind' | 'id' | 'document'>>;
type CreateCarriesOutput = AssertTrue<
  ExpectEqual<CreateBranch['data'], CreateOutput<OrderWriteOutput>>
>;
type UpdateCarriesInput = AssertTrue<ExpectEqual<UpdateBranch['data'], UpdateInput<OrderWrite>>>;
type EveryBranchCarriesAnId = AssertTrue<ExpectEqual<OrderIntercepted['id'], ID>>;

void 0 as unknown as [
  KindUnion,
  KindsMatchTheUnion,
  DeleteCarriesDocument,
  DeleteHasNoData,
  CreateCarriesOutput,
  UpdateCarriesInput,
  EveryBranchCarriesAnId,
];

// Narrowing works at a value position too: only the delete branch exposes `document`.
declare const someWrite: OrderIntercepted;
if (someWrite.kind === 'delete') {
  const doc: FirestoreDocument<OrderRead> = someWrite.document;
  void doc;
} else {
  // @ts-expect-error `document` exists only on the delete branch
  void someWrite.document;
}

/* ---------------------------------------------------------------------------------------------- *
 * TT-3 — `R` flows from `read` to `write`, and a write-only interceptor has no `reads`.
 * ---------------------------------------------------------------------------------------------- */

orderRepo.registerWriteInterceptor({
  name: 'read-flows-into-write',
  read: async ({ write, reader }) => {
    // The read context sees the same discriminated write, and the reader is the restricted surface.
    const readerIsRestricted: InterceptorReader = reader;
    void readerIsRestricted;
    const existing = await reader.get(auditRepo, write.id);
    return { count: existing?.revision ?? 0 };
  },
  write: ({ reads, writer, write }) => {
    // `reads` is inferred EXACTLY from `read`'s return type — not `unknown`, not `any`.
    type ReadsIsInferred = AssertTrue<ExpectEqual<typeof reads, { count: number }>>;
    void 0 as unknown as ReadsIsInferred;
    const writerIsRestricted: InterceptorWriter = writer;
    void writerIsRestricted;
    writer.set(auditRepo, write.id, { orderId: write.id, revision: reads.count + 1 });
  },
});

orderRepo.registerWriteInterceptor({
  name: 'write-only-has-no-reads',
  write: ctx => {
    // A write-only interceptor's context carries no `reads` key at all.
    type WriteOnlyContextKeys = AssertTrue<ExpectEqual<keyof typeof ctx, 'write' | 'writer'>>;
    void 0 as unknown as WriteOnlyContextKeys;
    // @ts-expect-error a write-only interceptor's write context has no `reads`
    void ctx.reads;
    ctx.writer.set(auditRepo, ctx.write.id, { orderId: ctx.write.id, revision: 1 });
  },
});

// `read?: undefined` (rather than an absent key) is what makes the overload pair discriminate.
type WriteOnlyReadIsUndefined = AssertTrue<
  ExpectEqual<WriteOnlyInterceptor<OrderRead, OrderWrite, OrderWriteOutput>['read'], undefined>
>;
// The stored union covers both flavours.
type UnionCoversBoth = AssertTrue<
  ExpectEqual<
    WriteInterceptor<OrderRead, OrderWrite, OrderWriteOutput>,
    | WriteOnlyInterceptor<OrderRead, OrderWrite, OrderWriteOutput>
    | ReadCapableInterceptor<OrderRead, OrderWrite, OrderWriteOutput, any>
  >
>;
void 0 as unknown as [WriteOnlyReadIsUndefined, UnionCoversBoth];

/* ---------------------------------------------------------------------------------------------- *
 * TT-4 — a sibling payload is checked against the TARGET repository's write model.
 * ---------------------------------------------------------------------------------------------- */

orderRepo.registerWriteInterceptor({
  name: 'sibling-payload-is-target-typed',
  write: ({ write, writer }) => {
    // Valid against `auditSchema` — the TARGET repo's model, not the order model.
    writer.createWithId(auditRepo, write.id, { orderId: write.id, revision: 1 });
    // @ts-expect-error `status` is not a field on the audit write model
    writer.createWithId(auditRepo, write.id, { orderId: write.id, revision: 1, status: 'pending' });
    // @ts-expect-error `revision` is a number on the audit write model
    writer.set(auditRepo, write.id, { orderId: write.id, revision: 'one' });
    // A delete needs no payload, so only the target repository is checked.
    writer.delete(auditRepo, write.id);
    writer.update(auditRepo, write.id, { revision: 2 });
  },
});

/* ---------------------------------------------------------------------------------------------- *
 * TT-6 — the writer's vocabulary matches the repository's.
 *
 * Every member but `set` is named after the repository method it stages. `set` is the deliberate
 * exception: it has no repository counterpart (the repository exposes no wholesale-replace write),
 * and it must NOT be renamed to `upsert` — `upsert` replaces a nested map on an existing document
 * where a merge-set deep-merges it, so the name would claim an equivalence that does not hold.
 *
 * This guard fails if a member is added, removed or renamed without that decision being revisited.
 * ---------------------------------------------------------------------------------------------- */

type WriterMembers = keyof InterceptorWriter;
type RepositoryMethods = keyof FirestoreRepository<{ a: string }>;

type WriterMembersAreExact = AssertTrue<
  ExpectEqual<WriterMembers, 'createWithId' | 'set' | 'update' | 'patch' | 'delete'>
>;
// Every member except `set` is a real repository method name, with the same meaning.
type MirrorsRepositoryVerbs = AssertTrue<
  ExpectEqual<Exclude<WriterMembers, 'set'> extends RepositoryMethods ? true : false, true>
>;
// ...and `set` is deliberately NOT one of them.
type SetIsNotARepositoryMethod = AssertTrue<
  ExpectEqual<'set' extends RepositoryMethods ? true : false, false>
>;
void 0 as unknown as [WriterMembersAreExact, MirrorsRepositoryVerbs, SetIsNotARepositoryMethod];

/* ---------------------------------------------------------------------------------------------- *
 * TT-5 — `StagingTarget` / `WriteGroup` are not part of the public API.
 * ---------------------------------------------------------------------------------------------- */

// The seven public interceptor types ARE importable from the package root (asserted by the import
// block at the top of this file, which would fail to resolve otherwise).
type PublicTypesResolve = AssertTrue<
  ExpectEqual<
    [
      InterceptedWriteKind,
      InterceptedWrite<OrderRead, OrderWrite, OrderWriteOutput>['kind'],
      keyof InterceptorReader,
      keyof InterceptorWriter,
    ],
    ['create' | 'update' | 'delete', 'create' | 'update' | 'delete', 'get', keyof InterceptorWriter]
  >
>;
void 0 as unknown as PublicTypesResolve;

// ...while the two staging types are NOT. Both directives are live: re-export either one from
// `src/index.ts` and this file reports an unused `@ts-expect-error`.
// @ts-expect-error StagingTarget is deliberately not re-exported from the package root
import type { StagingTarget as PublicStagingTarget } from '../../index.js';
// @ts-expect-error WriteGroup is deliberately not re-exported from the package root
import type { WriteGroup as PublicWriteGroup } from '../../index.js';
void 0 as unknown as [PublicStagingTarget, PublicWriteGroup];
