export {
  VectorDistanceMeasure,
  VECTOR_MAX_DIMENSIONS,
  VECTOR_MAX_LIMIT,
  assertVectorSearchSupported,
  isVectorFieldValue,
  validateFindNearestOptions,
} from './VectorSearch.js';
export type {
  FindNearestOptions,
  VectorDistanceMeasureValue,
  VectorSearchResult,
} from './VectorSearch.js';

export { vectorEmbeddingSchema } from './vectorEmbeddingSchema.js';
export { VectorQueryBuilder } from './VectorQueryBuilder.js';
export { withVectorSearch } from './withVectorSearch.js';
export type { VectorEnabledRepository } from './withVectorSearch.js';
// The value type of `vectorEmbeddingSchema` — re-exported so consumers can name it through the
// public `/vector` specifier (its source module `utils/pathTypes` has no export-map subpath) (T5).
export type { VectorValueLike } from '../utils/pathTypes.js';
// Re-exported so /vector consumers can name explain()'s return type and the read-only query view
// without importing the main entry (QueryBuilder has no export-map subpath) — same rationale as
// VectorValueLike above. `withVectorSearch` proxies `query()` unchanged, so a facade over a
// vector-enabled repository needs `ReadOnlyQuery` from this specifier (ADR-0041).
export type { QueryExplainResult, ReadOnlyQuery } from '../core/QueryBuilder.js';
// Re-exported so /vector consumers can name the opt-in snapshot-metadata shapes returned by the
// proxied core reads on a VectorEnabledRepository, without importing the main entry
// (core/SnapshotMetadata has no export-map subpath) — same rationale as VectorValueLike above.
export type {
  DocumentMetadata,
  WithMetadata,
  DetailedDocumentChange,
  DetailedQuerySnapshot,
} from '../core/SnapshotMetadata.js';
