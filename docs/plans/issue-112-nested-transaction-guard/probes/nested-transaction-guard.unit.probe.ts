/**
 * Probe (asserts — promoted to real tests in §8 as U-8a..U-8f): does an AsyncLocalStorage-based
 * "is a transaction already open on this Firestore instance" marker, checked right before the
 * write-interceptor-promoted `db.runTransaction(...)` call, actually produce the five behaviors the
 * fix needs — using ONLY the existing mocked-Firestore harness pattern from
 * `src/tests/unit/writeInterceptors.unit.test.ts` (no real Firestore needed for this part)?
 *
 * This file is NOT wired into any jest testMatch as committed (jest.config.unit.js only picks up
 * `src/tests/unit/**​/*.test.ts`). To re-run: copy this file to
 * `src/tests/unit/_scratch112.unit.test.ts`, apply `prototype.patch` (or hand-implement §6) to
 * `src/core/FirestoreRepository.ts`, run:
 *   npx jest --config jest.config.unit.js src/tests/unit/_scratch112.unit.test.ts
 * then delete the copy and revert the src change.
 *
 * Observed on baseline `main` @ 510f595 with `prototype.patch` applied: 5 passed, 0 failed.
 */
import { FirestoreRepository } from '../../../../src/core/FirestoreRepository.js';

interface TestUser {
  name: string;
}
interface Sibling {
  marker: string;
}

function harness() {
  const docRefs = new Map<string, any>();
  const makeDocRef = (id: string) => {
    if (!docRefs.has(id)) {
      docRefs.set(id, {
        id,
        get: jest.fn().mockResolvedValue({ exists: true, id, data: () => ({ marker: 'x' }) }),
        create: jest.fn().mockResolvedValue({ writeTime: {} }),
        set: jest.fn().mockResolvedValue({ writeTime: {} }),
        update: jest.fn().mockResolvedValue({ writeTime: {} }),
        delete: jest.fn().mockResolvedValue({ writeTime: {} }),
      });
    }
    return docRefs.get(id);
  };
  const collectionRef = {
    withConverter: jest.fn(),
    doc: jest.fn((id?: string) => makeDocRef(id ?? 'auto-id')),
  };
  const tx = {
    get: jest.fn(async (ref: any) => ({
      exists: true,
      id: ref?.id ?? 'doc-1',
      data: () => ({ marker: 'x' }),
    })),
    create: jest.fn(),
    set: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const db: any = {
    collection: jest.fn(() => collectionRef),
    batch: jest.fn(() => ({
      create: jest.fn(),
      set: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      commit: jest.fn(async () => []),
    })),
    runTransaction: jest.fn(async (fn: any) => await fn(tx)),
    getAll: jest.fn(async () => []),
  };
  const repo = new FirestoreRepository<TestUser>(db, 'users');
  const siblingRepo = new FirestoreRepository<Sibling>(db, 'siblings');
  const mirrorRepo = new FirestoreRepository<Sibling>(db, 'mirrors');
  siblingRepo.registerWriteInterceptor({
    name: 'read-capable',
    read: async ({ reader }: any) => await reader.get(mirrorRepo, 'm'),
    write: ({ writer }: any) => writer.set(mirrorRepo, 'm', { marker: 'y' }),
  } as any);
  return { repo, siblingRepo, db };
}

describe('probe: nested-transaction guard mechanism', () => {
  it('U-8a: throws when a transaction-mode write nests inside another runInTransaction on the same db', async () => {
    const { repo, siblingRepo } = harness();
    await expect(
      repo.runInTransaction(async () => {
        await siblingRepo.update('doc-1', { marker: 'z' } as any);
      }),
    ).rejects.toThrow(/already open/);
  });

  it('U-8b: does NOT throw when using updateInTransaction to join the caller transaction', async () => {
    const { repo, siblingRepo } = harness();
    await expect(
      repo.runInTransaction(async tx => {
        await siblingRepo.updateInTransaction(tx, 'doc-1', { marker: 'z' } as any);
      }),
    ).resolves.toBeUndefined();
  });

  it('U-8c: does NOT throw standalone (no ambient transaction)', async () => {
    const { siblingRepo } = harness();
    await expect(siblingRepo.update('doc-1', { marker: 'z' } as any)).resolves.toBeDefined();
  });

  it('U-8f: does NOT throw for explicit nested runInTransaction calls (unchanged, out of scope)', async () => {
    const { repo, siblingRepo } = harness();
    await expect(
      repo.runInTransaction(async () => {
        return await siblingRepo.runInTransaction(async () => 'ok');
      }),
    ).resolves.toBe('ok');
  });

  it('U-8e: throws even for the SAME repo calling its own plain write inside its own runInTransaction', async () => {
    const { siblingRepo } = harness();
    await expect(
      siblingRepo.runInTransaction(async (_tx, txRepo) => {
        await txRepo.update('doc-1', { marker: 'z' } as any);
      }),
    ).rejects.toThrow(/already open/);
  });
});
