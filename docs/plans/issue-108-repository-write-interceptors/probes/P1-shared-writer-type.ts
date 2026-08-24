/**
 * P1 — Does ONE structural type accept BOTH `WriteBatch` and `Transaction` as a staging target?
 *
 * ADR-0040 Decision 3 claims `WriteBatch` and `Transaction` "declare identical create/update/delete
 * signatures", so one writer interface backs both modes. The PARAMETER lists are identical, but the
 * RETURN types are not (`WriteBatch` vs `Transaction`). This probe compiles the candidate shared type
 * against both concrete SDK classes and against the narrower `Pick<WriteBatch, …>` spelling that the
 * ADR's wording invites, to establish which one actually holds.
 *
 * Run: npx tsc --noEmit --strict --exactOptionalPropertyTypes \
 *        --moduleResolution bundler --module esnext --target es2022 \
 *        docs/plans/issue-108-repository-write-interceptors/probes/P1-shared-writer-type.ts
 */
import type {
  DocumentReference,
  Precondition,
  Transaction,
  WriteBatch,
} from 'firebase-admin/firestore';

/** Candidate A — void-returning structural type (the shape the plan prescribes). */
type StagingWriterA = {
  create(ref: DocumentReference<any, any>, data: any): unknown;
  update(ref: DocumentReference<any, any>, data: any, precondition?: Precondition): unknown;
  delete(ref: DocumentReference<any, any>, precondition?: Precondition): unknown;
};

/** Candidate B — the `Pick<WriteBatch, …>` spelling the ADR wording invites. */
type StagingWriterB = Pick<WriteBatch, 'create' | 'update' | 'delete'>;

declare const batch: WriteBatch;
declare const tx: Transaction;

// --- Candidate A: expect BOTH to be assignable ---
const a1: StagingWriterA = batch;
const a2: StagingWriterA = tx;

// --- Candidate B: expect `batch` OK, `tx` to FAIL (return-type mismatch) ---
const b1: StagingWriterB = batch;
// @ts-expect-error Transaction is NOT assignable to Pick<WriteBatch, …> — return types differ.
const b2: StagingWriterB = tx;

// --- Call through Candidate A with the exact three ops the interceptor writer exposes ---
declare const ref: DocumentReference<any, any>;
declare const precondition: Precondition;
function stage(w: StagingWriterA): void {
  w.create(ref, { a: 1 });
  w.update(ref, { a: 1 });
  w.update(ref, { a: 1 }, precondition);
  w.delete(ref);
  w.delete(ref, precondition);
}

export { a1, a2, b1, b2, stage };
