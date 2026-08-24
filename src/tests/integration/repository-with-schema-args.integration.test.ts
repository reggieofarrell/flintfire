/**
 * Strategy: emulator coverage for a subclass wired through `FirestoreRepository.withSchemaArgs`
 * with a write overlay (ADR-0042 / issue #102). Complements the unit suite (schema-bundle /
 * validate() shape) and the type tests (super(...) spread on both constructor-tuple branches).
 *
 * Verification points:
 *   1. Subclass create/update accept combinator sentinels (write overlay works end-to-end).
 *   2. After a write, `validate()` on a freshly read document succeeds (schemas.read is the read
 *      schema — not the write overlay).
 *   3. `schemas.stored` is populated so collection-group identity checks can consult it.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { ValidationError } from '../../core/Errors.js';
import { zNumberWrite } from '../../core/Validation.js';
import { getIntegrationDb } from './helpers/firestoreIntegrationHarness.js';

const counterRead = z.object({
  name: z.string().min(1),
  score: z.number(),
});
const counterWrite = z.object({
  name: z.string().min(1),
  score: zNumberWrite(),
});

type Counter = z.output<typeof counterRead>;
type CounterWriteIn = z.input<typeof counterWrite>;
type CounterWriteOut = z.output<typeof counterWrite>;

const COLLECTION = `test_with_schema_args_${Date.now()}`;

/**
 * Domain subclass that must use withSchemaArgs for the overlay path — the regression this issue
 * closes is that `makeValidator(counterWrite)` alone would leave schemas.read as the write overlay.
 */
class CounterRepository extends FirestoreRepository<
  Counter,
  CounterWriteIn,
  Counter,
  CounterWriteOut
> {
  constructor(db: FirebaseFirestore.Firestore) {
    super(
      ...FirestoreRepository.withSchemaArgs(db, COLLECTION, counterRead, {
        writeSchema: counterWrite,
        sentinelPolicy: 'strict',
      }),
    );
  }

  /** Example domain helper — proves the subclass surface remains usable. */
  async bump(id: string, by: number) {
    return this.update(id, { score: FieldValue.increment(by) });
  }
}

describe('withSchemaArgs subclass with write overlay (emulator)', () => {
  const db = getIntegrationDb();
  const repo = new CounterRepository(db);

  afterAll(async () => {
    const docs = await repo.query().get();
    if (docs.length > 0) {
      await repo.bulkDelete(docs.map(doc => doc.id));
    }
  });

  it('exposes schemas.read as the read schema and populates schemas.stored', () => {
    expect(repo.schemas?.read).toBe(counterRead);
    expect(repo.schemas?.stored).toBe(counterRead);
  });

  it('creates, increments via a subclass helper, and validate()s the read-back', async () => {
    const created = await repo.create({ name: 'counter', score: 5 });
    await repo.bump(created.id, 3);

    const persisted = await repo.getByIdOrThrow(created.id);
    expect(persisted.score).toBe(8);

    // schemas.read is the plain number schema — a successful validate() on a clean read is necessary
    // but not sufficient (a write-overlay read schema would also accept a number). The sentinel
    // rejection below is the trap that fails if schemas.read regresses to the write overlay.
    expect(repo.validate(persisted)).toEqual(persisted);
  });

  it('validate() rejects a FieldValue sentinel — schemas.read is not the write overlay', () => {
    // Mirrors the unit-suite trap on the integration-owned FirestoreRepository surface: if
    // buildWithSchemaArgs ever sets `read: writeBase`, this passes (over-permits) and the gate
    // catches the silent correctness hole.
    expect(() =>
      repo.validate({
        id: 'trap',
        name: 'x',
        score: FieldValue.increment(1) as unknown as number,
      }),
    ).toThrow(ValidationError);
  });
});
