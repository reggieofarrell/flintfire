/**
 * PROBE 03 — proves §3.3 (V1–V6, V9): the prescribed §6.1 block, verbatim, with every §8.1 assertion.
 *
 * The DECLARATIONS between the BEGIN/END markers below are identical to PLAN.md §6.1 — same clause-key
 * union, same interface header, same 14 member signatures, same formatting. Two deliberate
 * differences, neither of which can affect type resolution: the probe drops the `export` keyword
 * (nothing imports this file) and the JSDoc/`@template` blocks (comments). Keep the declarations in
 * sync: this file is the evidence that §6 compiles as written, so editing one without the other
 * destroys the guarantee.
 *
 * To re-confirm they still match, diff the two with comments stripped — e.g. extract from
 * `type ReadOnlyQueryClauseKeys =` to the closing brace in each and compare after removing `/** … *\/`
 * blocks and the `export ` prefix. Anything beyond those two differences is drift.
 *
 * Run: node docs/plans/issue-100-read-only-query-builder-type/probes/harness.cjs \
 *        docs/plans/issue-100-read-only-query-builder-type/probes/03-readonly-query.ts
 *
 * EXPECTED: **0 diagnostics.** That is the whole result. Because this file contains
 * `@ts-expect-error` directives, a clean run means every one of them was satisfied — i.e. `update` /
 * `delete` really are unreachable at every chain depth. A TS2578 ("unused '@ts-expect-error'") is
 * the signal that the read-only guarantee broke.
 *
 * Plus the RESOLVED block:
 *   V1   P_Missing   := never        nothing on the builder is missing from ReadOnlyQuery
 *   V1'  P_Extra     := never        nothing on ReadOnlyQuery is absent from the builder
 *   V1'' P_Keys      := the 31 public members (33 minus update/delete)
 *   V2   P_Assignable := "YES"       FirestoreQueryBuilder is assignable with NO cast
 *   V5a  p_getMeta   := Promise<WithMetadata<…>[]>            overload survived Omit
 *   V5b  p_agg       := Promise<AggregationResult<{ n: {kind:"count"}; s: {kind:"sum"; field:"score"} }>>
 *                                                            generic survived Omit
 *   V5c  p_dv        := Promise<("pending" | "shipped")[]>    generic survived Omit
 *   V5e  p_facadeChain := Promise<(Omit<{…?: …}, "id"> & { readonly id: string })[]>
 *                                                            DeepPartial narrowing survived a chain
 */
import type { FirestoreDocument } from './core/DocumentId.js';
import type { DeepPartial } from './utils/pathTypes.js';
import { FirestoreQueryBuilder } from './core/QueryBuilder.js';
import { FirestoreRepository, type DataOf } from './core/FirestoreRepository.js';
import { z } from 'zod';

// ══════════════ BEGIN §6.1 — verbatim ══════════════

type ReadOnlyQueryClauseKeys =
  | 'where'
  | 'whereFilter'
  | 'whereId'
  | 'orderBy'
  | 'orderById'
  | 'limit'
  | 'limitToLast'
  | 'offset'
  | 'startAt'
  | 'startAfter'
  | 'endAt'
  | 'endBefore'
  | 'select';

interface ReadOnlyQuery<
  T extends object,
  W extends object = T,
  S extends object = T,
  R = FirestoreDocument<T>,
> extends Omit<FirestoreQueryBuilder<T, W, S, R>, 'update' | 'delete' | ReadOnlyQueryClauseKeys> {
  where(...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['where']>): ReadOnlyQuery<T, W, S, R>;
  whereFilter(
    ...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['whereFilter']>
  ): ReadOnlyQuery<T, W, S, R>;
  whereId(op: '<' | '<=' | '==' | '!=' | '>=' | '>', value: string): ReadOnlyQuery<T, W, S, R>;
  whereId(op: 'in' | 'not-in', value: readonly string[]): ReadOnlyQuery<T, W, S, R>;
  orderBy(...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['orderBy']>): ReadOnlyQuery<T, W, S, R>;
  orderById(
    ...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['orderById']>
  ): ReadOnlyQuery<T, W, S, R>;
  limit(...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['limit']>): ReadOnlyQuery<T, W, S, R>;
  limitToLast(
    ...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['limitToLast']>
  ): ReadOnlyQuery<T, W, S, R>;
  offset(...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['offset']>): ReadOnlyQuery<T, W, S, R>;
  startAt(...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['startAt']>): ReadOnlyQuery<T, W, S, R>;
  startAfter(
    ...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['startAfter']>
  ): ReadOnlyQuery<T, W, S, R>;
  endAt(...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['endAt']>): ReadOnlyQuery<T, W, S, R>;
  endBefore(
    ...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['endBefore']>
  ): ReadOnlyQuery<T, W, S, R>;
  select(
    ...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['select']>
  ): ReadOnlyQuery<T, W, S, FirestoreDocument<DeepPartial<T>>>;
}

// ══════════════ END §6.1 ══════════════

// A REAL schema repository, not a hand-written interface: V3 showed the schema path is where the
// interesting assignability question lives (T flows from z.output, R from FirestoreDocument<T>).
declare const db: FirebaseFirestore.Firestore;
const orderSchema = z.object({
  userId: z.string(),
  status: z.enum(['pending', 'shipped']),
  updatedAt: z.string(),
  score: z.number(),
});
const orderRepo = FirestoreRepository.withSchema(db, 'orders', orderSchema);
type Order = DataOf<typeof orderRepo>;

type QB = FirestoreQueryBuilder<Order, Order, Order>;
type RO = ReadOnlyQuery<Order>;

type ExpectEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertTrue<X extends true> = X;
type NoWrites<X> = 'update' extends keyof X ? false : 'delete' extends keyof X ? false : true;

// ── V1 / V1' / V1'' — the two-sided drift guard, ASSERTED. ────────────────────────────────────
// The bare aliases are printed for the record; the AssertTrue lines are what actually fail. Probe
// 04 shows the bare form alone emits nothing (that is the M1 finding behind trap T2).
type P_Missing = Exclude<keyof QB, keyof RO | 'update' | 'delete'>;
type P_Extra = Exclude<keyof RO, keyof QB>;
type P_Keys = keyof RO;
type _noMissing = AssertTrue<ExpectEqual<P_Missing, never>>;
type _noExtra = AssertTrue<ExpectEqual<P_Extra, never>>;

// ── V2 — structural assignability, no cast. ────────────────────────────────────────────────────
type P_Assignable = QB extends RO ? 'YES' : 'NO';

// ── V3 / T-9 — the facade, exactly as PLAN.md §9.3 prescribes it for the published guide. ──────
class OrderService {
  constructor(private readonly orders: typeof orderRepo) {}
  query(): ReadOnlyQuery<Order> {
    return this.orders.query(); // no cast
  }
}
declare const svc: OrderService;

// ── V4 — W !== T, and W defaulted. Both compile ⇒ W is a phantom (basis for decision D2). ──────
type Read = { n: number; s: string };
type Write = { n: number | FirebaseFirestore.FieldValue; s: string };
declare const rawRepo: FirestoreRepository<Read, Write, Read>;
function facadeExplicitW(): ReadOnlyQuery<Read, Write, Read> {
  return rawRepo.query();
}
function facadeDefaultedW(): ReadOnlyQuery<Read> {
  return rawRepo.query();
}

// ── V5 / T-3 — every clause member's return type is write-free. 13 sites, 13 rows. ────────────
// Key-set guards are blind to a wrong return type (probe 04, M2), so this matrix is not redundant.
type _c01 = AssertTrue<NoWrites<ReturnType<RO['where']>>>;
type _c02 = AssertTrue<NoWrites<ReturnType<RO['whereFilter']>>>;
type _c03 = AssertTrue<NoWrites<ReturnType<RO['whereId']>>>;
type _c04 = AssertTrue<NoWrites<ReturnType<RO['orderBy']>>>;
type _c05 = AssertTrue<NoWrites<ReturnType<RO['orderById']>>>;
type _c06 = AssertTrue<NoWrites<ReturnType<RO['limit']>>>;
type _c07 = AssertTrue<NoWrites<ReturnType<RO['limitToLast']>>>;
type _c08 = AssertTrue<NoWrites<ReturnType<RO['offset']>>>;
type _c09 = AssertTrue<NoWrites<ReturnType<RO['startAt']>>>;
type _c10 = AssertTrue<NoWrites<ReturnType<RO['startAfter']>>>;
type _c11 = AssertTrue<NoWrites<ReturnType<RO['endAt']>>>;
type _c12 = AssertTrue<NoWrites<ReturnType<RO['endBefore']>>>;
type _c13 = AssertTrue<NoWrites<ReturnType<RO['select']>>>;

declare const ro: RO;

// ── V5a–V5e — overloads and generics survived the Omit; the chain keeps narrowing. ─────────────
const p_getMeta = ro.get({ withMetadata: true });
const p_getPlain = ro.get();
const p_agg = ro.aggregate({ n: { kind: 'count' }, s: { kind: 'sum', field: 'score' } });
const p_dv = ro.distinctValues('status');
const p_whereIdCmp = ro.whereId('==', 'x'); // T-8: the comparison overload survived
const p_whereIdIn = ro.whereId('in', ['a', 'b']);
const p_startAtBound = ro.orderBy('score').startAt(1);
const p_collectionCount = ro.collectionCount();
const p_explain = ro.explain({ analyze: true });
const p_facadeChain = svc
  .query()
  .where('status', '==', 'pending')
  .select('status')
  .orderBy('score')
  .limit(2)
  .get();

// ── V6 / T-4 — writes are unreachable at five chain depths. Every directive MUST be needed. ────
async function writesAreUnreachable() {
  // @ts-expect-error  update is absent on the immediate object
  await ro.update({ status: 'shipped' });
  // @ts-expect-error  delete is absent on the immediate object
  await ro.delete();
  // @ts-expect-error  still absent after a clause call — the leak `Omit` would reopen here
  await ro.where('status', '==', 'pending').update({ status: 'shipped' });
  // @ts-expect-error  still absent after ordering
  await ro.orderBy('score').delete();
  // @ts-expect-error  still absent across a select() projection (a NEW builder on the concrete class)
  await ro.select('status').where('status', '==', 'pending').update({ status: 'shipped' });
  // @ts-expect-error  still absent through the document-name and bound clauses
  await ro.whereId('==', 'x').orderById().startAt(1).endBefore(2).limit(1).delete();
  // @ts-expect-error  and through the facade, which is the shape the docs actually recommend
  await svc.query().where('status', '==', 'pending').delete();
}

export type { P_Missing, P_Extra, P_Keys, P_Assignable, ReadOnlyQuery };
export {
  OrderService,
  facadeExplicitW,
  facadeDefaultedW,
  writesAreUnreachable,
  p_getMeta,
  p_getPlain,
  p_agg,
  p_dv,
  p_whereIdCmp,
  p_whereIdIn,
  p_startAtBound,
  p_collectionCount,
  p_explain,
  p_facadeChain,
};
