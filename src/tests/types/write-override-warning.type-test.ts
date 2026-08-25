/**
 * Type-level drift guard for the write-override warning write ∪ non-write partition (issue #103 /
 * ADR-0043). Checked by `tsc` via `npm run test:types` — not jest (`isolatedModules` skips
 * type-checking).
 *
 * Guards (ADR-0041 asserted-guard pattern — bare `type Missing = …` aliases emit no diagnostic):
 *   - Every `keyof FirestoreRepository<…>` is classified as Write or NonWrite (`Missing` is `never`).
 *   - Every listed Write / NonWrite name exists on the class (`ExtraWrite` / `ExtraNonWrite` are
 *     `never`).
 *   - Keep in sync with `REPOSITORY_WRITE_METHODS` in `src/core/writeOverrideWarning.ts`.
 */
import { FirestoreRepository } from '../../index.js';

type User = { name: string };
type Repo = FirestoreRepository<User>;
type Keys = keyof Repo;

type ExpectEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertTrue<T extends true> = T;

type Write =
  | 'bulkCreate'
  | 'bulkCreateWithIds'
  | 'bulkDelete'
  | 'bulkPatch'
  | 'bulkUpdate'
  | 'bulkWrite'
  | 'create'
  | 'createInTransaction'
  | 'createWithId'
  | 'createWithIdInTransaction'
  | 'delete'
  | 'deleteInTransaction'
  | 'patch'
  | 'patchInTransaction'
  | 'recursiveDelete'
  | 'recursiveDeleteCollection'
  | 'update'
  | 'updateInTransaction'
  | 'upsert';

type NonWrite =
  | 'collectionGroup'
  | 'createSchema'
  | 'findByField'
  | 'fromSnapshot'
  | 'getAll'
  | 'getById'
  | 'getByIdOrThrow'
  | 'getByIdWithUpdateTime'
  | 'getCollectionPath'
  | 'getInTransaction'
  | 'getMany'
  | 'getManyInTransaction'
  | 'getOneByField'
  | 'getOneByFieldOrThrow'
  | 'getParentId'
  | 'id'
  | 'isSubcollection'
  | 'listenOne'
  | 'listenOneDetailed'
  | 'newId'
  | 'on'
  | 'query'
  | 'readSchema'
  | 'registerWriteInterceptor'
  | 'runInTransaction'
  | 'runReadOnlyAt'
  | 'safeValidate'
  | 'schemas'
  | 'subcollection'
  | 'updateSchema'
  | 'validate';

type Missing = Exclude<Keys, Write | NonWrite>;
type ExtraWrite = Exclude<Write, Keys>;
type ExtraNonWrite = Exclude<NonWrite, Keys>;
type _m = AssertTrue<ExpectEqual<Missing, never>>;
type _ew = AssertTrue<ExpectEqual<ExtraWrite, never>>;
type _en = AssertTrue<ExpectEqual<ExtraNonWrite, never>>;
