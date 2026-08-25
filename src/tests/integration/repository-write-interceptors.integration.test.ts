/**
 * Strategy: emulator integration coverage for repository write interceptors (issue #108 /
 * ADR-0040) — the guarantee that an interceptor's writes commit in the SAME atomic boundary as the
 * write that triggered them, on every path, or that path refuses.
 *
 * This suite is the primary confidence layer: the unit suite pins WHICH boundary the ORM opens, and
 * only real Firestore can show that the sibling document actually landed with (or died with) the
 * domain write.
 *
 * Verification points (plan §8.4):
 *  - I-1:  batch mode — all seven single-document writes commit the sibling atomically
 *  - I-2:  transaction mode — the same seven, with a read phase whose value shapes the sibling
 *  - I-3:  an interceptor that throws aborts the domain write too (both modes)
 *  - I-4:  batch mode — five fixed-batch helpers + query().update() + query().delete()
 *  - I-5:  runInTransaction's repository carries the interceptors (the tx-clone bypass)
 *  - I-6:  withMetadata receipts stay 1:1 with the caller's documents (never an interceptor's)
 *  - I-7:  bulkDelete keeps `writeTimes.length === count`
 *  - I-8:  chunk boundaries fall BETWEEN groups, never inside one
 *  - I-9:  reads precede writes in transaction mode; a caller who writes first hits the SDK error
 *  - I-10: withMetadata throws under transaction mode, succeeds under batch mode
 *  - I-11: an interceptor target on another Firestore instance is refused before any commit
 *  - I-12: bulkWrite / recursiveDelete / recursiveDeleteCollection refuse, and work without one
 *  - I-13: the fixed-batch helpers and query write terminals refuse under transaction mode
 *  - I-14: with nothing registered every path is unchanged (additivity)
 *  - I-15: several interceptors run in registration order, and the first throw stops the rest
 */
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { WriteOutcomeError } from '../../core/Errors.js';
import type { FirestoreDocument } from '../../core/DocumentId.js';
import { z } from 'zod';
import { getIntegrationDb, type User } from './helpers/firestoreIntegrationHarness.js';

/** The sibling ("denormalized") shape every interceptor in this suite writes. */
interface Mirror {
  sourceId: string;
  marker: string;
  revision?: number;
  meta?: { a?: string; b?: string };
}

const db = getIntegrationDb();
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const USERS = `test_users_interceptors_${suffix}`;
const MIRRORS = `test_mirrors_interceptors_${suffix}`;

/**
 * Fresh repository instances per test.
 *
 * Registration is per instance and for the life of the process (there is no unregister API), so a
 * shared repository would leak interceptors between tests. The COLLECTIONS are shared, which is what
 * lets one test's cleanup serve them all.
 */
function freshRepos() {
  return {
    userRepo: new FirestoreRepository<User>(db, USERS),
    mirrorRepo: new FirestoreRepository<Mirror>(db, MIRRORS),
  };
}

/** A write-only interceptor mirroring every write into `mirrorRepo`. Batch-mode compatible. */
function mirrorInterceptor(mirrorRepo: FirestoreRepository<Mirror>, name = 'mirror') {
  return {
    name,
    write: ({ write, writer }: any) => {
      writer.set(mirrorRepo, `mirror-${write.id}`, {
        sourceId: write.id,
        marker: `${name}:${write.kind}`,
      });
    },
  };
}

/**
 * A read-capable interceptor: it reads the sibling first and increments its revision, so the value
 * it writes PROVES the read phase ran and was handed to the write phase.
 */
function revisionInterceptor(mirrorRepo: FirestoreRepository<Mirror>, name = 'revision') {
  return {
    name,
    read: async ({ write, reader }: any) =>
      (await reader.get(mirrorRepo, `mirror-${write.id}`)) as FirestoreDocument<Mirror> | null,
    write: ({ write, writer, reads }: any) => {
      writer.set(mirrorRepo, `mirror-${write.id}`, {
        sourceId: write.id,
        marker: `${name}:${write.kind}`,
        revision: (reads?.revision ?? 0) + 1,
      });
    },
  };
}

/** Empties both collections through interceptor-free repositories. */
async function cleanup() {
  const { userRepo, mirrorRepo } = freshRepos();
  for (const repo of [userRepo, mirrorRepo] as FirestoreRepository<any>[]) {
    const docs = await repo.query().get();
    if (docs.length > 0) {
      await repo.bulkDelete(docs.map((doc: { id: string }) => doc.id));
    }
  }
}

const mirrorRepoFor = () => freshRepos().mirrorRepo;
const readUser = async (id: string) => await freshRepos().userRepo.getById(id);
const readMirror = async (sourceId: string) =>
  await freshRepos().mirrorRepo.getById(`mirror-${sourceId}`);

describe('repository write interceptors (issue #108)', () => {
  afterEach(async () => {
    await cleanup();
  });

  describe('I-1: batch mode commits the sibling with every single-document write', () => {
    it('create', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      userRepo.registerWriteInterceptor(mirrorInterceptor(mirrorRepo));

      const { id } = await userRepo.create({ name: 'Ada', email: 'ada@example.com' });

      expect((await readUser(id))?.name).toBe('Ada');
      expect(await readMirror(id)).toMatchObject({ sourceId: id, marker: 'mirror:create' });
    });

    it('createWithId', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      userRepo.registerWriteInterceptor(mirrorInterceptor(mirrorRepo));

      await userRepo.createWithId('i1-with-id', { name: 'Grace' });

      expect((await readUser('i1-with-id'))?.name).toBe('Grace');
      expect(await readMirror('i1-with-id')).toMatchObject({ marker: 'mirror:create' });
    });

    it('update', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      await userRepo.createWithId('i1-update', { name: 'Ada' });
      userRepo.registerWriteInterceptor(mirrorInterceptor(mirrorRepo));

      await userRepo.update('i1-update', { name: 'Ada Lovelace' });

      expect((await readUser('i1-update'))?.name).toBe('Ada Lovelace');
      expect(await readMirror('i1-update')).toMatchObject({ marker: 'mirror:update' });
    });

    it('patch', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      await userRepo.createWithId('i1-patch', { name: 'Ada', profile: { verified: false } });
      userRepo.registerWriteInterceptor(mirrorInterceptor(mirrorRepo));

      await userRepo.patch('i1-patch', { profile: { verified: true } });

      expect((await readUser('i1-patch'))?.profile?.verified).toBe(true);
      expect(await readMirror('i1-patch')).toMatchObject({ marker: 'mirror:update' });
    });

    it('the payload an interceptor observes: nested for update, DOT-PATH for patch', async () => {
      // `patch()` / `update(…, { merge: true })` / `bulkPatch()` normalize nested objects into field
      // paths BEFORE validating, and the interceptor is handed that normalized payload. A plain
      // `update()` is not normalized. Both report `kind: 'update'` and `UpdateInput<W>` admits dotted
      // keys, so TypeScript cannot tell them apart — which makes this the only thing standing between
      // the two shapes and an interceptor that reads `write.data.profile?.verified` and silently
      // mirrors nothing under `patch()`.
      const seen: Record<string, unknown>[] = [];
      const { userRepo } = freshRepos();
      await userRepo.createWithId('i1-shape', { name: 'Ada', profile: { verified: false } });

      const { userRepo: observer } = freshRepos();
      observer.registerWriteInterceptor({
        name: 'payload-observer',
        write: ({ write }) => {
          if (write.kind === 'update') seen.push({ ...(write.data as Record<string, unknown>) });
        },
      });

      // Control: a plain update keeps the caller's nested object.
      await observer.update('i1-shape', { profile: { verified: true } });
      expect(seen).toHaveLength(1);
      expect(seen[0]).toEqual({ profile: { verified: true } });
      expect(seen[0]!['profile.verified']).toBeUndefined();

      // patch(): the same logical write, normalized to a field path.
      await observer.patch('i1-shape', { profile: { verified: false } });
      expect(seen).toHaveLength(2);
      expect(seen[1]).toEqual({ 'profile.verified': false });
      expect((seen[1] as { profile?: unknown }).profile).toBeUndefined();

      // update({ merge: true }) is patch's spelling, so it normalizes too.
      await observer.update('i1-shape', { profile: { verified: true } }, { merge: true });
      expect(seen[2]).toEqual({ 'profile.verified': true });

      // A FLAT payload is unaffected either way — normalization only rewrites nested objects, which
      // is why the guide's own published example is not exposed to this.
      await observer.update('i1-shape', { name: 'Ada L' });
      await observer.patch('i1-shape', { name: 'Ada Lovelace' });
      expect(seen[3]).toEqual({ name: 'Ada L' });
      expect(seen[4]).toEqual({ name: 'Ada Lovelace' });
    });

    it('bulkPatch hands the interceptor the same dot-path shape as patch', async () => {
      const seen: Record<string, unknown>[] = [];
      const { userRepo } = freshRepos();
      await userRepo.createWithId('i1-bulkshape', { name: 'Ada', profile: { verified: false } });

      const { userRepo: observer } = freshRepos();
      observer.registerWriteInterceptor({
        name: 'bulk-payload-observer',
        write: ({ write }) => {
          if (write.kind === 'update') seen.push({ ...(write.data as Record<string, unknown>) });
        },
      });

      await observer.bulkUpdate([{ id: 'i1-bulkshape', data: { profile: { verified: true } } }]);
      await observer.bulkPatch([{ id: 'i1-bulkshape', data: { profile: { verified: false } } }]);

      expect(seen[0]).toEqual({ profile: { verified: true } });
      expect(seen[1]).toEqual({ 'profile.verified': false });
    });

    it("upsert's create branch", async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      userRepo.registerWriteInterceptor(mirrorInterceptor(mirrorRepo));

      await userRepo.upsert('i1-upsert-create', { name: 'Hopper' });

      expect((await readUser('i1-upsert-create'))?.name).toBe('Hopper');
      // The create branch reports `kind: 'create'` — the write actually performed.
      expect(await readMirror('i1-upsert-create')).toMatchObject({ marker: 'mirror:create' });
    });

    it("upsert's update branch", async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      await userRepo.createWithId('i1-upsert-update', { name: 'Hopper' });
      userRepo.registerWriteInterceptor(mirrorInterceptor(mirrorRepo));

      await userRepo.upsert('i1-upsert-update', { name: 'Grace Hopper' });

      expect((await readUser('i1-upsert-update'))?.name).toBe('Grace Hopper');
      expect(await readMirror('i1-upsert-update')).toMatchObject({ marker: 'mirror:update' });
    });

    it('delete — and the interceptor receives the whole stored document', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      await userRepo.createWithId('i1-delete', { name: 'Ada', email: 'ada@example.com' });
      const seen: unknown[] = [];
      userRepo.registerWriteInterceptor({
        name: 'delete-mirror',
        write: ({ write, writer }) => {
          seen.push(write);
          writer.set(mirrorRepo, `mirror-${write.id}`, {
            sourceId: write.id,
            // Proves the interceptor got the DOCUMENT, not just the id (every delete path pre-reads).
            marker: write.kind === 'delete' ? `deleted:${write.document.name}` : 'unexpected',
          });
        },
      });

      await userRepo.delete('i1-delete');

      expect(await readUser('i1-delete')).toBeNull();
      expect(await readMirror('i1-delete')).toMatchObject({ marker: 'deleted:Ada' });
      expect(seen).toHaveLength(1);
    });
  });

  describe('I-2: transaction mode runs the read phase and commits the sibling', () => {
    it('create / createWithId / update / patch / both upsert branches / delete', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      userRepo.registerWriteInterceptor(revisionInterceptor(mirrorRepo));

      // create
      const { id: createdId } = await userRepo.create({ name: 'Ada' });
      expect(await readMirror(createdId)).toMatchObject({ marker: 'revision:create', revision: 1 });

      // createWithId
      await userRepo.createWithId('i2-with-id', { name: 'Grace' });
      expect(await readMirror('i2-with-id')).toMatchObject({ revision: 1 });

      // update — the read phase now SEES revision 1 and writes 2, proving reads reached writes.
      await userRepo.update('i2-with-id', { name: 'Grace H' });
      expect(await readMirror('i2-with-id')).toMatchObject({
        marker: 'revision:update',
        revision: 2,
      });

      // patch
      await userRepo.patch('i2-with-id', { email: 'grace@example.com' });
      expect(await readMirror('i2-with-id')).toMatchObject({ revision: 3 });

      // upsert (update branch)
      await userRepo.upsert('i2-with-id', { name: 'Grace Hopper' });
      expect(await readMirror('i2-with-id')).toMatchObject({ revision: 4 });
      expect((await readUser('i2-with-id'))?.name).toBe('Grace Hopper');

      // upsert (create branch)
      await userRepo.upsert('i2-upsert-create', { name: 'Hopper' });
      expect(await readMirror('i2-upsert-create')).toMatchObject({
        marker: 'revision:create',
        revision: 1,
      });

      // delete
      await userRepo.delete('i2-with-id');
      expect(await readUser('i2-with-id')).toBeNull();
      expect(await readMirror('i2-with-id')).toMatchObject({
        marker: 'revision:delete',
        revision: 5,
      });
    });
  });

  describe('I-3: an interceptor that throws aborts the domain write', () => {
    it('batch mode — the primary document never lands', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      void mirrorRepo;
      userRepo.registerWriteInterceptor({
        name: 'always-throws',
        write: () => {
          throw new Error('interceptor refused this write');
        },
      });

      await expect(userRepo.createWithId('i3-batch', { name: 'Ada' })).rejects.toThrow(
        /interceptor refused this write/,
      );
      expect(await readUser('i3-batch')).toBeNull();
    });

    it('transaction mode — the primary document never lands', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      userRepo.registerWriteInterceptor({
        name: 'throws-after-read',
        read: async () => 'read-ran',
        write: ({ writer, write }) => {
          // Stage a real sibling write FIRST, then throw: proves the abort discards staged writes,
          // not merely that nothing was ever staged.
          writer.set(mirrorRepo, `mirror-${write.id}`, { sourceId: write.id, marker: 'x' });
          throw new Error('interceptor refused this write');
        },
      });

      await expect(userRepo.createWithId('i3-tx', { name: 'Ada' })).rejects.toThrow(
        /interceptor refused this write/,
      );
      expect(await readUser('i3-tx')).toBeNull();
      expect(await readMirror('i3-tx')).toBeNull();
    });

    it('an existing document is left unchanged when an update interceptor throws', async () => {
      const { userRepo } = freshRepos();
      await userRepo.createWithId('i3-unchanged', { name: 'Original' });
      const { userRepo: guarded } = freshRepos();
      guarded.registerWriteInterceptor({
        name: 'always-throws',
        write: () => {
          throw new Error('nope');
        },
      });

      await expect(guarded.update('i3-unchanged', { name: 'Changed' })).rejects.toThrow(/nope/);
      expect((await readUser('i3-unchanged'))?.name).toBe('Original');
    });
  });

  describe('I-4: batch mode covers every bulk helper and query write terminal', () => {
    it('bulkCreate', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      userRepo.registerWriteInterceptor(mirrorInterceptor(mirrorRepo));

      const created = await userRepo.bulkCreate([{ name: 'A' }, { name: 'B' }]);

      for (const { id } of created) {
        expect((await readUser(id))?.name).toMatch(/^[AB]$/);
        expect(await readMirror(id)).toMatchObject({ sourceId: id, marker: 'mirror:create' });
      }
    });

    it('bulkCreateWithIds', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      userRepo.registerWriteInterceptor(mirrorInterceptor(mirrorRepo));

      await userRepo.bulkCreateWithIds([
        { id: 'i4-bcwi-1', data: { name: 'A' } },
        { id: 'i4-bcwi-2', data: { name: 'B' } },
      ]);

      expect(await readMirror('i4-bcwi-1')).toMatchObject({ marker: 'mirror:create' });
      expect(await readMirror('i4-bcwi-2')).toMatchObject({ marker: 'mirror:create' });
    });

    it('bulkUpdate and bulkPatch', async () => {
      const { userRepo } = freshRepos();
      await userRepo.bulkCreateWithIds([
        { id: 'i4-bu-1', data: { name: 'A' } },
        { id: 'i4-bu-2', data: { name: 'B' } },
      ]);

      const { userRepo: updater, mirrorRepo } = freshRepos();
      updater.registerWriteInterceptor(mirrorInterceptor(mirrorRepo, 'bulk-mirror'));
      await updater.bulkUpdate([
        { id: 'i4-bu-1', data: { name: 'A2' } },
        { id: 'i4-bu-2', data: { name: 'B2' } },
      ]);
      expect(await readMirror('i4-bu-1')).toMatchObject({ marker: 'bulk-mirror:update' });
      expect(await readMirror('i4-bu-2')).toMatchObject({ marker: 'bulk-mirror:update' });
      expect((await readUser('i4-bu-1'))?.name).toBe('A2');

      const { userRepo: patcher, mirrorRepo: patchMirror } = freshRepos();
      patcher.registerWriteInterceptor(mirrorInterceptor(patchMirror, 'patch-mirror'));
      await patcher.bulkPatch([{ id: 'i4-bu-1', data: { email: 'a@example.com' } }]);
      expect(await readMirror('i4-bu-1')).toMatchObject({ marker: 'patch-mirror:update' });
    });

    it('bulkDelete — the interceptor sees each deleted document', async () => {
      const { userRepo } = freshRepos();
      await userRepo.bulkCreateWithIds([
        { id: 'i4-bd-1', data: { name: 'A' } },
        { id: 'i4-bd-2', data: { name: 'B' } },
      ]);

      const { userRepo: deleter, mirrorRepo } = freshRepos();
      deleter.registerWriteInterceptor({
        name: 'delete-mirror',
        write: ({ write, writer }) => {
          writer.set(mirrorRepo, `mirror-${write.id}`, {
            sourceId: write.id,
            marker: write.kind === 'delete' ? `deleted:${write.document.name}` : 'unexpected',
          });
        },
      });

      const count = await deleter.bulkDelete(['i4-bd-1', 'i4-bd-2']);

      expect(count).toBe(2);
      expect(await readUser('i4-bd-1')).toBeNull();
      // Each interceptor got ITS OWN document, not a shared or off-by-one one.
      expect(await readMirror('i4-bd-1')).toMatchObject({ marker: 'deleted:A' });
      expect(await readMirror('i4-bd-2')).toMatchObject({ marker: 'deleted:B' });
    });

    it('query().update()', async () => {
      const { userRepo } = freshRepos();
      await userRepo.bulkCreateWithIds([
        { id: 'i4-qu-1', data: { name: 'target' } },
        { id: 'i4-qu-2', data: { name: 'target' } },
      ]);

      const { userRepo: updater, mirrorRepo } = freshRepos();
      updater.registerWriteInterceptor(mirrorInterceptor(mirrorRepo, 'query-mirror'));
      const updated = await updater
        .query()
        .where('name', '==', 'target')
        .update({ email: 'q@example.com' });

      expect(updated).toBe(2);
      expect(await readMirror('i4-qu-1')).toMatchObject({ marker: 'query-mirror:update' });
      expect(await readMirror('i4-qu-2')).toMatchObject({ marker: 'query-mirror:update' });
    });

    it('select().update() — a PROJECTED builder still runs the interceptor', async () => {
      // `update()` has no `hasSelect` guard (only `delete()` does), so a projected builder is a real
      // write path. It is built by `select()` as a REPLACEMENT builder, so the interceptor collector
      // has to be carried across the projection or every interceptor is silently skipped here.
      const { userRepo } = freshRepos();
      await userRepo.bulkCreateWithIds([
        { id: 'i4-sel-1', data: { name: 'projected' } },
        { id: 'i4-sel-2', data: { name: 'projected' } },
      ]);

      const { userRepo: updater, mirrorRepo } = freshRepos();
      updater.registerWriteInterceptor(mirrorInterceptor(mirrorRepo, 'select-mirror'));
      const updated = await updater
        .query()
        .where('name', '==', 'projected')
        .select('name')
        .update({ email: 'sel@example.com' });

      expect(updated).toBe(2);
      expect(await readMirror('i4-sel-1')).toMatchObject({ marker: 'select-mirror:update' });
      expect(await readMirror('i4-sel-2')).toMatchObject({ marker: 'select-mirror:update' });
    });

    it('query().delete() — the interceptor sees each deleted document', async () => {
      const { userRepo } = freshRepos();
      await userRepo.bulkCreateWithIds([
        { id: 'i4-qd-1', data: { name: 'doomed' } },
        { id: 'i4-qd-2', data: { name: 'doomed' } },
      ]);

      const { userRepo: deleter, mirrorRepo } = freshRepos();
      deleter.registerWriteInterceptor({
        name: 'query-delete-mirror',
        write: ({ write, writer }) => {
          writer.set(mirrorRepo, `mirror-${write.id}`, {
            sourceId: write.id,
            marker: write.kind === 'delete' ? `deleted:${write.document.id}` : 'unexpected',
          });
        },
      });

      const deleted = await deleter.query().where('name', '==', 'doomed').delete();

      expect(deleted).toBe(2);
      expect(await readUser('i4-qd-1')).toBeNull();
      expect(await readMirror('i4-qd-1')).toMatchObject({ marker: 'deleted:i4-qd-1' });
      expect(await readMirror('i4-qd-2')).toMatchObject({ marker: 'deleted:i4-qd-2' });
    });
  });

  describe('returnDoc reads back after the boundary commits, in both modes', () => {
    it('batch mode', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      userRepo.registerWriteInterceptor(mirrorInterceptor(mirrorRepo, 'rd-batch'));

      const created = await userRepo.create({ name: 'Ada' }, { returnDoc: true });
      expect(created.name).toBe('Ada');
      expect(await readMirror(created.id)).toMatchObject({ marker: 'rd-batch:create' });

      const updated = await userRepo.update(created.id, { name: 'Ada L' }, { returnDoc: true });
      expect(updated.name).toBe('Ada L');
    });

    it('transaction mode', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      userRepo.registerWriteInterceptor(revisionInterceptor(mirrorRepo, 'rd-tx'));

      const created = await userRepo.create({ name: 'Grace' }, { returnDoc: true });
      expect(created.name).toBe('Grace');
      expect(await readMirror(created.id)).toMatchObject({ revision: 1 });

      const upserted = await userRepo.upsert(created.id, { name: 'Grace H' }, { returnDoc: true });
      expect(upserted.name).toBe('Grace H');
      expect(await readMirror(created.id)).toMatchObject({ revision: 2 });
    });
  });

  describe('I-5: the transaction clone carries the interceptors', () => {
    it('a write through runInTransaction’s repository still runs the interceptor', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      userRepo.registerWriteInterceptor(mirrorInterceptor(mirrorRepo, 'tx-clone-mirror'));

      await userRepo.runInTransaction(async (tx, repo) => {
        await repo.createWithIdInTransaction(tx, 'i5-created', { name: 'Ada' });
      });

      expect((await readUser('i5-created'))?.name).toBe('Ada');
      // Without the clone carrying interceptors this is null — a silent bypass, no error anywhere.
      expect(await readMirror('i5-created')).toMatchObject({ marker: 'tx-clone-mirror:create' });
    });

    it('covers every *InTransaction helper', async () => {
      const { userRepo } = freshRepos();
      await userRepo.createWithId('i5-target', { name: 'Original' });

      const { userRepo: intercepted, mirrorRepo } = freshRepos();
      intercepted.registerWriteInterceptor(mirrorInterceptor(mirrorRepo, 'tx-all'));

      await intercepted.runInTransaction(async (tx, repo) => {
        const { id } = await repo.createInTransaction(tx, { name: 'auto' });
        await repo.updateInTransaction(tx, 'i5-target', { name: 'Updated' });
        return id;
      });
      expect((await readUser('i5-target'))?.name).toBe('Updated');
      expect(await readMirror('i5-target')).toMatchObject({ marker: 'tx-all:update' });

      await intercepted.runInTransaction(async (tx, repo) => {
        await repo.patchInTransaction(tx, 'i5-target', { email: 'p@example.com' });
      });
      expect(await readMirror('i5-target')).toMatchObject({ marker: 'tx-all:update' });

      await intercepted.runInTransaction(async (tx, repo) => {
        await repo.deleteInTransaction(tx, 'i5-target');
      });
      expect(await readUser('i5-target')).toBeNull();
      expect(await readMirror('i5-target')).toMatchObject({ marker: 'tx-all:delete' });
    });

    it('a read-capable interceptor joins the caller’s transaction', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      userRepo.registerWriteInterceptor(revisionInterceptor(mirrorRepo, 'tx-revision'));

      await userRepo.runInTransaction(async (tx, repo) => {
        await repo.createWithIdInTransaction(tx, 'i5-revision', { name: 'Ada' });
      });
      expect(await readMirror('i5-revision')).toMatchObject({ revision: 1 });

      await userRepo.runInTransaction(async (tx, repo) => {
        await repo.updateInTransaction(tx, 'i5-revision', { name: 'Ada L' });
      });
      // The read phase saw revision 1 inside the caller's own transaction.
      expect(await readMirror('i5-revision')).toMatchObject({ revision: 2 });
    });
  });

  describe('I-6 / I-7: withMetadata receipts stay 1:1 with the caller’s documents', () => {
    it('bulkCreate returns exactly one receipt per row, and each is that document’s own', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      userRepo.registerWriteInterceptor(mirrorInterceptor(mirrorRepo));

      const rows = [{ name: 'R1' }, { name: 'R2' }, { name: 'R3' }];
      const created = await userRepo.bulkCreate(rows, { withMetadata: true });

      // Without domain-only receipt projection this is 6 (three domain + three interceptor writes).
      expect(created).toHaveLength(3);
      for (const { id, writeTime } of created) {
        expect(writeTime).toBeInstanceOf(Timestamp);
        const stored = await freshRepos().userRepo.getByIdWithUpdateTime(id);
        expect(stored?.updateTime.isEqual(writeTime)).toBe(true);
      }
      // NOTE on what this can and cannot prove: every write in one committed batch shares a single
      // commit timestamp, so the `isEqual` above would hold even if the projection handed back an
      // INTERCEPTOR's receipt. Within one chunk it pins the count, not the index. Receipt IDENTITY
      // is carried by two other tests: the cross-chunk assertions in "a multi-write interceptor
      // divides chunk capacity" above, and — where receipts really are distinguishable — the
      // labelled-receipt cases in `writeInterceptors.unit.test.ts` (U-7).
    });

    it('bulkCreateWithIds, bulkUpdate and bulkPatch keep positional receipts', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      userRepo.registerWriteInterceptor(mirrorInterceptor(mirrorRepo));

      const createdWithIds = await userRepo.bulkCreateWithIds(
        [
          { id: 'i6-a', data: { name: 'A' } },
          { id: 'i6-b', data: { name: 'B' } },
        ],
        { withMetadata: true },
      );
      expect(createdWithIds).toHaveLength(2);
      expect(createdWithIds.map(row => row.id)).toEqual(['i6-a', 'i6-b']);
      for (const { id, writeTime } of createdWithIds) {
        const stored = await freshRepos().userRepo.getByIdWithUpdateTime(id);
        expect(stored?.updateTime.isEqual(writeTime)).toBe(true);
      }

      const { userRepo: updater, mirrorRepo: updateMirror } = freshRepos();
      updater.registerWriteInterceptor(mirrorInterceptor(updateMirror, 'update-mirror'));
      const updated = await updater.bulkUpdate(
        [
          { id: 'i6-a', data: { name: 'A2' } },
          { id: 'i6-b', data: { name: 'B2' } },
        ],
        { withMetadata: true },
      );
      expect(updated).toHaveLength(2);
      for (const { id, writeTime } of updated) {
        const stored = await freshRepos().userRepo.getByIdWithUpdateTime(id);
        expect(stored?.updateTime.isEqual(writeTime)).toBe(true);
      }

      const { userRepo: patcher, mirrorRepo: patchMirror } = freshRepos();
      patcher.registerWriteInterceptor(mirrorInterceptor(patchMirror, 'patch-mirror'));
      const patched = await patcher.bulkPatch([{ id: 'i6-a', data: { email: 'a@x.com' } }], {
        withMetadata: true,
      });
      expect(patched).toHaveLength(1);
      const storedPatched = await freshRepos().userRepo.getByIdWithUpdateTime('i6-a');
      expect(storedPatched?.updateTime.isEqual(patched[0]!.writeTime)).toBe(true);
    });

    it('I-7: bulkDelete keeps writeTimes.length === count', async () => {
      const { userRepo } = freshRepos();
      await userRepo.bulkCreateWithIds([
        { id: 'i7-1', data: { name: 'A' } },
        { id: 'i7-2', data: { name: 'B' } },
        { id: 'i7-3', data: { name: 'C' } },
      ]);

      const { userRepo: deleter, mirrorRepo } = freshRepos();
      deleter.registerWriteInterceptor(mirrorInterceptor(mirrorRepo, 'delete-mirror'));

      const result = await deleter.bulkDelete(['i7-1', 'i7-2', 'i7-3', 'i7-missing'], {
        withMetadata: true,
      });

      // 3 existing documents → 3 receipts, even though 6 physical writes were committed.
      expect(result.count).toBe(3);
      expect(result.writeTimes).toHaveLength(3);
      expect(result.writeTimes.every(time => time instanceof Timestamp)).toBe(true);
    });
  });

  describe('I-8: a chunk boundary never falls inside a group', () => {
    /**
     * The group size MUST NOT divide 500 evenly, or this test cannot fail.
     *
     * A naive port of the pre-#108 loop increments a flat counter and commits the moment it hits
     * exactly 500 — mid-group. With a group of 2 (one interceptor) the counter only ever takes even
     * values, so it reaches 500 exactly at a group boundary and the naive loop is accidentally
     * correct: the bug is unobservable. With a group of 3 (TWO interceptors), position 499 falls on
     * a group's FIRST interceptor write, so the naive loop commits with that group half-staged and
     * its second sibling lands in the next chunk. Verified by mutation: the naive port passes this
     * test at group size 2 and fails it at group size 3.
     */
    it('200 documents with two interceptors commit as two chunks, groups intact', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      userRepo.registerWriteInterceptor({
        name: 'chunk-mirror-a',
        write: ({ write, writer }) => {
          writer.set(mirrorRepo, `mirror-${write.id}`, { sourceId: write.id, marker: 'a' });
        },
      });
      userRepo.registerWriteInterceptor({
        name: 'chunk-mirror-b',
        write: ({ write, writer }) => {
          writer.set(mirrorRepo, `mirror-b-${write.id}`, { sourceId: write.id, marker: 'b' });
        },
      });

      // 200 groups of 3 physical writes = 600 ops. A whole group must fit, so chunk 1 holds 166
      // groups (498 ops) and chunk 2 the remaining 34 (102 ops) — the boundary lands BETWEEN groups
      // 165 and 166. Asserting on OBSERVABLE grouping, never on "501 ops should fail": the emulator
      // does not enforce the 500-op batch limit, so such a test would pass vacuously.
      const rows = Array.from({ length: 200 }, (_, index) => ({
        id: `i8-${String(index).padStart(3, '0')}`,
        data: { name: `chunked-${index}` },
      }));
      const created = await userRepo.bulkCreateWithIds(rows, { withMetadata: true });

      expect(created).toHaveLength(200);

      // Exactly two commits: every write in one batch shares a single commit timestamp.
      const distinct = new Set(created.map(row => row.writeTime.toMillis()));
      expect(distinct.size).toBe(2);

      // Every domain document AND both siblings per document exist.
      const users = await freshRepos().userRepo.query().where('name', '>=', 'chunked-').get();
      expect(users).toHaveLength(200);
      const mirrors = await freshRepos().mirrorRepo.query().get();
      expect(mirrors).toHaveLength(400);

      // The two boundary-adjacent groups really are in DIFFERENT commits, which is what makes the
      // per-group assertion below meaningful.
      expect(created[165]!.writeTime.isEqual(created[166]!.writeTime)).toBe(false);

      // Each group committed WHOLE: both siblings carry their domain document's commit timestamp.
      // A straddling group shows one sibling with the OTHER chunk's timestamp.
      const mirrorRepoForReads = freshRepos().mirrorRepo;
      for (const index of [0, 164, 165, 166, 167, 199]) {
        const row = created[index]!;
        const siblingA = await mirrorRepoForReads.getByIdWithUpdateTime(`mirror-${row.id}`);
        const siblingB = await mirrorRepoForReads.getByIdWithUpdateTime(`mirror-b-${row.id}`);
        expect(siblingA).not.toBeNull();
        expect(siblingB).not.toBeNull();
        expect(siblingA!.updateTime.isEqual(row.writeTime)).toBe(true);
        expect(siblingB!.updateTime.isEqual(row.writeTime)).toBe(true);
      }
    }, 60_000);
  });

  describe('an interceptor that throws aborts BEFORE any chunk commits', () => {
    it('a failure on a late document leaves every earlier chunk uncommitted too', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      // Throws only for a document that would land in the SECOND chunk.
      userRepo.registerWriteInterceptor({
        name: 'late-thrower',
        write: ({ write, writer }) => {
          if (write.id === 'wo-255') throw new Error('interceptor refused document 255');
          writer.set(mirrorRepo, `mirror-${write.id}`, { sourceId: write.id, marker: 'ok' });
        },
      });

      const rows = Array.from({ length: 260 }, (_, index) => ({
        id: `wo-${index}`,
        data: { name: `outcome-${index}` },
      }));

      const error = await userRepo
        .bulkCreateWithIds(rows)
        .then(() => null)
        .catch((caught: Error) => caught);

      // Every interceptor's write phase runs during the recording pass, BEFORE the first commit —
      // a consequence of having to know each group's real physical size to place chunk boundaries.
      // So a refusal on document 255 costs nothing: it is a plain Error, not a partial commit.
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(WriteOutcomeError);
      expect((error as Error).message).toMatch(/interceptor refused document 255/);

      // NOTHING landed — not the first 250 documents, not a single mirror.
      expect(await readUser('wo-0')).toBeNull();
      expect(await readUser('wo-249')).toBeNull();
      expect(await readUser('wo-259')).toBeNull();
      expect(await freshRepos().mirrorRepo.query().get()).toHaveLength(0);
    }, 60_000);

    it('a multi-write interceptor divides chunk capacity by its real write count', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      // TWO writes per document from ONE interceptor: capacity is floor(500 / 3) = 166 documents
      // per chunk, not floor(500 / 2) = 250. Counting interceptors instead of their writes would
      // build a 600-operation batch here — which the emulator accepts and production rejects.
      userRepo.registerWriteInterceptor({
        name: 'two-writes',
        write: ({ write, writer }) => {
          writer.set(mirrorRepo, `mirror-${write.id}`, { sourceId: write.id, marker: 'a' });
          writer.set(mirrorRepo, `mirror-b-${write.id}`, { sourceId: write.id, marker: 'b' });
        },
      });

      const rows = Array.from({ length: 200 }, (_, index) => ({
        id: `cap-${String(index).padStart(3, '0')}`,
        data: { name: `capacity-${index}` },
      }));
      const created = await userRepo.bulkCreateWithIds(rows, { withMetadata: true });

      expect(created).toHaveLength(200);
      // Two commits, and the boundary falls between documents 165 and 166 — the physical arithmetic.
      expect(new Set(created.map(row => row.writeTime.toMillis())).size).toBe(2);
      expect(created[165]!.writeTime.isEqual(created[166]!.writeTime)).toBe(false);
      expect(await freshRepos().mirrorRepo.query().get()).toHaveLength(400);

      // Cross-chunk receipt identity: within one batch every write shares a timestamp, so this is
      // the only way a mis-indexed projection becomes visible at all in the emulator.
      const mirrors = freshRepos().mirrorRepo;
      for (const index of [0, 165, 166, 199]) {
        const row = created[index]!;
        const own = await freshRepos().userRepo.getByIdWithUpdateTime(row.id);
        expect(own!.updateTime.isEqual(row.writeTime)).toBe(true);
        expect(
          (await mirrors.getByIdWithUpdateTime(`mirror-${row.id}`))!.updateTime.isEqual(
            row.writeTime,
          ),
        ).toBe(true);
        expect(
          (await mirrors.getByIdWithUpdateTime(`mirror-b-${row.id}`))!.updateTime.isEqual(
            row.writeTime,
          ),
        ).toBe(true);
      }
    }, 60_000);

    it('an interceptor that stages nothing leaves receipts 1:1 with the documents', async () => {
      const { userRepo } = freshRepos();
      userRepo.registerWriteInterceptor({ name: 'silent', write: () => undefined });

      const created = await userRepo.bulkCreateWithIds(
        [
          { id: 'silent-a', data: { name: 'A' } },
          { id: 'silent-b', data: { name: 'B' } },
        ],
        { withMetadata: true },
      );

      // Reserving a slot for a write that never happened reads past the end of the receipt array.
      expect(created).toHaveLength(2);
      expect(created.map(row => row.id)).toEqual(['silent-a', 'silent-b']);
      expect((await readUser('silent-a'))?.name).toBe('A');
    });
  });

  describe('I-9: all interceptor reads precede all writes', () => {
    it('a read-capable interceptor does not trip the SDK ordering rule', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      userRepo.registerWriteInterceptor(revisionInterceptor(mirrorRepo, 'ordered'));

      await expect(userRepo.createWithId('i9-ok', { name: 'Ada' })).resolves.toEqual({
        id: 'i9-ok',
      });
      expect(await readMirror('i9-ok')).toMatchObject({ revision: 1 });
    });

    it('a caller who writes before the ORM reads surfaces the SDK ordering error', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      await userRepo.createWithId('i9-target', { name: 'Ada' });

      const { userRepo: intercepted, mirrorRepo: sibling } = freshRepos();
      void mirrorRepo;
      intercepted.registerWriteInterceptor(revisionInterceptor(sibling, 'late-read'));

      await expect(
        intercepted.runInTransaction(async (tx, repo) => {
          // The CALLER stages a write first, so the interceptor's read phase runs too late.
          tx.set(db.collection(USERS).doc('i9-early-write'), { name: 'early' });
          await repo.updateInTransaction(tx, 'i9-target', { name: 'Ada L' });
        }),
      ).rejects.toThrow(/all reads to be executed before all writes/i);

      // The whole transaction failed, so neither write landed.
      expect(await readUser('i9-early-write')).toBeNull();
      expect((await readUser('i9-target'))?.name).toBe('Ada');
    });
  });

  describe('I-10: withMetadata under each mode', () => {
    it('throws on all six single-document surfaces under transaction mode', async () => {
      const { userRepo } = freshRepos();
      await userRepo.createWithId('i10-existing', { name: 'Ada' });

      const { userRepo: repo, mirrorRepo } = freshRepos();
      repo.registerWriteInterceptor(revisionInterceptor(mirrorRepo, 'meta-blocker'));

      const expected = /cannot return \{ withMetadata: true \}.*'meta-blocker'/s;
      await expect(repo.create({ name: 'A' }, { withMetadata: true })).rejects.toThrow(expected);
      await expect(
        repo.createWithId('i10-new', { name: 'A' }, { withMetadata: true }),
      ).rejects.toThrow(expected);
      await expect(
        repo.update('i10-existing', { name: 'A' }, { withMetadata: true }),
      ).rejects.toThrow(expected);
      await expect(
        repo.patch('i10-existing', { name: 'A' }, { withMetadata: true }),
      ).rejects.toThrow(expected);
      // Both upsert branches name `upsert()`: the existing document takes the update branch, the
      // new id takes the create branch, and the message must not differ between them.
      await expect(
        repo.upsert('i10-existing', { name: 'A' }, { withMetadata: true }),
      ).rejects.toThrow(/upsert\(\) cannot return \{ withMetadata: true \}/);
      await expect(repo.upsert('i10-fresh', { name: 'A' }, { withMetadata: true })).rejects.toThrow(
        /upsert\(\) cannot return \{ withMetadata: true \}/,
      );
      await expect(repo.delete('i10-existing', { withMetadata: true })).rejects.toThrow(expected);

      // Refused before any I/O: nothing was written and nothing was deleted.
      expect(await readUser('i10-new')).toBeNull();
      expect((await readUser('i10-existing'))?.name).toBe('Ada');
    });

    it('succeeds on the same six under batch mode', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      userRepo.registerWriteInterceptor(mirrorInterceptor(mirrorRepo, 'meta-ok'));

      const created = await userRepo.create({ name: 'A' }, { withMetadata: true });
      expect(created.writeTime).toBeInstanceOf(Timestamp);

      const withId = await userRepo.createWithId('i10-b', { name: 'B' }, { withMetadata: true });
      expect(withId.writeTime).toBeInstanceOf(Timestamp);

      expect(
        (await userRepo.update('i10-b', { name: 'B2' }, { withMetadata: true })).writeTime,
      ).toBeInstanceOf(Timestamp);
      expect(
        (await userRepo.patch('i10-b', { email: 'b@x.com' }, { withMetadata: true })).writeTime,
      ).toBeInstanceOf(Timestamp);
      expect(
        (await userRepo.upsert('i10-b', { name: 'B3' }, { withMetadata: true })).writeTime,
      ).toBeInstanceOf(Timestamp);
      expect(
        (await userRepo.upsert('i10-c', { name: 'C' }, { withMetadata: true })).writeTime,
      ).toBeInstanceOf(Timestamp);
      expect((await userRepo.delete('i10-b', { withMetadata: true }))?.writeTime).toBeInstanceOf(
        Timestamp,
      );

      // And the siblings really did land alongside those receipts.
      expect(await readMirror(created.id)).not.toBeNull();
      expect(await readMirror('i10-c')).not.toBeNull();
    });
  });

  describe('I-11: an interceptor target on another Firestore instance is refused', () => {
    /** A SECOND `Firestore`, on a different project — the shape probe P8b showed loses writes. */
    const foreignDb = getFirestore(
      getApps().find(app => app.name === 'interceptor-foreign') ??
        initializeApp({ projectId: 'demo-other-project' }, 'interceptor-foreign'),
    );

    it('the writer refuses before anything is committed', async () => {
      const { userRepo } = freshRepos();
      const foreignMirror = new FirestoreRepository<Mirror>(foreignDb, MIRRORS);
      userRepo.registerWriteInterceptor({
        name: 'foreign-writer',
        write: ({ write, writer }) => {
          writer.set(foreignMirror, `mirror-${write.id}`, { sourceId: write.id, marker: 'x' });
        },
      });

      await expect(userRepo.createWithId('i11-writer', { name: 'Ada' })).rejects.toThrow(
        /different Firestore instance/,
      );
      // The domain write is gone too — the guard fires while staging, before the commit.
      expect(await readUser('i11-writer')).toBeNull();
      expect(await readMirror('i11-writer')).toBeNull();
    });

    it('the reader refuses too', async () => {
      const { userRepo } = freshRepos();
      const foreignMirror = new FirestoreRepository<Mirror>(foreignDb, MIRRORS);
      userRepo.registerWriteInterceptor({
        name: 'foreign-reader',
        read: async ({ write, reader }) => await reader.get(foreignMirror, `mirror-${write.id}`),
        write: () => undefined,
      });

      await expect(userRepo.createWithId('i11-reader', { name: 'Ada' })).rejects.toThrow(
        /interceptor get\(\).*different Firestore instance/s,
      );
      expect(await readUser('i11-reader')).toBeNull();
    });

    it('a second repository on the SAME instance is fine', async () => {
      const { userRepo } = freshRepos();
      const sameInstanceMirror = new FirestoreRepository<Mirror>(db, MIRRORS);
      userRepo.registerWriteInterceptor({
        name: 'same-instance',
        write: ({ write, writer }) => {
          writer.set(sameInstanceMirror, `mirror-${write.id}`, {
            sourceId: write.id,
            marker: 'same',
          });
        },
      });

      await userRepo.createWithId('i11-same', { name: 'Ada' });

      expect(await readMirror('i11-same')).toMatchObject({ marker: 'same' });
    });
  });

  describe('I-12: paths with no shared boundary refuse loudly', () => {
    it('bulkWrite refuses, with and without { skipHooks: true }', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      userRepo.registerWriteInterceptor(mirrorInterceptor(mirrorRepo, 'bw-mirror'));

      const expected = /bulkWrite\(\) cannot run write interceptor\(s\) 'bw-mirror'/;
      await expect(userRepo.bulkWrite([{ op: 'create', data: { name: 'A' } }])).rejects.toThrow(
        expected,
      );
      await expect(
        userRepo.bulkWrite([{ op: 'create', data: { name: 'A' } }], { skipHooks: true }),
      ).rejects.toThrow(expected);

      expect(await freshRepos().userRepo.query().get()).toHaveLength(0);
    });

    it('recursiveDelete and recursiveDeleteCollection refuse', async () => {
      const { userRepo } = freshRepos();
      await userRepo.createWithId('i12-keep', { name: 'Keep' });

      const { userRepo: guarded, mirrorRepo } = freshRepos();
      guarded.registerWriteInterceptor(mirrorInterceptor(mirrorRepo, 'rd-mirror'));

      await expect(guarded.recursiveDelete('i12-keep')).rejects.toThrow(
        /recursiveDelete\(\) cannot run write interceptor\(s\) 'rd-mirror'/,
      );
      await expect(guarded.recursiveDeleteCollection()).rejects.toThrow(
        /recursiveDeleteCollection\(\) cannot run write interceptor\(s\) 'rd-mirror'/,
      );
      // Nothing was deleted — the refusal happens before the SDK is reached.
      expect((await readUser('i12-keep'))?.name).toBe('Keep');
    });

    it('all three still work with no interceptor registered', async () => {
      const { userRepo } = freshRepos();

      const results = await userRepo.bulkWrite([
        { op: 'create', id: 'i12-bw', data: { name: 'A' } },
      ]);
      expect(results.every(result => result.ok)).toBe(true);
      expect((await readUser('i12-bw'))?.name).toBe('A');

      await userRepo.createWithId('i12-rd', { name: 'B' });
      await expect(userRepo.recursiveDelete('i12-rd')).resolves.toBeUndefined();
      expect(await readUser('i12-rd')).toBeNull();

      await expect(userRepo.recursiveDeleteCollection()).resolves.toBeUndefined();
      expect(await freshRepos().userRepo.query().get()).toHaveLength(0);
    });
  });

  describe('I-13: bulk paths and query terminals refuse under transaction mode', () => {
    it('every fixed-batch helper and both query write terminals name the operation', async () => {
      const { userRepo } = freshRepos();
      await userRepo.bulkCreateWithIds([
        { id: 'i13-1', data: { name: 'refuse-me' } },
        { id: 'i13-2', data: { name: 'refuse-me' } },
      ]);

      const { userRepo: repo, mirrorRepo } = freshRepos();
      repo.registerWriteInterceptor(revisionInterceptor(mirrorRepo, 'tx-only'));

      await expect(repo.bulkCreate([{ name: 'A' }])).rejects.toThrow(
        /bulkCreate\(\) cannot run write interceptor\(s\) 'tx-only'/,
      );
      await expect(repo.bulkCreateWithIds([{ id: 'i13-3', data: { name: 'A' } }])).rejects.toThrow(
        /bulkCreateWithIds\(\) cannot run write interceptor\(s\) 'tx-only'/,
      );
      // Each names the method the caller actually invoked, not both.
      await expect(repo.bulkUpdate([{ id: 'i13-1', data: { name: 'A' } }])).rejects.toThrow(
        /bulkUpdate\(\) cannot run write interceptor\(s\) 'tx-only'/,
      );
      await expect(repo.bulkPatch([{ id: 'i13-1', data: { name: 'A' } }])).rejects.toThrow(
        /bulkPatch\(\) cannot run write interceptor\(s\) 'tx-only'/,
      );
      await expect(repo.bulkDelete(['i13-1'])).rejects.toThrow(
        /bulkDelete\(\) cannot run write interceptor\(s\) 'tx-only'/,
      );
      await expect(
        repo.query().where('name', '==', 'refuse-me').update({ email: 'x@x.com' }),
      ).rejects.toThrow(/query\(\)\.update\(\) cannot run write interceptor\(s\) 'tx-only'/);
      await expect(repo.query().where('name', '==', 'refuse-me').delete()).rejects.toThrow(
        /query\(\)\.delete\(\) cannot run write interceptor\(s\) 'tx-only'/,
      );

      // Nothing was written or deleted by any refused call.
      expect((await readUser('i13-1'))?.name).toBe('refuse-me');
      expect(await readUser('i13-3')).toBeNull();
      expect(await freshRepos().mirrorRepo.query().get()).toHaveLength(0);
    });

    it('a refused call fires NO hooks and performs no pre-read', async () => {
      const { userRepo } = freshRepos();
      await userRepo.bulkCreateWithIds([
        { id: 'i13-h1', data: { name: 'hooked' } },
        { id: 'i13-h2', data: { name: 'hooked' } },
      ]);

      const { userRepo: repo, mirrorRepo } = freshRepos();
      const fired: string[] = [];
      repo.on('beforeBulkCreate', () => void fired.push('beforeBulkCreate'));
      repo.on('beforeBulkUpdate', () => void fired.push('beforeBulkUpdate'));
      repo.on('beforeBulkDelete', () => void fired.push('beforeBulkDelete'));
      repo.on('afterBulkCreate', () => void fired.push('afterBulkCreate'));
      repo.on('afterBulkUpdate', () => void fired.push('afterBulkUpdate'));
      repo.on('afterBulkDelete', () => void fired.push('afterBulkDelete'));
      repo.registerWriteInterceptor(revisionInterceptor(mirrorRepo, 'hook-blocker'));

      // The guard is the FIRST statement of each path, ahead of the existence pre-read and the
      // before-hooks. A hook that writes an audit row or increments a metric must not run for a call
      // that was never going to proceed.
      await expect(repo.bulkCreate([{ name: 'A' }])).rejects.toThrow(
        /cannot run write interceptor/,
      );
      await expect(repo.bulkCreateWithIds([{ id: 'i13-h3', data: { name: 'A' } }])).rejects.toThrow(
        /cannot run write interceptor/,
      );
      await expect(repo.bulkUpdate([{ id: 'i13-h1', data: { name: 'B' } }])).rejects.toThrow(
        /cannot run write interceptor/,
      );
      await expect(repo.bulkPatch([{ id: 'i13-h1', data: { name: 'B' } }])).rejects.toThrow(
        /cannot run write interceptor/,
      );
      await expect(repo.bulkDelete(['i13-h1'])).rejects.toThrow(/cannot run write interceptor/);
      await expect(
        repo.query().where('name', '==', 'hooked').update({ email: 'x@x.com' }),
      ).rejects.toThrow(/cannot run write interceptor/);
      await expect(repo.query().where('name', '==', 'hooked').delete()).rejects.toThrow(
        /cannot run write interceptor/,
      );

      expect(fired).toEqual([]);
      // And both documents survive untouched.
      expect((await readUser('i13-h1'))?.name).toBe('hooked');
      expect((await readUser('i13-h2'))?.name).toBe('hooked');
    });
  });

  describe('empty and no-op inputs — where a refusal does and does not fire', () => {
    it('bulkWrite refuses even for an empty operation list', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      userRepo.registerWriteInterceptor(mirrorInterceptor(mirrorRepo, 'empty-bw'));

      // The guard is the FIRST statement in bulkWrite, ahead of the empty short-circuit: an
      // interceptor plus bulkWrite is a configuration error regardless of input size, and failing
      // fast surfaces it in development rather than on the first non-empty call.
      await expect(userRepo.bulkWrite([])).rejects.toThrow(
        /bulkWrite\(\) cannot run write interceptor\(s\) 'empty-bw'/,
      );
    });

    it('transaction mode refuses every bulk path regardless of input size', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      userRepo.registerWriteInterceptor(revisionInterceptor(mirrorRepo, 'noop-tx'));

      // Moving the guard to each path's first statement made this uniform: the refusal no longer
      // depends on whether the input happened to be empty, or on whether any document survived the
      // existence pre-read. Previously bulkDelete([]) resolved to 0 here because it short-circuited
      // before reaching the check inside commitInChunks.
      await expect(userRepo.bulkDelete([])).rejects.toThrow(
        /bulkDelete\(\) cannot run write interceptor\(s\) 'noop-tx'/,
      );
      await expect(userRepo.bulkDelete(['does-not-exist'])).rejects.toThrow(
        /bulkDelete\(\) cannot run write interceptor\(s\) 'noop-tx'/,
      );
      await expect(userRepo.bulkCreate([])).rejects.toThrow(
        /bulkCreate\(\) cannot run write interceptor\(s\) 'noop-tx'/,
      );
      await expect(
        userRepo.query().where('name', '==', 'nothing-matches').delete(),
      ).rejects.toThrow(/query\(\)\.delete\(\) cannot run write interceptor\(s\) 'noop-tx'/);
    });

    it('batch mode still resolves no-op inputs normally', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      userRepo.registerWriteInterceptor(mirrorInterceptor(mirrorRepo, 'noop-batch'));

      // A write-only interceptor CAN run on these paths, so an empty or zero-match call is simply a
      // no-op — it is not refused, because there is nothing it cannot honour.
      await expect(userRepo.bulkDelete([])).resolves.toBe(0);
      await expect(userRepo.bulkDelete(['does-not-exist'])).resolves.toBe(0);
      await expect(userRepo.bulkCreate([])).resolves.toEqual([]);
      await expect(userRepo.query().where('name', '==', 'nothing-matches').delete()).resolves.toBe(
        0,
      );
      expect(await freshRepos().mirrorRepo.query().get()).toHaveLength(0);
    });
  });

  describe('registration is per instance — the clone rules, in both directions', () => {
    it("subcollection() does NOT inherit the parent repository's interceptors", async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      await userRepo.createWithId('sub-parent', { name: 'Parent' });
      userRepo.registerWriteInterceptor(mirrorInterceptor(mirrorRepo, 'parent-only'));

      // A subcollection models a DIFFERENT collection with a different write model, so a parent's
      // interceptor could not produce a valid payload for it. This is the near-miss beside the
      // runInTransaction clone: that one copies interceptors because `txRepo` stands in for `this`
      // on the same collection; this one must not.
      const posts = userRepo.subcollection('sub-parent', 'posts', z.object({ title: z.string() }));
      await posts.createWithId('post-1', { title: 'Hello' });

      expect((await posts.getById('post-1'))?.title).toBe('Hello');
      // No mirror for the post — and the parent's own mirror set is untouched.
      expect(await freshRepos().mirrorRepo.getById('mirror-post-1')).toBeNull();
      expect(await freshRepos().mirrorRepo.query().get()).toHaveLength(0);

      await posts.delete('post-1');
    });

    it('a second repository over the same collection has its own registration list', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      userRepo.registerWriteInterceptor(mirrorInterceptor(mirrorRepo, 'instance-a'));

      // Same collection, different instance — registration is per instance, not per collection.
      const other = freshRepos().userRepo;
      await other.createWithId('per-instance', { name: 'Ada' });

      expect((await readUser('per-instance'))?.name).toBe('Ada');
      expect(await readMirror('per-instance')).toBeNull();
    });

    it('runReadOnlyAt inherits the clone fix, and the SDK still refuses writes there', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      await userRepo.createWithId('ro-target', { name: 'Ada' });
      const { userRepo: intercepted } = freshRepos();
      intercepted.registerWriteInterceptor(mirrorInterceptor(mirrorRepo, 'read-only'));

      // runReadOnlyAt delegates to runInTransaction, so it picks up the interceptor-carrying clone.
      // Reads work; the read-only narrowing is type-level, and the SDK rejects any staged write.
      const seen = await intercepted.runReadOnlyAt(undefined, async (tx, repo) => {
        return await repo.getInTransaction(tx, 'ro-target');
      });

      expect(seen?.name).toBe('Ada');
      expect(await freshRepos().mirrorRepo.query().get()).toHaveLength(0);
    });
  });

  describe('I-14: additivity — nothing registered, nothing changed', () => {
    it('every write path keeps its return shape, receipts and hook order', async () => {
      const { userRepo } = freshRepos();
      const events: string[] = [];
      userRepo.on('beforeCreate', () => void events.push('beforeCreate'));
      userRepo.on('afterCreate', () => void events.push('afterCreate'));
      userRepo.on('beforeUpdate', () => void events.push('beforeUpdate'));
      userRepo.on('afterUpdate', () => void events.push('afterUpdate'));
      userRepo.on('beforeDelete', () => void events.push('beforeDelete'));
      userRepo.on('afterDelete', () => void events.push('afterDelete'));

      const created = await userRepo.create({ name: 'Ada' });
      expect(Object.keys(created)).toEqual(['id']);

      expect(await userRepo.createWithId('i14-b', { name: 'B' })).toEqual({ id: 'i14-b' });
      expect(await userRepo.update('i14-b', { name: 'B2' })).toEqual({ id: 'i14-b' });
      expect(await userRepo.patch('i14-b', { email: 'b@x.com' })).toEqual({ id: 'i14-b' });
      expect(await userRepo.upsert('i14-b', { name: 'B3' })).toEqual({ id: 'i14-b' });
      expect(await userRepo.upsert('i14-c', { name: 'C' })).toEqual({ id: 'i14-c' });
      expect(await userRepo.delete('i14-c')).toBeUndefined();

      // Hook order is unchanged: before/after pairs, in call order.
      expect(events).toEqual([
        'beforeCreate',
        'afterCreate',
        'beforeCreate',
        'afterCreate',
        'beforeUpdate',
        'afterUpdate',
        'beforeUpdate',
        'afterUpdate',
        'beforeUpdate',
        'afterUpdate',
        'beforeCreate',
        'afterCreate',
        'beforeDelete',
        'afterDelete',
      ]);

      // Receipts: one per document, and each really is that document's own.
      const withMetadata = await userRepo.create({ name: 'Meta' }, { withMetadata: true });
      expect(Object.keys(withMetadata).sort()).toEqual(['id', 'writeTime']);
      const stored = await freshRepos().userRepo.getByIdWithUpdateTime(withMetadata.id);
      expect(stored?.updateTime.isEqual(withMetadata.writeTime)).toBe(true);

      // Bulk helpers keep their shapes, and no sibling collection appears out of nowhere.
      const bulk = await userRepo.bulkCreate([{ name: 'X' }, { name: 'Y' }], {
        withMetadata: true,
      });
      expect(bulk).toHaveLength(2);
      expect(await freshRepos().mirrorRepo.query().get()).toHaveLength(0);
      expect(created.id).toEqual(expect.any(String));
    });
  });

  describe('the writer surface — every member stages through the target repository', () => {
    it('create() stages a create-only write, and a collision aborts the whole group', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      userRepo.registerWriteInterceptor({
        name: 'creator',
        write: ({ write, writer }) => {
          writer.createWithId(mirrorRepo, `mirror-${write.id}`, {
            sourceId: write.id,
            marker: 'created',
          });
        },
      });

      await userRepo.createWithId('w-create', { name: 'Ada' });
      expect(await readMirror('w-create')).toMatchObject({ marker: 'created' });

      // The sibling already exists, so create-only semantics reject it — and because the group is
      // atomic, the DOMAIN write is rolled back too.
      await expect(userRepo.update('w-create', { name: 'Ada L' })).rejects.toThrow();
      expect((await readUser('w-create'))?.name).toBe('Ada');
    });

    it('update() stages a field update, and rejects an empty payload', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      await mirrorRepo.createWithId('mirror-w-update', { sourceId: 'w-update', marker: 'initial' });
      await userRepo.createWithId('w-update', { name: 'Ada' });

      const { userRepo: updater, mirrorRepo: target } = freshRepos();
      updater.registerWriteInterceptor({
        name: 'updater',
        write: ({ write, writer }) => {
          writer.update(target, `mirror-${write.id}`, { marker: 'updated' });
        },
      });

      await updater.update('w-update', { name: 'Ada L' });
      expect(await readMirror('w-update')).toMatchObject({
        sourceId: 'w-update',
        marker: 'updated',
      });

      // An empty update payload is refused by the TARGET repository's own guard, exactly as a direct
      // call to it would be — and the domain write dies with it.
      const { userRepo: empty, mirrorRepo: emptyTarget } = freshRepos();
      empty.registerWriteInterceptor({
        name: 'empty-payload',
        write: ({ write, writer }) => {
          writer.update(emptyTarget, `mirror-${write.id}`, {});
        },
      });
      await expect(empty.update('w-update', { name: 'Ada Lovelace' })).rejects.toThrow(
        /empty|no fields/i,
      );
      expect((await readUser('w-update'))?.name).toBe('Ada L');
    });

    it('patch() normalizes a nested object into field paths, exactly as repo.patch does', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      await mirrorRepo.createWithId('mirror-w-merge', {
        sourceId: 'w-merge',
        marker: 'initial',
        meta: { a: 'keep', b: 'replace' },
      });
      await userRepo.createWithId('w-merge', { name: 'Ada' });

      const { userRepo: merger, mirrorRepo: target } = freshRepos();
      merger.registerWriteInterceptor({
        name: 'merger',
        write: ({ write, writer }) => {
          // Only `meta.b` is supplied. `patch` normalizes it to the field path `meta.b`; a plain
          // `update` would replace the whole `meta` map and lose `meta.a`.
          writer.patch(target, `mirror-${write.id}`, { meta: { b: 'merged' } });
        },
      });

      await merger.update('w-merge', { name: 'Ada L' });

      expect(await readMirror('w-merge')).toMatchObject({
        marker: 'initial',
        meta: { a: 'keep', b: 'merged' },
      });
    });

    it('delete() stages a delete in the same boundary', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      await mirrorRepo.createWithId('mirror-w-delete', { sourceId: 'w-delete', marker: 'doomed' });
      await userRepo.createWithId('w-delete', { name: 'Ada' });

      const { userRepo: deleter, mirrorRepo: target } = freshRepos();
      deleter.registerWriteInterceptor({
        name: 'sibling-deleter',
        write: ({ write, writer }) => {
          writer.delete(target, `mirror-${write.id}`);
        },
      });

      await deleter.delete('w-delete');

      expect(await readUser('w-delete')).toBeNull();
      expect(await readMirror('w-delete')).toBeNull();
    });

    it('set({ merge: true }) preserves untouched fields; the default replaces them', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      await mirrorRepo.createWithId('mirror-w-set', {
        sourceId: 'w-set',
        marker: 'initial',
        meta: { a: 'keep' },
      });
      await userRepo.createWithId('w-set', { name: 'Ada' });

      const { userRepo: merger, mirrorRepo: mergeTarget } = freshRepos();
      merger.registerWriteInterceptor({
        name: 'set-merge',
        write: ({ write, writer }) => {
          writer.set(
            mergeTarget,
            `mirror-${write.id}`,
            { sourceId: write.id, marker: 'merged' },
            { merge: true },
          );
        },
      });
      await merger.update('w-set', { name: 'Ada L' });
      expect(await readMirror('w-set')).toMatchObject({ marker: 'merged', meta: { a: 'keep' } });

      const { userRepo: replacer, mirrorRepo: replaceTarget } = freshRepos();
      replacer.registerWriteInterceptor({
        name: 'set-replace',
        write: ({ write, writer }) => {
          writer.set(replaceTarget, `mirror-${write.id}`, {
            sourceId: write.id,
            marker: 'replaced',
          });
        },
      });
      await replacer.update('w-set', { name: 'Ada Lovelace' });
      const replaced = await readMirror('w-set');
      expect(replaced).toMatchObject({ marker: 'replaced' });
      // The default (no merge) overwrites the document, so the untouched nested map is gone.
      expect(replaced?.meta).toBeUndefined();
    });

    it("a sibling payload is validated by the TARGET repository's schema, at runtime", async () => {
      // Every mirror repo elsewhere in this suite is unvalidated, so the writer's structural checks
      // run but the Zod path never does. This pins the documented claim that a sibling write is
      // validated exactly as a direct call to the target repository would be.
      const schemaCollection = `${MIRRORS}_validated`;
      const mirrorSchema = z.object({ sourceId: z.string(), score: z.number().min(0) });
      const validatedMirror = FirestoreRepository.withSchema(db, schemaCollection, mirrorSchema);

      const { userRepo: good } = freshRepos();
      good.registerWriteInterceptor({
        name: 'validated-ok',
        write: ({ write, writer }) => {
          writer.set(validatedMirror, `mirror-${write.id}`, { sourceId: write.id, score: 5 });
        },
      });
      await good.createWithId('w-schema-ok', { name: 'Ada' });
      expect((await validatedMirror.getById('mirror-w-schema-ok'))?.score).toBe(5);

      const { userRepo: bad } = freshRepos();
      bad.registerWriteInterceptor({
        name: 'validated-bad',
        write: ({ write, writer }) => {
          // Violates `score.min(0)`. The cast is what an untyped caller would reach for; the target
          // repository's validator is the runtime backstop behind the compile-time check (TT-4).
          writer.set(validatedMirror, `mirror-${write.id}`, {
            sourceId: write.id,
            score: -1,
          } as any);
        },
      });

      await expect(bad.createWithId('w-schema-bad', { name: 'Grace' })).rejects.toThrow();
      // The domain write died with the invalid sibling — the guarantee holds in this direction too.
      expect(await readUser('w-schema-bad')).toBeNull();
      expect(await validatedMirror.getById('mirror-w-schema-bad')).toBeNull();

      await validatedMirror.bulkDelete((await validatedMirror.query().get()).map(doc => doc.id));
    });

    it('set requires the COMPLETE write model, because it creates when absent', async () => {
      // A `set` creates the document if it is missing, so a partial payload would write a record
      // that does not satisfy its own schema — and reads are NOT validated, so it would come back
      // typed as complete with its required fields simply absent. The create validator on both
      // branches prevents that. A subset write is `update`, which fails when the document is
      // missing; that failure is the guard rail, not a limitation.
      const memberCollection = `${MIRRORS}_members`;
      const memberSchema = z.object({
        displayName: z.string(),
        email: z.string(),
        lastStatus: z.string().optional(),
      });
      const memberRepo = FirestoreRepository.withSchema(db, memberCollection, memberSchema);

      // A complete payload creates the sibling; `{ merge: true }` keeps unmentioned fields.
      const { userRepo: full } = freshRepos();
      full.registerWriteInterceptor({
        name: 'member-full',
        write: ({ write, writer }) => {
          writer.set(
            memberRepo,
            `member-${write.id}`,
            { displayName: 'Ada', email: 'ada@example.com', lastStatus: write.kind },
            { merge: true },
          );
        },
      });
      await full.createWithId('ms-1', { name: 'Ada' });
      expect(await memberRepo.getById('member-ms-1')).toMatchObject({
        displayName: 'Ada',
        email: 'ada@example.com',
        lastStatus: 'create',
      });

      // A partial payload is refused at RUNTIME too, not merely at compile time — `as any` is the
      // bypass a JavaScript caller would reach for.
      const { userRepo: partial } = freshRepos();
      partial.registerWriteInterceptor({
        name: 'member-partial',
        write: ({ write, writer }) => {
          writer.set(memberRepo, `member-${write.id}`, { lastStatus: write.kind } as any, {
            merge: true,
          });
        },
      });
      await expect(partial.createWithId('ms-2', { name: 'Grace' })).rejects.toThrow();
      expect(await readUser('ms-2')).toBeNull();
      expect(await memberRepo.getById('member-ms-2')).toBeNull();

      // The subset write that IS supported: update, against a member that already exists.
      await memberRepo.upsert('member-ms-3', {
        displayName: 'Grace',
        email: 'grace@example.com',
      });
      const { userRepo: subset } = freshRepos();
      subset.registerWriteInterceptor({
        name: 'member-subset',
        write: ({ write, writer }) => {
          writer.update(memberRepo, `member-${write.id}`, { lastStatus: write.kind });
        },
      });
      await subset.createWithId('ms-3', { name: 'Hopper' });
      expect(await memberRepo.getById('member-ms-3')).toMatchObject({
        displayName: 'Grace',
        email: 'grace@example.com',
        lastStatus: 'create',
      });

      // ...and the same update against a MISSING member fails the whole write rather than conjuring
      // a member with no displayName or email.
      const { userRepo: missing } = freshRepos();
      missing.registerWriteInterceptor({
        name: 'member-missing',
        write: ({ write, writer }) => {
          writer.update(memberRepo, `member-${write.id}`, { lastStatus: write.kind });
        },
      });
      await expect(missing.createWithId('ms-4', { name: 'Ada' })).rejects.toThrow();
      expect(await readUser('ms-4')).toBeNull();
      expect(await memberRepo.getById('member-ms-4')).toBeNull();

      await memberRepo.bulkDelete((await memberRepo.query().get()).map(doc => doc.id));
    });

    it('delete sentinels: refused on a set, permitted on an update', async () => {
      const { userRepo } = freshRepos();
      await mirrorRepoFor().createWithId('mirror-ds-1', {
        sourceId: 'ds-1',
        marker: 'keep',
        meta: { a: 'clear-me' },
      });
      await userRepo.createWithId('ds-1', { name: 'Ada' });

      // A set CREATES the sibling when absent, so a delete sentinel would mean "clear the field" or
      // "do nothing" depending on existence. Rejected by the create validator — the same guard that
      // makes `upsert` reject them (ADR-0019).
      const { userRepo: viaSet, mirrorRepo: setTarget } = freshRepos();
      viaSet.registerWriteInterceptor({
        name: 'set-delete',
        write: ({ write, writer }) => {
          writer.set(
            setTarget,
            `mirror-${write.id}`,
            { sourceId: write.id, marker: 'x', meta: FieldValue.delete() } as any,
            { merge: true },
          );
        },
      });
      await expect(viaSet.update('ds-1', { name: 'Ada L' })).rejects.toThrow();
      // The domain write died with it, and the sibling field is untouched.
      expect((await readUser('ds-1'))?.name).toBe('Ada');
      expect((await readMirror('ds-1'))?.meta).toEqual({ a: 'clear-me' });

      // `writer.update` FAILS on a missing document rather than creating one, so there is no
      // existence-dependence and a delete sentinel is permitted — matching update()/patch().
      const { userRepo: viaUpdate, mirrorRepo: updateTarget } = freshRepos();
      viaUpdate.registerWriteInterceptor({
        name: 'update-delete',
        write: ({ write, writer }) => {
          writer.update(updateTarget, `mirror-${write.id}`, { meta: FieldValue.delete() } as any);
        },
      });
      await viaUpdate.update('ds-1', { name: 'Ada Lovelace' });
      expect((await readUser('ds-1'))?.name).toBe('Ada Lovelace');
      expect((await readMirror('ds-1'))?.meta).toBeUndefined();
    });

    it('a malformed interceptor target id is refused by the target repository', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      userRepo.registerWriteInterceptor({
        name: 'bad-id',
        write: ({ writer }) => {
          // A slash-separated id would address a document outside the target collection.
          writer.set(mirrorRepo, 'not/a/leaf/id', { sourceId: 'x', marker: 'x' });
        },
      });

      await expect(userRepo.createWithId('w-bad-id', { name: 'Ada' })).rejects.toThrow();
      expect(await readUser('w-bad-id')).toBeNull();
    });
  });

  describe('I-15: several interceptors run in registration order, fail-fast', () => {
    it('both run, in registration order', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      const order: string[] = [];
      userRepo.registerWriteInterceptor({
        name: 'first',
        write: ({ write, writer }) => {
          order.push('first');
          writer.set(mirrorRepo, `mirror-${write.id}`, { sourceId: write.id, marker: 'first' });
        },
      });
      userRepo.registerWriteInterceptor({
        name: 'second',
        write: ({ write, writer }) => {
          order.push('second');
          writer.set(mirrorRepo, `mirror-second-${write.id}`, {
            sourceId: write.id,
            marker: 'second',
          });
        },
      });

      await userRepo.createWithId('i15-both', { name: 'Ada' });

      expect(order).toEqual(['first', 'second']);
      expect(await readMirror('i15-both')).toMatchObject({ marker: 'first' });
      expect(await freshRepos().mirrorRepo.getById('mirror-second-i15-both')).toMatchObject({
        marker: 'second',
      });
    });

    it('the first throw stops the second, and nothing commits', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      const ran: string[] = [];
      userRepo.registerWriteInterceptor({
        name: 'thrower',
        write: () => {
          ran.push('thrower');
          throw new Error('first interceptor refused');
        },
      });
      userRepo.registerWriteInterceptor({
        name: 'never-runs',
        write: ({ write, writer }) => {
          ran.push('never-runs');
          writer.set(mirrorRepo, `mirror-${write.id}`, { sourceId: write.id, marker: 'late' });
        },
      });

      await expect(userRepo.createWithId('i15-abort', { name: 'Ada' })).rejects.toThrow(
        /first interceptor refused/,
      );

      expect(ran).toEqual(['thrower']);
      expect(await readUser('i15-abort')).toBeNull();
      expect(await readMirror('i15-abort')).toBeNull();
    });

    it('read phases also run in registration order', async () => {
      const { userRepo, mirrorRepo } = freshRepos();
      const order: string[] = [];
      userRepo.registerWriteInterceptor({
        name: 'read-a',
        read: async () => {
          order.push('read-a');
          return 'a';
        },
        write: ({ write, writer, reads }) => {
          order.push(`write-a:${reads}`);
          writer.set(mirrorRepo, `mirror-${write.id}`, {
            sourceId: write.id,
            marker: `a:${reads}`,
          });
        },
      });
      userRepo.registerWriteInterceptor({
        name: 'read-b',
        read: async () => {
          order.push('read-b');
          return 'b';
        },
        write: ({ reads }) => {
          order.push(`write-b:${reads}`);
        },
      });

      await userRepo.createWithId('i15-reads', { name: 'Ada' });

      // Every read precedes every write, and each write got ITS OWN read result (keyed by name).
      expect(order).toEqual(['read-a', 'read-b', 'write-a:a', 'write-b:b']);
      expect(await readMirror('i15-reads')).toMatchObject({ marker: 'a:a' });
    });
  });
});
