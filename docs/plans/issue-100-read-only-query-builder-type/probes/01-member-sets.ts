/**
 * PROBE 01 — proves §3.1 (P1–P4): the public member set of each query builder.
 *
 * The question: which members must `ReadOnlyQuery` cover, and does either the collection-group
 * builder or the vector builder need the same treatment?
 *
 * `keyof` is the right operator, not `getPropertiesOfType`: a structural read-only view sees only
 * public members, and `keyof` on a class instance type yields exactly those. The `M_` aliases below
 * are included as a deliberate contrast — they list protected/private members too, which is why
 * reasoning from them would badly overstate the surface (60 vs 33 on the concrete builder).
 *
 * Run: node docs/plans/issue-100-read-only-query-builder-type/probes/harness.cjs \
 *        docs/plans/issue-100-read-only-query-builder-type/probes/01-member-sets.ts
 *
 * Expected (verified at 05c02cf === b999f40 for src/):
 *   P_QBKeys  — 33 members, including BOTH `update` and `delete`
 *   P_CGKeys  — 31 members, containing NEITHER (adds groupCount/wherePath/orderByPath)
 *   P_VQBKeys — 10 members, containing NEITHER
 *   M_QB      — 60 props: the public/protected gap that makes `keyof` the right question
 */
import type { FirestoreQueryBuilder } from './core/QueryBuilder.js';
import type { FirestoreCollectionGroupQueryBuilder } from './core/CollectionGroup.js';
import type { VectorQueryBuilder } from './vector/VectorQueryBuilder.js';

type O = { a: string; n: number; nested: { deep: string } };

// The single-collection builder — the only one with write terminals, so the only one that leaks.
type P_QBKeys = keyof FirestoreQueryBuilder<O, O, O>;

// The collection-group builder. ADR-0041 left it as "scope left open"; this closes it.
type P_CGKeys = keyof FirestoreCollectionGroupQueryBuilder<O, O>;

// The vector builder, reached via `withVectorSearch(repo).vectorQuery()`.
type P_VQBKeys = keyof VectorQueryBuilder<O, O>;

// Contrast only: includes protected + private. Do NOT read the required member set from this.
type M_QB = FirestoreQueryBuilder<O, O, O>;
type M_CG = FirestoreCollectionGroupQueryBuilder<O, O>;

export type { P_QBKeys, P_CGKeys, P_VQBKeys, M_QB, M_CG };
