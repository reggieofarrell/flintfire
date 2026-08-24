/**
 * Type-level tests for `FirestoreRepository.withSchemaArgs` (ADR-0042 / issue #102).
 * Checked by `tsc` via `npm run test:types` — not jest (`isolatedModules` skips type-checking).
 *
 * Guards:
 *   - Spreading into `super(...)` type-checks on BOTH constructor-tuple branches:
 *     W === WO (plain schema / validator optional) and W !== WO (write overlay / validator required).
 *   - Overlay writes accept FieldValue sentinels with no cast; read type stays the read schema.
 *   - `readConverter` without `storedSchema` is a type error (mirrors withSchema).
 *   - RepositoryConstructorArgs is importable from the package root.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import {
  FirestoreRepository,
  zNumberWrite,
  zDateWrite,
  type RepositoryConstructorArgs,
} from '../../index.js';

declare const db: FirebaseFirestore.Firestore;

const userRead = z.object({
  name: z.string(),
  score: z.number(),
  happenedAt: z.date(),
});
const userWrite = z.object({
  name: z.string(),
  score: zNumberWrite(),
  happenedAt: zDateWrite(),
});

type User = z.output<typeof userRead>;
type UserWriteIn = z.input<typeof userWrite>;
type UserWriteOut = z.output<typeof userWrite>;

// ── A) Plain schema (W === WO): validator optional branch of RepositoryConstructorArgs ─────────
class PlainUserRepository extends FirestoreRepository<User> {
  constructor() {
    super(...FirestoreRepository.withSchemaArgs(db, 'users', userRead));
  }

  findActive() {
    return this.query().where('name', '==', 'a').get();
  }
}

export const plainRepo = new PlainUserRepository();

// ── B) Write overlay (W !== WO): validator *required* branch — must still spread cleanly ───────
class OverlayUserRepository extends FirestoreRepository<User, UserWriteIn, User, UserWriteOut> {
  constructor() {
    super(
      ...FirestoreRepository.withSchemaArgs(db, 'users', userRead, {
        writeSchema: userWrite,
        sentinelPolicy: 'strict',
      }),
    );
  }
}

export const overlayRepo = new OverlayUserRepository();

export async function overlayWritesAreCastFree() {
  await overlayRepo.create({
    name: 'a',
    score: FieldValue.increment(1),
    happenedAt: FieldValue.serverTimestamp(),
  });
  await overlayRepo.update('x', { score: FieldValue.increment(1) });
  await overlayRepo.update('x', { happenedAt: new Date() });
}

export async function overlayWritesRejectWrongScalars() {
  // @ts-expect-error string is not a valid write for a number|increment field
  await overlayRepo.update('x', { score: 'nope' });
  // @ts-expect-error number is not a valid write for a date|serverTimestamp field on create
  await overlayRepo.create({ name: 'a', score: 0, happenedAt: 123 });
}

// Reads stay typed by the read schema (FirestoreDocument overlays id).
export async function overlayReadsAreReadTyped() {
  const doc = await overlayRepo.getById('x');
  if (doc) {
    const _score: number = doc.score;
    const _at: Date = doc.happenedAt;
    void _score;
    void _at;
  }
}

// ── C) Converter overload: storedSchema required ───────────────────────────────────────────────
declare const readConverter: (snap: FirebaseFirestore.QueryDocumentSnapshot) => User;

export function converterRequiresStoredSchema() {
  // Valid: converter + storedSchema.
  const _ok = FirestoreRepository.withSchemaArgs(db, 'users', userRead, {
    readConverter,
    storedSchema: userRead,
  });
  void _ok;

  // @ts-expect-error readConverter without storedSchema is rejected (mirrors withSchema)
  FirestoreRepository.withSchemaArgs(db, 'users', userRead, { readConverter });
}

// ── D) RepositoryConstructorArgs is a root type export and names the tuple ─────────────────────
export type PlainArgs = RepositoryConstructorArgs<User, User, User>;
export type OverlayArgs = RepositoryConstructorArgs<User, UserWriteIn, UserWriteOut>;

export const namedArgs: OverlayArgs = FirestoreRepository.withSchemaArgs(db, 'users', userRead, {
  writeSchema: userWrite,
});

// ── E) The stored generic `S` is CHECKED against `storedSchema` (ADR-0042) ──────────────────────
// The tuple carries the stored type in its `schemas` slot, so a subclass whose `extends` clause
// contradicts the `storedSchema` it passes cannot compile. Zod 4's `ZodType<out Output>` covariance
// decides the direction: unrelated and wider are rejected (they would invent collection-group field
// paths that do not exist at rest); narrower is permitted (it only under-reports paths).
const storedShape = z.object({ name: z.string(), scoreCents: z.number() });
type StoredShape = z.output<typeof storedShape>;
declare const storedConverter: (snap: FirebaseFirestore.QueryDocumentSnapshot) => User;

// E1 — matching S: compiles.
class MatchingStored extends FirestoreRepository<User, User, StoredShape, User> {
  constructor() {
    super(
      ...FirestoreRepository.withSchemaArgs(db, 'users', userRead, {
        storedSchema: storedShape,
        readConverter: storedConverter,
      }),
    );
  }
}
export const matchingStored = new MatchingStored();

// E2 — unrelated S: rejected.
class UnrelatedStored extends FirestoreRepository<User, User, { totallyUnrelated: boolean }, User> {
  constructor() {
    super(
      // @ts-expect-error declared S contradicts the storedSchema passed here
      ...FirestoreRepository.withSchemaArgs(db, 'users', userRead, {
        storedSchema: storedShape,
        readConverter: storedConverter,
      }),
    );
  }
}
export const unrelatedStored = new UnrelatedStored();

// E3 — WIDER S: rejected. This is the dangerous direction — `extra` would become a queryable
// collection-group field path with nothing at rest behind it.
class WiderStored extends FirestoreRepository<
  User,
  User,
  { name: string; scoreCents: number; extra: boolean },
  User
> {
  constructor() {
    super(
      // @ts-expect-error declared S claims a field the stored schema does not have
      ...FirestoreRepository.withSchemaArgs(db, 'users', userRead, {
        storedSchema: storedShape,
        readConverter: storedConverter,
      }),
    );
  }
}
export const widerStored = new WiderStored();

// E4 — narrower S: permitted (under-permissive only). NO @ts-expect-error here on purpose; this
// line compiling is the documented, intended asymmetry.
class NarrowerStored extends FirestoreRepository<User, User, { name: string }, User> {
  constructor() {
    super(
      ...FirestoreRepository.withSchemaArgs(db, 'users', userRead, {
        storedSchema: storedShape,
        readConverter: storedConverter,
      }),
    );
  }
}
export const narrowerStored = new NarrowerStored();

// E5 — plain repository (no storedSchema): S defaults to T, still compiles with nothing extra.
class PlainStored extends FirestoreRepository<User> {
  constructor() {
    super(...FirestoreRepository.withSchemaArgs(db, 'users', userRead));
  }
}
export const plainStored = new PlainStored();
