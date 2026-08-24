/**
 * PROBE 02 — proves §3.2 (N1–N5): what `Parameters<>` / `ReturnType<>` do to overloads and generics.
 *
 * This is the probe that overturns ADR-0041 decision 3 as literally written. The ADR says to derive
 * every member's parameters from the real builder so drift is impossible. That is right for the 13
 * chainable clause members and WRONG for the read terminals, because `Parameters` / `ReturnType`
 * resolve an overloaded member to its LAST signature and instantiate type parameters away.
 *
 * The failure is silent: the derived declaration compiles. What breaks is consumer code that does
 * not exist yet — `get({ withMetadata: true })` losing its overload, `aggregate` losing its per-alias
 * result types, `distinctValues` losing its literal union.
 *
 * Run: node docs/plans/issue-100-read-only-query-builder-type/probes/harness.cjs \
 *        docs/plans/issue-100-read-only-query-builder-type/probes/02-parameters-collapse.ts
 *
 * Expected (0 diagnostics; these are all well-typed questions, not errors):
 *   N1  P_whereId      := [op: "in" | "not-in", value: readonly string[]]
 *                         → the comparison overload is GONE; whereId('==', id) would be rejected
 *   N2a P_get          := [options?: { withMetadata?: false | undefined } | undefined]
 *   N2b P_getRet       := Promise<(Omit<O, "id"> & { readonly id: string })[]>
 *                         → the { withMetadata: true } overload and WithMetadata<R>[] are GONE
 *   N3a P_aggregateRet := Promise<AggregationResult<AggregationSpec<O>>>
 *                         → Spec erased; every alias widens to number | null
 *   N3b P_distinct     := [field: keyof O]              → K erased
 *   N4  P_startAt      := unknown[]
 *                         → the LAST overload is the permissive rest, which also accepts the
 *                           DocumentSnapshot form, so deriving the four bound members IS lossless
 *   N5  P_selectRet    := FirestoreQueryBuilder<O, O, O, …DeepPartial…>
 *                         → not `this`, so select() must be re-declared, not inherited
 *
 * The single-signature members at the bottom are recorded so the "deriving is safe here" claim in
 * §6 is evidence rather than assertion.
 */
import type { FirestoreQueryBuilder } from './core/QueryBuilder.js';

type O = { a: string; n: number };
type QB = FirestoreQueryBuilder<O, O, O>;

// ── N1: an overloaded CLAUSE member. Collapse is lossy AND restrictive. ────────────────────────
type P_whereId = Parameters<QB['whereId']>;

// ── N2: overloaded TERMINALS. Collapse silently drops the withMetadata contract. ──────────────
type P_get = Parameters<QB['get']>;
type P_getRet = ReturnType<QB['get']>;
type P_getOne = Parameters<QB['getOne']>;
type P_stream = Parameters<QB['stream']>;
type P_paginate = Parameters<QB['paginate']>;
type P_offsetPaginate = Parameters<QB['offsetPaginate']>;
type P_paginateWithCount = Parameters<QB['paginateWithCount']>;

// ── N3: GENERIC terminals. The type parameter is instantiated away entirely. ───────────────────
type P_aggregate = Parameters<QB['aggregate']>;
type P_aggregateRet = ReturnType<QB['aggregate']>;
type P_distinct = Parameters<QB['distinctValues']>;
type P_distinctRet = ReturnType<QB['distinctValues']>;

// ── N4: overloaded bound members whose LAST overload is permissive — collapse is lossless. ────
type P_startAt = Parameters<QB['startAt']>;
type P_startAfter = Parameters<QB['startAfter']>;
type P_endAt = Parameters<QB['endAt']>;
type P_endBefore = Parameters<QB['endBefore']>;

// ── N5: select() re-parameterizes rather than returning `this`. ────────────────────────────────
type P_select = Parameters<QB['select']>;
type P_selectRet = ReturnType<QB['select']>;

// ── Single-signature clause members: deriving these is exact. Recorded, not assumed. ──────────
type P_where = Parameters<QB['where']>;
type P_orderBy = Parameters<QB['orderBy']>;
type P_orderById = Parameters<QB['orderById']>;
type P_whereFilter = Parameters<QB['whereFilter']>;
type P_limit = Parameters<QB['limit']>;
type P_limitToLast = Parameters<QB['limitToLast']>;
type P_offset = Parameters<QB['offset']>;

export type {
  P_whereId,
  P_get,
  P_getRet,
  P_getOne,
  P_stream,
  P_paginate,
  P_offsetPaginate,
  P_paginateWithCount,
  P_aggregate,
  P_aggregateRet,
  P_distinct,
  P_distinctRet,
  P_startAt,
  P_startAfter,
  P_endAt,
  P_endBefore,
  P_select,
  P_selectRet,
  P_where,
  P_orderBy,
  P_orderById,
  P_whereFilter,
  P_limit,
  P_limitToLast,
  P_offset,
};
