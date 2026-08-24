/**
 * Strategy: unit-test `FirestoreRepository.withSchemaArgs` — the public constructor-argument
 * assembly helper for subclasses (ADR-0042 / issue #102). These asserts need no Firestore I/O:
 * they inspect the returned tuple and the repository built from it. Verification points:
 *   1. write-overlay path: `schemas.read` is the *read* schema (not the write overlay), so
 *      `validate()` rejects a FieldValue sentinel a read should never accept;
 *   2. naive `makeValidator(writeSchema)` alone still over-permits — the regression this helper
 *      exists to make unreachable on the documented subclass path;
 *   3. `schemas.stored` is always populated (defaults to the read schema);
 *   4. options bag threads `readConverter`, `parentPath`, `allowLegacyDatastoreIds`,
 *      `sentinelPolicy` without positional `undefined`s;
 *   5. construction invariants (top-level `id`, converter-requires-storedSchema) still fire, and
 *      each factory keeps its own error-message wording byte-for-byte — including
 *      `subcollection`'s positional `(..., readSchema, ...)` label;
 *   5b. `sentinelPolicy` is actually threaded (only 'permissive' can prove this — 'strict' is the
 *      default, so asserting with 'strict' passes even if the option is dropped);
 *   6. `withSchema` and a subclass built via `withSchemaArgs` produce equivalent schema bundles;
 *   7. `parentPath` survives `super(...)` so `isSubcollection()` / `getParentId()` work.
 *
 * Emulator round-trips for overlay writes live in
 * `repository-schema-inferred-write-types.integration.test.ts` and
 * `repository-with-schema-args.integration.test.ts`. Coverage of FirestoreRepository.ts is owned
 * by the integration gate.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { ValidationError } from '../../core/Errors.js';
import { makeValidator, zNumberWrite } from '../../core/Validation.js';
import { createMockFirestoreDb } from '../shared/mocks/firestore.mocks.js';

/** Stub db — withSchemaArgs / validate never touch Firestore I/O. */
const { db } = createMockFirestoreDb();

const userRead = z.object({
  name: z.string(),
  score: z.number(),
});
const userWrite = z.object({
  name: z.string(),
  score: zNumberWrite(),
});

type User = z.infer<typeof userRead>;
type UserWrite = z.input<typeof userWrite>;
type UserParsed = z.output<typeof userWrite>;

describe('FirestoreRepository.withSchemaArgs', () => {
  describe('write-overlay schema bundle (the silent over-permission hole)', () => {
    it('sets schemas.read to the read schema, not the write overlay', () => {
      const args = FirestoreRepository.withSchemaArgs(db, 'users', userRead, {
        writeSchema: userWrite,
      });
      const [, , , , , schemas] = args;

      expect(schemas?.read).toBe(userRead);
      expect(schemas?.read).not.toBe(userWrite);
      // create/update derive from the write base (overlay), so they are not the read schema.
      expect(schemas?.create).not.toBe(userRead);
      expect(schemas?.update).not.toBe(userRead);
    });

    it('populates schemas.stored with the read schema when storedSchema is omitted', () => {
      const args = FirestoreRepository.withSchemaArgs(db, 'users', userRead, {
        writeSchema: userWrite,
      });
      const [, , , , , schemas] = args;
      expect(schemas?.stored).toBe(userRead);
    });

    it('honors an explicit storedSchema', () => {
      const stored = z.object({ name: z.string(), scoreCents: z.number() });
      const args = FirestoreRepository.withSchemaArgs(db, 'users', userRead, {
        writeSchema: userWrite,
        storedSchema: stored,
      });
      const [, , , , , schemas] = args;
      expect(schemas?.stored).toBe(stored);
    });

    it('validate() rejects a FieldValue sentinel on the read boundary', () => {
      // This is the correctness hole: with schemas.read forced to userRead, a sentinel that the
      // write overlay would accept must fail read validation.
      class OverlayRepo extends FirestoreRepository<User, UserWrite, User, UserParsed> {
        constructor() {
          super(
            ...FirestoreRepository.withSchemaArgs(db, 'users', userRead, {
              writeSchema: userWrite,
            }),
          );
        }
      }
      const repo = new OverlayRepo();

      expect(() =>
        repo.validate({
          id: 'u1',
          name: 'Alice',
          score: FieldValue.increment(1) as unknown as number,
        }),
      ).toThrow(ValidationError);
    });

    it('documents that naive makeValidator(write) alone still over-permits (the footgun)', () => {
      // Pin today's incorrect hand-rolled path so a future "helpful" change that somehow makes
      // makeValidator invent a separate read schema would fail this characterization — and so the
      // contrast with withSchemaArgs stays explicit in the suite.
      const naive = new FirestoreRepository(db, 'users', makeValidator(userWrite));
      // schemas.read is the write overlay — sentinel accepted (the bug withSchemaArgs closes).
      expect(() =>
        naive.validate({
          id: 'u1',
          name: 'Alice',
          score: FieldValue.increment(1) as unknown as number,
        }),
      ).not.toThrow();
      // And stored is unset on the validator fallback path.
      expect(naive.schemas?.stored).toBeUndefined();
    });
  });

  describe('options bag threading', () => {
    it('forwards parentPath and allowLegacyDatastoreIds into the tuple', () => {
      const args = FirestoreRepository.withSchemaArgs(db, 'users/u1/orders', userRead, {
        parentPath: 'users/u1/orders',
        allowLegacyDatastoreIds: true,
      });
      const [gotDb, path, , parentPath, , , allowLegacy] = args;
      expect(gotDb).toBe(db);
      expect(path).toBe('users/u1/orders');
      expect(parentPath).toBe('users/u1/orders');
      expect(allowLegacy).toBe(true);
    });

    it('parentPath survives super(...) so isSubcollection() / getParentId() work', () => {
      // The options bag exists so a subclassed subcollection does not thread positional undefineds
      // for readConverter / allowLegacyDatastoreIds just to reach parentPath.
      class OrderRepository extends FirestoreRepository<User> {
        constructor() {
          super(
            ...FirestoreRepository.withSchemaArgs(db, 'users/u1/orders', userRead, {
              parentPath: 'users/u1/orders',
            }),
          );
        }
      }
      const repo = new OrderRepository();
      expect(repo.isSubcollection()).toBe(true);
      expect(repo.getParentId()).toBe('u1');
      expect(repo.getCollectionPath()).toBe('users/u1/orders');
    });

    it('forwards readConverter when storedSchema is also supplied', () => {
      const readConverter = (snap: any) => snap.data() as User;
      const args = FirestoreRepository.withSchemaArgs(db, 'users', userRead, {
        readConverter,
        storedSchema: userRead,
      });
      const [, , , , gotConverter] = args;
      expect(gotConverter).toBe(readConverter);
    });

    it('throws when readConverter is present without storedSchema', () => {
      const readConverter = (snap: any) => snap.data() as User;
      expect(() =>
        FirestoreRepository.withSchemaArgs(db, 'users', userRead, {
          readConverter,
        } as any),
      ).toThrow(/FirestoreRepository\.withSchemaArgs: a readConverter requires a storedSchema/i);
    });

    it('rejects a top-level id on the read schema with an withSchemaArgs-prefixed message', () => {
      const mirrored = z.object({ id: z.string(), name: z.string() });
      expect(() => FirestoreRepository.withSchemaArgs(db, 'users', mirrored)).toThrow(
        /FirestoreRepository\.withSchemaArgs: schema must not declare a top-level "id"/i,
      );
    });
  });

  describe('factory error-message prefixes stay distinct (no context drift)', () => {
    const mirrored = z.object({ id: z.string(), name: z.string() });

    it('withSchema errors still name withSchema', () => {
      expect(() => FirestoreRepository.withSchema(db, 'users', mirrored)).toThrow(
        /FirestoreRepository\.withSchema: schema must not declare a top-level "id"/i,
      );
    });

    it('subcollection errors still name subcollection — including the positional read-schema label', () => {
      const parent = new FirestoreRepository<{ name: string }>(db, 'users');
      // `subcollection` takes readSchema positionally, so its message has always identified WHICH
      // argument was bad. Pinning the exact pre-refactor wording: routing through the shared
      // assembler must not silently degrade this to the bare `FirestoreRepository.subcollection`.
      expect(() => parent.subcollection('p1', 'orders', mirrored)).toThrow(
        /FirestoreRepository\.subcollection\(\.\.\., readSchema, \.\.\.\): schema must not declare a top-level "id"/i,
      );
    });

    it('subcollection writeSchema / storedSchema keep the bare-context suffix form', () => {
      const parent = new FirestoreRepository<{ name: string }>(db, 'users');
      const ok = z.object({ name: z.string() });
      expect(() => parent.subcollection('p1', 'orders', ok, { writeSchema: mirrored })).toThrow(
        /FirestoreRepository\.subcollection \(writeSchema\): schema must not declare a top-level "id"/i,
      );
      expect(() => parent.subcollection('p1', 'orders', ok, { storedSchema: mirrored })).toThrow(
        /FirestoreRepository\.subcollection \(storedSchema\): schema must not declare a top-level "id"/i,
      );
    });
  });

  describe('sentinelPolicy threading', () => {
    // Guard for a real gap: 'strict' is the DEFAULT (Validation.ts), so a test that passes
    // `sentinelPolicy: 'strict'` proves nothing — dropping the pass-through entirely leaves it
    // green. Only 'permissive' distinguishes threaded-from-dropped. Verified by mutation: removing
    // `sentinelPolicy: options?.sentinelPolicy` from buildWithSchemaArgs fails THIS test.
    const plain = z.object({ name: z.string(), count: z.number() });

    it("forwards 'permissive' so a bare sentinel on a plain field is waived", () => {
      const args = FirestoreRepository.withSchemaArgs(db, 'counters', plain, {
        sentinelPolicy: 'permissive',
      });
      const validator = args[2]!;
      // Under 'permissive', a bare FieldValue on a plain number leaf is the opt-in escape hatch.
      expect(() => validator.parseUpdate({ count: FieldValue.increment(1) })).not.toThrow();
    });

    it("defaults to 'strict', rejecting the same bare sentinel", () => {
      const args = FirestoreRepository.withSchemaArgs(db, 'counters', plain);
      const validator = args[2]!;
      expect(() => validator.parseUpdate({ count: FieldValue.increment(1) })).toThrow();
    });

    it("passing 'strict' explicitly matches the default (documents why 'strict' proves nothing)", () => {
      const explicit = FirestoreRepository.withSchemaArgs(db, 'counters', plain, {
        sentinelPolicy: 'strict',
      })[2]!;
      expect(() => explicit.parseUpdate({ count: FieldValue.increment(1) })).toThrow();
    });
  });

  describe('parity with withSchema', () => {
    it('builds a repository whose schemas match withSchema for the same inputs', () => {
      const viaFactory = FirestoreRepository.withSchema(db, 'users', userRead, {
        writeSchema: userWrite,
        sentinelPolicy: 'strict',
      });
      const viaArgs = new FirestoreRepository(
        ...FirestoreRepository.withSchemaArgs(db, 'users', userRead, {
          writeSchema: userWrite,
          sentinelPolicy: 'strict',
        }),
      );

      expect(viaArgs.schemas?.read).toBe(viaFactory.schemas?.read);
      expect(viaArgs.schemas?.stored).toBe(viaFactory.schemas?.stored);
      // create/update are freshly derived each call, so compare shape keys rather than identity.
      expect(Object.keys(viaArgs.schemas!.create.shape).sort()).toEqual(
        Object.keys(viaFactory.schemas!.create.shape).sort(),
      );
      expect(Object.keys(viaArgs.schemas!.update.shape).sort()).toEqual(
        Object.keys(viaFactory.schemas!.update.shape).sort(),
      );
    });
  });
});
