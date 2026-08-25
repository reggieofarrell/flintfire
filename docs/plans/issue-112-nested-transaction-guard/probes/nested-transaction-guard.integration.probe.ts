/**
 * Probe (asks, then asserts — promoted to I-16/I-17 in §8): does the AsyncLocalStorage marker
 * actually survive a REAL `db.runTransaction(...)` call against the Firestore emulator, including
 * through a genuine SDK contention retry? This is the one thing the unit-mocked probe cannot answer
 * — the mock's `runTransaction` never retries.
 *
 * Not wired into jest.config.integration.js's testMatch as committed. To re-run: copy to
 * `src/tests/integration/_scratch112.integration.test.ts`, apply `prototype.patch` (or hand-implement
 * §6) to `src/core/FirestoreRepository.ts`, then:
 *   npm run test:integration:emulator -- src/tests/integration/_scratch112.integration.test.ts
 * (or `firebase emulators:exec --project demo-firestoreorm-test --only firestore
 * "npx jest --config jest.config.integration.js src/tests/integration/_scratch112.integration.test.ts"`)
 * then delete the copy and revert the src change.
 *
 * Observed on baseline `main` @ 510f595 with `prototype.patch` applied: 2 passed, 0 failed, with
 * `attempts` (the retry counter) landing at 2 in the second test — confirming the SDK really retried
 * and the guard fired on every attempt, not just the first.
 */
import { FirestoreRepository } from '../../../../src/core/FirestoreRepository.js';
import { getIntegrationDb, type User } from '../../../../src/tests/integration/helpers/firestoreIntegrationHarness.js';

const db = getIntegrationDb();
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const USERS = `test_users_scratch112_${suffix}`;
const MIRRORS = `test_mirrors_scratch112_${suffix}`;

describe('probe: nested-transaction guard against the real emulator', () => {
  it('I-16: throws when a transaction-mode write nests inside a real runInTransaction', async () => {
    const outerRepo = new FirestoreRepository<User>(db, USERS);
    const innerRepo = new FirestoreRepository<User>(db, USERS + '_inner');
    const mirrorRepo = new FirestoreRepository<{ marker: string }>(db, MIRRORS);
    innerRepo.registerWriteInterceptor({
      name: 'read-capable',
      read: async ({ reader }: any) => await reader.get(mirrorRepo, 'm'),
      write: ({ writer }: any) => writer.set(mirrorRepo, 'm', { marker: 'y' }),
    } as any);
    const innerDoc = await innerRepo.create({ name: 'inner' } as any);
    const innerId = (innerDoc as any).id;

    await expect(
      outerRepo.runInTransaction(async () => {
        await innerRepo.update(innerId, { name: 'z' } as any);
      }),
    ).rejects.toThrow(/already open/);
  });

  it('I-17: survives a genuine contention retry: the guard fires on every attempt', async () => {
    const repoA = new FirestoreRepository<User>(db, USERS + '_retryA');
    const innerRepo = new FirestoreRepository<User>(db, USERS + '_retryInner');
    const mirrorRepo = new FirestoreRepository<{ marker: string }>(db, MIRRORS + '_retry');
    innerRepo.registerWriteInterceptor({
      name: 'read-capable',
      read: async ({ reader }: any) => await reader.get(mirrorRepo, 'm'),
      write: ({ writer }: any) => writer.set(mirrorRepo, 'm', { marker: 'y' }),
    } as any);
    const contendedDoc = await repoA.create({ name: 'contended' } as any);
    const contended = (contendedDoc as any).id;

    let attempts = 0;
    const run = () =>
      repoA.runInTransaction(async (tx, repo) => {
        attempts++;
        await repo.getInTransaction(tx, contended);
        await new Promise(resolve => setTimeout(resolve, 25));
        await repo.updateInTransaction(tx, contended, { name: `run-${attempts}` } as any);
        await expect(innerRepo.update(contended, { name: 'nested' } as any)).rejects.toThrow(
          /already open/,
        );
      });

    await Promise.all([run(), run()]);
    expect(attempts).toBeGreaterThanOrEqual(2);
  });
});
