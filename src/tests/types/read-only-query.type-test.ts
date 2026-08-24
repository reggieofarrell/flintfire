/**
 * Type-level tests for the exported `ReadOnlyQuery` view (issue #100 / ADR-0041), checked by
 * `npm run test:types` via tsc (NOT jest). This file is never executed.
 *
 * Strategy: pin the structural contract that `repository.query()` is assignable to
 * `ReadOnlyQuery<…>` with no cast, that every clause member returns a write-free builder, and that
 * overloads / generics on terminal reads survive inheritance through `Omit` (they are *not*
 * re-derived with `Parameters`/`ReturnType`, which collapses them).
 *
 * Verification points (plan §8.1):
 *  - T-1 / T-2: two-sided asserted key-set drift guards (`Missing` and `Extra` must be `never`)
 *  - T-3: per-clause `NoWrites` matrix — key-set guards are blind to a wrong return type (M2)
 *  - T-4: `@ts-expect-error` on `.update()` / `.delete()` at five chain depths
 *  - T-5 / T-6 / T-7: `get({ withMetadata: true })`, `aggregate` Spec generic, `distinctValues` K
 *  - T-8: both `whereId` overloads compile
 *  - T-9: no-cast facade assignability (schema repo + W ≠ T phantom)
 *  - T-10: `select()` re-parameterizes on `ReadOnlyQuery` and keeps `DeepPartial` narrowing
 *  - T-11 / T-12: root and `/vector` barrel re-exports are nameable
 *
 * Each `@ts-expect-error` FAILS the type-check if the line below it stops being an error; every
 * un-annotated call must type-check. Prefer `ExpectEqual` over bare assignability so a widened
 * return type does not silently pass.
 */
import { z } from 'zod';
import { FirestoreQueryBuilder, FirestoreRepository } from '../../index.js';
import type {
  DataOf,
  DeepPartial,
  FirestoreDocument,
  ReadOnlyQuery,
  WithMetadata,
} from '../../index.js';
// T-12 — compile-time proof that `/vector` re-exports the same type (E5). A separate import so a
// missing vector barrel export fails here without being masked by the root import above.
import type { ReadOnlyQuery as ReadOnlyQueryFromVector } from '../../vector/index.js';

/** Structural equality: fails when A is wider or narrower than B. */
type ExpectEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertTrue<T extends true> = T;
/**
 * True iff `X` exposes neither `update` nor `delete`. Used per clause member because the key-set
 * guards (T-1/T-2) stay `never` when a clause accidentally returns the full builder (trap T3 / M2).
 */
type NoWrites<X> = 'update' extends keyof X ? false : 'delete' extends keyof X ? false : true;

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

// ---------------------------------------------------------------------------
// T-11 / T-12 — root and /vector barrels export ReadOnlyQuery (compile-time only)
// ---------------------------------------------------------------------------

/** Proves E4: the root package entry exports `ReadOnlyQuery`. */
export type _RootReadOnlyQuery = ReadOnlyQuery<Order>;
/** Proves E5: the `/vector` barrel exports the same type. */
export type _VectorReadOnlyQuery = ReadOnlyQueryFromVector<Order>;

// ---------------------------------------------------------------------------
// T-1 / T-2 — two-sided asserted drift guards (bare aliases alone emit nothing — M1 / T2)
// ---------------------------------------------------------------------------

type Missing = Exclude<keyof QB, keyof RO | 'update' | 'delete'>;
type Extra = Exclude<keyof RO, keyof QB>;
type _t1 = AssertTrue<ExpectEqual<Missing, never>>;
type _t2 = AssertTrue<ExpectEqual<Extra, never>>;

// ---------------------------------------------------------------------------
// T-9 — no-cast assignability from a real schema repo, plus W ≠ T phantom (D2 / T6)
// ---------------------------------------------------------------------------

class OrderService {
  constructor(private readonly orders: typeof orderRepo) {}
  query(): ReadOnlyQuery<Order> {
    // Structural — no cast. Fails with TS2322 if the contract breaks.
    return this.orders.query();
  }
}
const svc = new OrderService(orderRepo);

type Read = { n: number; s: string };
type Write = { n: number | FirebaseFirestore.FieldValue; s: string };
declare const rawRepo: FirestoreRepository<Read, Write, Read>;
function facadeExplicitW(): ReadOnlyQuery<Read, Write, Read> {
  return rawRepo.query();
}
function facadeDefaultedW(): ReadOnlyQuery<Read> {
  // W is a phantom: defaulting it must still accept a repo whose write model differs from T.
  return rawRepo.query();
}

// ---------------------------------------------------------------------------
// T-3 — every clause member's return type is write-free (13 sites; key guards are blind — M2)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// T-5 / T-6 / T-7 / T-8 / T-10 — overloads, generics, whereId, select narrowing
// ---------------------------------------------------------------------------

export async function getOverloadsSurviveOmit() {
  const withMeta = ro.get({ withMetadata: true });
  type _t5a = AssertTrue<
    ExpectEqual<typeof withMeta, Promise<WithMetadata<FirestoreDocument<Order>>[]>>
  >;
  const plain = ro.get();
  type _t5b = AssertTrue<ExpectEqual<typeof plain, Promise<FirestoreDocument<Order>[]>>>;
  return [withMeta, plain] as const;
}

/**
 * T-5 siblings (plan §8.3): the same `{ withMetadata: true }` overload collapse that T-5 pins on
 * `get` also applies to these five terminals. Key-set guards stay green if any is restated with
 * `Parameters`/`ReturnType` — only a per-site equality assert catches the silent loss of
 * `WithMetadata`.
 */
export async function metadataOverloadsSurviveOmitOnSiblingTerminals() {
  const one = await ro.getOne({ withMetadata: true });
  type _getOne = AssertTrue<ExpectEqual<typeof one, WithMetadata<FirestoreDocument<Order>> | null>>;

  const gen = ro.stream({ withMetadata: true });
  type _stream = AssertTrue<
    ExpectEqual<typeof gen, AsyncGenerator<WithMetadata<FirestoreDocument<Order>>>>
  >;

  const page = await ro.paginate(10, null, { withMetadata: true });
  type _paginate = AssertTrue<
    ExpectEqual<
      typeof page,
      {
        items: WithMetadata<FirestoreDocument<Order>>[];
        nextCursor: string | null;
        hasMore: boolean;
      }
    >
  >;

  const offsetPage = await ro.offsetPaginate(1, 10, { withMetadata: true });
  type _offset = AssertTrue<
    ExpectEqual<
      typeof offsetPage,
      {
        items: WithMetadata<FirestoreDocument<Order>>[];
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
      }
    >
  >;

  const counted = await ro.paginateWithCount(10, null, { withMetadata: true });
  type _counted = AssertTrue<
    ExpectEqual<
      typeof counted,
      {
        items: WithMetadata<FirestoreDocument<Order>>[];
        nextCursor: string | null;
        hasMore: boolean;
        total: number;
      }
    >
  >;

  return [one, gen, page, offsetPage, counted] as const;
}

export async function aggregateSpecGenericSurvivesOmit() {
  const agg = ro.aggregate({ n: { kind: 'count' }, s: { kind: 'sum', field: 'score' } });
  type _t6 = AssertTrue<ExpectEqual<Awaited<typeof agg>, { n: number; s: number }>>;
  return agg;
}

export async function distinctValuesFieldGenericSurvivesOmit() {
  const values = ro.distinctValues('status');
  type _t7 = AssertTrue<ExpectEqual<Awaited<typeof values>, ('pending' | 'shipped')[]>>;
  return values;
}

export function whereIdBothOverloadsCompile() {
  // T-8: comparison overload and `in` / `not-in` overload must both be present.
  const cmp = ro.whereId('==', 'x');
  const inn = ro.whereId('in', ['a', 'b']);
  return [cmp, inn] as const;
}

export async function selectReparameterizesOnReadOnlyQuery() {
  const rows = await ro.select('status').get();
  type _t10 = AssertTrue<
    ExpectEqual<typeof rows, (Omit<DeepPartial<Order>, 'id'> & { readonly id: string })[]>
  >;
  return rows;
}

export async function facadeChainKeepsDeepPartialNarrowing() {
  // Cross-check that a multi-clause chain through the facade still narrows after `select`.
  return svc
    .query()
    .where('status', '==', 'pending')
    .select('status')
    .orderBy('score')
    .limit(2)
    .get();
}

// ---------------------------------------------------------------------------
// T-4 — writes unreachable at five chain depths (unused @ts-expect-error ⇒ TS2578)
// ---------------------------------------------------------------------------

export async function writesAreUnreachableAtEveryChainDepth() {
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
  // @ts-expect-error  and through the facade, which is the shape the docs recommend
  await svc.query().where('status', '==', 'pending').delete();
}

export { OrderService, facadeExplicitW, facadeDefaultedW };
