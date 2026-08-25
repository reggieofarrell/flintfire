/**
 * Strategy: unit coverage for the write-interceptor DECISION logic (issue #108 / ADR-0040) — the
 * parts that are observable at the mocked Firestore boundary and need no emulator.
 *
 * What lives here (plan §8.3) versus in the emulator suite: this file pins WHICH boundary the ORM
 * opens and WHICH guards fire, by spying `db.batch()` / `db.runTransaction()` / `docRef.*`. Whether
 * the sibling write actually lands atomically is a real-Firestore question and is owned by
 * `repository-write-interceptors.integration.test.ts`.
 *
 *   - U-1: the mode is a UNION over registrations — none / write-only-only / any read-capable,
 *     including when a write-only interceptor was registered first.
 *   - U-2: additivity (ADR-0040 Decision 8) — with nothing registered, writes call `docRef.*`
 *     directly and neither `db.batch()` nor `db.runTransaction()` is ever touched.
 *   - U-3: a duplicate interceptor `name` is refused at registration (read results are keyed by it).
 *   - U-4: a single group larger than one whole batch throws, naming the operation.
 *   - U-5: `{ withMetadata: true }` throws under transaction mode only, naming only the
 *     read-capable interceptor(s) that forced the mode.
 *   - U-6: the three unsupported paths refuse, naming the operation and every interceptor — and
 *     `bulkWrite` refuses even with `{ skipHooks: true }`, because a guarantee cannot be waived.
 */
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { WriteOutcomeError } from '../../core/Errors.js';

interface TestUser {
  name: string;
}

interface Sibling {
  marker: string;
}

/** A `Timestamp`-shaped token: the mocked boundary never calls the Admin SDK. */
const fakeWriteTime = {
  seconds: 1700000000,
  nanoseconds: 0,
} as unknown as FirebaseFirestore.Timestamp;

/**
 * Builds a repository pair over a fully spied Firestore boundary.
 *
 * `batch.commit()` returns one receipt per staged operation so `commitInChunks`' positional
 * domain-receipt projection is exercised for real rather than short-circuited by an empty array.
 */
function createHarness() {
  const docRefs = new Map<string, any>();
  const makeDocRef = (id: string) => {
    if (!docRefs.has(id)) {
      docRefs.set(id, {
        id,
        get: jest.fn().mockResolvedValue({
          exists: true,
          id,
          data: () => ({ name: 'Ada' }),
          updateTime: fakeWriteTime,
        }),
        create: jest.fn().mockResolvedValue({ writeTime: fakeWriteTime }),
        set: jest.fn().mockResolvedValue({ writeTime: fakeWriteTime }),
        update: jest.fn().mockResolvedValue({ writeTime: fakeWriteTime }),
        delete: jest.fn().mockResolvedValue({ writeTime: fakeWriteTime }),
      });
    }
    return docRefs.get(id);
  };

  const collectionRef = {
    withConverter: jest.fn(),
    doc: jest.fn((id?: string) => makeDocRef(id ?? 'auto-id')),
  };

  // Every staged op is recorded with a LABEL, and commit() returns one receipt per op carrying that
  // label as its `writeTime`. Real receipts are indistinguishable within a batch (every write in one
  // commit shares a timestamp), so this is the only place the domain-receipt PROJECTION — which
  // document each returned receipt actually belongs to — can be observed at all.
  const stagedOps: string[] = [];
  const batch = {
    create: jest.fn((ref: any) => void stagedOps.push(`create:${ref.id}`)),
    set: jest.fn((ref: any) => void stagedOps.push(`set:${ref.id}`)),
    update: jest.fn((ref: any) => void stagedOps.push(`update:${ref.id}`)),
    delete: jest.fn((ref: any) => void stagedOps.push(`delete:${ref.id}`)),
    commit: jest.fn(async () => {
      const receipts = stagedOps.map(label => ({
        writeTime: label as unknown as typeof fakeWriteTime,
      }));
      stagedOps.length = 0;
      return receipts;
    }),
  };

  const tx = {
    get: jest.fn(async (ref: any) => ({
      exists: true,
      id: ref?.id ?? 'doc-1',
      data: () => ({ name: 'Ada' }),
      updateTime: fakeWriteTime,
    })),
    create: jest.fn(),
    set: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  const db: any = {
    collection: jest.fn(() => collectionRef),
    batch: jest.fn(() => batch),
    runTransaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => await fn(tx)),
    getAll: jest.fn(async (...refs: any[]) =>
      Promise.all(refs.filter(ref => typeof ref?.get === 'function').map(ref => ref.get())),
    ),
    bulkWriter: jest.fn(() => {
      throw new Error('db.bulkWriter() must not be reached when an interceptor is registered');
    }),
    recursiveDelete: jest.fn(async () => undefined),
  };

  const repo = new FirestoreRepository<TestUser>(db, 'users');
  const siblingRepo = new FirestoreRepository<Sibling>(db, 'siblings');

  /** A write-only interceptor that mirrors every write into `siblings`. */
  const writeOnly = (name: string) => ({
    name,
    write: ({ write, writer }: any) => {
      writer.set(siblingRepo, `mirror-${write.id}`, { marker: name });
    },
  });

  /** A read-capable interceptor — registering one promotes the repository to transaction mode. */
  const readCapable = (name: string) => ({
    name,
    read: async ({ write, reader }: any) => await reader.get(siblingRepo, `mirror-${write.id}`),
    write: ({ write, writer }: any) => {
      writer.set(siblingRepo, `mirror-${write.id}`, { marker: name });
    },
  });

  /** An interceptor whose write phase stages `count` writes — 0 and 2 are the interesting ones. */
  const stagesExactly = (name: string, count: number) => ({
    name,
    write: ({ write, writer }: any) => {
      for (let index = 0; index < count; index++) {
        writer.set(siblingRepo, `${name}-${index}-${write.id}`, { marker: name });
      }
    },
  });

  return {
    repo,
    siblingRepo,
    db,
    batch,
    tx,
    collectionRef,
    getDocRef: makeDocRef,
    writeOnly,
    readCapable,
    stagesExactly,
  };
}

describe('write interceptors — mode resolution (U-1)', () => {
  it("stays 'none' with nothing registered: no batch, no transaction", async () => {
    const { repo, db, getDocRef } = createHarness();

    await repo.create({ name: 'Ada' });

    expect(getDocRef('auto-id').set).toHaveBeenCalledTimes(1);
    expect(db.batch).not.toHaveBeenCalled();
    expect(db.runTransaction).not.toHaveBeenCalled();
  });

  it("resolves to 'batch' when only write-only interceptors are registered", async () => {
    const { repo, db, batch, writeOnly } = createHarness();
    repo.registerWriteInterceptor(writeOnly('mirror-a'));
    repo.registerWriteInterceptor(writeOnly('mirror-b'));

    await repo.create({ name: 'Ada' });

    expect(db.batch).toHaveBeenCalledTimes(1);
    expect(db.runTransaction).not.toHaveBeenCalled();
    // One domain write + one per interceptor, all in the same batch.
    expect(batch.set).toHaveBeenCalledTimes(3);
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });

  it("resolves to 'transaction' as soon as ANY registration declares a read phase", async () => {
    const { repo, db, tx, writeOnly, readCapable } = createHarness();
    // Write-only FIRST: the mode is a union over registrations, not "whatever registered last".
    repo.registerWriteInterceptor(writeOnly('mirror-a'));
    repo.registerWriteInterceptor(readCapable('audit'));

    await repo.create({ name: 'Ada' });

    expect(db.runTransaction).toHaveBeenCalledTimes(1);
    expect(db.batch).not.toHaveBeenCalled();
    // The read phase ran before any write was staged, and both interceptors staged their write.
    expect(tx.get).toHaveBeenCalledTimes(1);
    expect(tx.set).toHaveBeenCalledTimes(3);
    expect(tx.get.mock.invocationCallOrder[0]).toBeLessThan(tx.set.mock.invocationCallOrder[0]!);
  });
});

describe('write interceptors — additivity with none registered (U-2)', () => {
  it('create / update / delete call docRef.* directly and open no boundary', async () => {
    const { repo, db, getDocRef } = createHarness();

    await repo.create({ name: 'Ada' });
    await repo.update('user-1', { name: 'Grace' });
    await repo.delete('user-1');

    expect(getDocRef('auto-id').set).toHaveBeenCalledTimes(1);
    expect(getDocRef('user-1').update).toHaveBeenCalledTimes(1);
    expect(getDocRef('user-1').delete).toHaveBeenCalledTimes(1);
    expect(db.batch).not.toHaveBeenCalled();
    expect(db.runTransaction).not.toHaveBeenCalled();
  });

  it('createWithId and upsert both branches stay direct', async () => {
    const { repo, db, getDocRef, collectionRef } = createHarness();

    await repo.createWithId('user-1', { name: 'Ada' });
    // Existing document → upsert takes the update branch.
    await repo.upsert('user-1', { name: 'Grace' });
    // Missing document → upsert takes the create branch.
    const missing = makeMissingDocRef(collectionRef, 'user-new');
    await repo.upsert('user-new', { name: 'Hopper' });

    expect(getDocRef('user-1').create).toHaveBeenCalledTimes(1);
    expect(getDocRef('user-1').update).toHaveBeenCalledTimes(1);
    expect(missing.set).toHaveBeenCalledTimes(1);
    expect(db.batch).not.toHaveBeenCalled();
    expect(db.runTransaction).not.toHaveBeenCalled();
  });
});

/**
 * Replaces one id's stub with a NOT-FOUND document so `upsert` takes its create branch, and returns
 * the stub so the test can assert on it.
 */
function makeMissingDocRef(collectionRef: { doc: jest.Mock }, id: string) {
  const ref: any = {
    id,
    get: jest.fn().mockResolvedValue({ exists: false, id, data: () => undefined }),
    create: jest.fn().mockResolvedValue({ writeTime: fakeWriteTime }),
    set: jest.fn().mockResolvedValue({ writeTime: fakeWriteTime }),
    update: jest.fn().mockResolvedValue({ writeTime: fakeWriteTime }),
    delete: jest.fn().mockResolvedValue({ writeTime: fakeWriteTime }),
  };
  const previous = collectionRef.doc.getMockImplementation()!;
  collectionRef.doc.mockImplementation((docId?: string) => (docId === id ? ref : previous(docId)));
  return ref;
}

describe('write interceptors — registration (U-3)', () => {
  it('refuses a duplicate name, naming it', () => {
    const { repo, writeOnly } = createHarness();
    repo.registerWriteInterceptor(writeOnly('mirror'));

    expect(() => repo.registerWriteInterceptor(writeOnly('mirror'))).toThrow(
      /write interceptor named 'mirror' is already registered/i,
    );
    // The message says WHY uniqueness matters, so the caller knows it is not an arbitrary rule.
    expect(() => repo.registerWriteInterceptor(writeOnly('mirror'))).toThrow(
      /key their read-phase results/i,
    );
  });

  it('refuses a duplicate across flavours (a read phase does not make a name distinct)', () => {
    const { repo, writeOnly, readCapable } = createHarness();
    repo.registerWriteInterceptor(writeOnly('audit'));

    expect(() => repo.registerWriteInterceptor(readCapable('audit'))).toThrow(
      /already registered/i,
    );
  });

  it('keeps distinct names, and keeps registration order', async () => {
    const { repo, batch } = createHarness();
    const order: string[] = [];
    repo.registerWriteInterceptor({ name: 'first', write: () => void order.push('first') });
    repo.registerWriteInterceptor({ name: 'second', write: () => void order.push('second') });

    await repo.create({ name: 'Ada' });

    expect(order).toEqual(['first', 'second']);
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });
});

describe('write interceptors — an oversized group cannot be staged (U-4)', () => {
  it('throws when one document plus its interceptor writes exceeds a whole batch', async () => {
    const { repo, batch, siblingRepo } = createHarness();
    // 500 interceptors → group size 501, which can never fit in a 500-operation batch.
    for (let index = 0; index < 500; index++) {
      repo.registerWriteInterceptor({
        name: `mirror-${index}`,
        write: ({ write, writer }) => {
          writer.set(siblingRepo, `mirror-${index}-${write.id}`, { marker: 'x' });
        },
      });
    }

    await expect(repo.bulkCreate([{ name: 'Ada' }])).rejects.toThrow(
      /bulkCreate\(\) cannot stage 501 writes for one document atomically/,
    );
    // Refused BEFORE anything was committed — not split across two batches.
    expect(batch.commit).not.toHaveBeenCalled();
  });

  it('names the single-document operation when the oversized group is a direct write', async () => {
    const { repo, siblingRepo } = createHarness();
    for (let index = 0; index < 500; index++) {
      repo.registerWriteInterceptor({
        name: `mirror-${index}`,
        write: ({ write, writer }) => {
          writer.set(siblingRepo, `mirror-${index}-${write.id}`, { marker: 'x' });
        },
      });
    }

    await expect(repo.create({ name: 'Ada' })).rejects.toThrow(
      /create\(\) cannot stage 501 writes for one document atomically/,
    );
  });

  it('accepts a group that exactly fills a batch', async () => {
    const { repo, batch, siblingRepo } = createHarness();
    // 499 interceptors → group size 500, the largest that fits.
    for (let index = 0; index < 499; index++) {
      repo.registerWriteInterceptor({
        name: `mirror-${index}`,
        write: ({ write, writer }) => {
          writer.set(siblingRepo, `mirror-${index}-${write.id}`, { marker: 'x' });
        },
      });
    }

    await expect(repo.create({ name: 'Ada' })).resolves.toEqual({ id: 'auto-id' });
    expect(batch.set).toHaveBeenCalledTimes(500);
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });
});

describe('write interceptors — chunking counts PHYSICAL writes, not interceptors (U-7)', () => {
  it('an interceptor that stages NOTHING does not reserve a receipt slot', async () => {
    const { repo, batch, stagesExactly } = createHarness();
    repo.registerWriteInterceptor(stagesExactly('silent', 0));

    const created = await repo.bulkCreateWithIds(
      [
        { id: 'a', data: { name: 'A' } },
        { id: 'b', data: { name: 'B' } },
      ],
      { withMetadata: true },
    );

    // Counting the interceptor rather than the writes it staged would reserve a slot that never
    // fills, so document `b` reads past the end of the receipt array (a TypeError) or takes `a`'s.
    expect(batch.create).toHaveBeenCalledTimes(2);
    expect(batch.set).not.toHaveBeenCalled();
    expect(created).toEqual([
      { id: 'a', writeTime: 'create:a' },
      { id: 'b', writeTime: 'create:b' },
    ]);
  });

  it('an interceptor that stages SEVERAL writes still yields each document its own receipt', async () => {
    const { repo, batch, stagesExactly } = createHarness();
    repo.registerWriteInterceptor(stagesExactly('mirror', 2));

    const created = await repo.bulkCreateWithIds(
      [
        { id: 'a', data: { name: 'A' } },
        { id: 'b', data: { name: 'B' } },
        { id: 'c', data: { name: 'C' } },
      ],
      { withMetadata: true },
    );

    // 3 domain writes + 3 x 2 interceptor writes = 9 physical operations.
    expect(batch.create).toHaveBeenCalledTimes(3);
    expect(batch.set).toHaveBeenCalledTimes(6);
    // Counting interceptors (1 per document) instead of their writes (2) hands documents `b` and
    // `c` an INTERCEPTOR's receipt — silently, with no error and no type change. That is trap T3.
    expect(created).toEqual([
      { id: 'a', writeTime: 'create:a' },
      { id: 'b', writeTime: 'create:b' },
      { id: 'c', writeTime: 'create:c' },
    ]);
  });

  it('chunks on the physical count, so a multi-write interceptor never overflows a batch', async () => {
    const { repo, batch, stagesExactly } = createHarness();
    repo.registerWriteInterceptor(stagesExactly('mirror', 2));

    // 250 documents x 3 physical writes = 750 operations. Counting interceptors would see 250 x 2 =
    // 500 and commit ONE 750-operation batch — which production rejects and the emulator does not
    // (probe P3), so no emulator test could ever see it.
    const rows = Array.from({ length: 250 }, (_, index) => ({
      id: `doc-${index}`,
      data: { name: `n${index}` },
    }));
    await repo.bulkCreateWithIds(rows);

    // floor(500 / 3) = 166 whole groups per chunk, so 250 groups need two chunks.
    expect(batch.commit).toHaveBeenCalledTimes(2);
    expect(batch.create).toHaveBeenCalledTimes(250);
    expect(batch.set).toHaveBeenCalledTimes(500);
  });

  it('the oversized-group guard measures real writes, not interceptor count', async () => {
    const { repo, batch, stagesExactly } = createHarness();
    // ONE interceptor, but its write phase stages 600 writes for a single document.
    repo.registerWriteInterceptor(stagesExactly('greedy', 600));

    await expect(repo.create({ name: 'Ada' })).rejects.toThrow(
      /create\(\) cannot stage 601 writes for one document atomically/,
    );
    expect(batch.commit).not.toHaveBeenCalled();
  });

  it('reports committed/total in physical writes when a later chunk fails to commit', async () => {
    const { repo, batch, stagesExactly } = createHarness();
    repo.registerWriteInterceptor(stagesExactly('mirror', 1));

    // First chunk commits, second rejects — a shape the emulator cannot be asked to produce.
    let commits = 0;
    batch.commit.mockImplementation(async () => {
      commits += 1;
      if (commits === 2) throw new Error('backend rejected the second chunk');
      return Array.from({ length: 500 }, () => ({
        writeTime: 'chunk-1' as unknown as FirebaseFirestore.Timestamp,
      }));
    });

    const rows = Array.from({ length: 260 }, (_, index) => ({
      id: `doc-${index}`,
      data: { name: `n${index}` },
    }));
    const error = await repo
      .bulkCreateWithIds(rows)
      .then(() => null)
      .catch((caught: Error) => caught);

    expect(error).toBeInstanceOf(WriteOutcomeError);
    const outcome = (error as WriteOutcomeError).outcome;
    expect(outcome.state).toBe('partially-committed');
    // 250 groups x 2 = 500 physical writes committed, out of 260 x 2 = 520 total.
    expect(outcome.committedWrites).toBe(500);
    expect(outcome.totalWrites).toBe(520);
  });
});

describe('write interceptors — withMetadata under transaction mode (U-5)', () => {
  it('throws only in transaction mode, naming ONLY the read-capable interceptors', async () => {
    const { repo, db, writeOnly, readCapable } = createHarness();
    repo.registerWriteInterceptor(writeOnly('mirror'));
    repo.registerWriteInterceptor(readCapable('audit'));

    const error = await repo
      .create({ name: 'Ada' }, { withMetadata: true })
      .then(() => null)
      .catch((caught: Error) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/write interceptor\(s\) 'audit' declare a read phase/);
    // The write-only interceptor did not force the transaction, so naming it would misdirect the
    // caller to unregister the wrong one.
    expect((error as Error).message).not.toContain("'mirror'");
    // Refused before opening the transaction — nothing was staged, nothing committed.
    expect(db.runTransaction).not.toHaveBeenCalled();
  });

  it('keeps withMetadata working under batch mode (batch receipts are real)', async () => {
    const { repo, writeOnly } = createHarness();
    repo.registerWriteInterceptor(writeOnly('mirror'));

    const created = await repo.create({ name: 'Ada' }, { withMetadata: true });

    // The DOMAIN receipt — the `set` on the user document, not the interceptor's sibling write.
    expect(created).toEqual({ id: 'auto-id', writeTime: 'set:auto-id' });
  });

  it('keeps withMetadata working with nothing registered', async () => {
    const { repo } = createHarness();

    await expect(repo.create({ name: 'Ada' }, { withMetadata: true })).resolves.toEqual({
      id: 'auto-id',
      writeTime: fakeWriteTime,
    });
  });

  it('throws on every single-document surface that accepts withMetadata', async () => {
    const { repo, readCapable } = createHarness();
    repo.registerWriteInterceptor(readCapable('audit'));

    await expect(repo.create({ name: 'Ada' }, { withMetadata: true })).rejects.toThrow(
      /create\(\) cannot return \{ withMetadata: true \}/,
    );
    await expect(
      repo.createWithId('user-1', { name: 'Ada' }, { withMetadata: true }),
    ).rejects.toThrow(/createWithId\(\) cannot return \{ withMetadata: true \}/);
    await expect(repo.update('user-1', { name: 'Ada' }, { withMetadata: true })).rejects.toThrow(
      /update\(\) cannot return \{ withMetadata: true \}/,
    );
    await expect(repo.patch('user-1', { name: 'Ada' }, { withMetadata: true })).rejects.toThrow(
      /update\(\) cannot return \{ withMetadata: true \}/,
    );
    // `upsert` names ITSELF on both branches — the message must not depend on whether the document
    // happened to exist.
    await expect(repo.upsert('user-1', { name: 'Ada' }, { withMetadata: true })).rejects.toThrow(
      /upsert\(\) cannot return \{ withMetadata: true \}/,
    );
    await expect(repo.delete('user-1', { withMetadata: true })).rejects.toThrow(
      /delete\(\) cannot return \{ withMetadata: true \}/,
    );
  });
});

describe('write interceptors — paths with no shared boundary refuse (U-6)', () => {
  it('bulkWrite refuses, naming the operation and every interceptor', async () => {
    const { repo, db, writeOnly } = createHarness();
    repo.registerWriteInterceptor(writeOnly('mirror-a'));
    repo.registerWriteInterceptor(writeOnly('mirror-b'));

    await expect(repo.bulkWrite([{ op: 'create', data: { name: 'Ada' } }])).rejects.toThrow(
      /bulkWrite\(\) cannot run write interceptor\(s\) 'mirror-a', 'mirror-b'/,
    );
    expect(db.bulkWriter).not.toHaveBeenCalled();
  });

  it('bulkWrite refuses even with { skipHooks: true } — a guarantee is not a notification', async () => {
    const { repo, db, writeOnly } = createHarness();
    repo.registerWriteInterceptor(writeOnly('mirror'));

    await expect(
      repo.bulkWrite([{ op: 'create', data: { name: 'Ada' } }], { skipHooks: true }),
    ).rejects.toThrow(/bulkWrite\(\) cannot run write interceptor\(s\) 'mirror'/);
    expect(db.bulkWriter).not.toHaveBeenCalled();
  });

  it('recursiveDelete and recursiveDeleteCollection refuse, naming the operation', async () => {
    const { repo, db, writeOnly } = createHarness();
    repo.registerWriteInterceptor(writeOnly('mirror'));

    await expect(repo.recursiveDelete('user-1')).rejects.toThrow(
      /recursiveDelete\(\) cannot run write interceptor\(s\) 'mirror'/,
    );
    await expect(repo.recursiveDeleteCollection()).rejects.toThrow(
      /recursiveDeleteCollection\(\) cannot run write interceptor\(s\) 'mirror'/,
    );
    expect(db.recursiveDelete).not.toHaveBeenCalled();
  });

  it('all three run normally with no interceptor registered', async () => {
    const { repo, db } = createHarness();

    await expect(repo.recursiveDelete('user-1')).resolves.toBeUndefined();
    await expect(repo.recursiveDeleteCollection()).resolves.toBeUndefined();
    expect(db.recursiveDelete).toHaveBeenCalledTimes(2);
    // bulkWrite reaches the SDK boundary (the harness throws there on purpose, proving it got past
    // every guard rather than being refused up front).
    await expect(repo.bulkWrite([{ op: 'create', data: { name: 'Ada' } }])).rejects.toThrow(
      /db\.bulkWriter\(\) must not be reached/,
    );
  });

  // Query write terminals are covered by I-13 in the emulator suite: they need a real query, which
  // the mocked boundary here cannot produce. This case is the five fixed-batch helpers only.
  it('the five fixed-batch helpers refuse under transaction mode', async () => {
    const { repo, readCapable } = createHarness();
    repo.registerWriteInterceptor(readCapable('audit'));

    await expect(repo.bulkCreate([{ name: 'Ada' }])).rejects.toThrow(
      /bulkCreate\(\) cannot run write interceptor\(s\) 'audit': they declare a read phase/,
    );
    await expect(repo.bulkCreateWithIds([{ id: 'user-1', data: { name: 'Ada' } }])).rejects.toThrow(
      /bulkCreateWithIds\(\) cannot run write interceptor\(s\) 'audit'/,
    );
    await expect(repo.bulkUpdate([{ id: 'user-1', data: { name: 'Ada' } }])).rejects.toThrow(
      /bulkUpdate\(\)\/bulkPatch\(\) cannot run write interceptor\(s\) 'audit'/,
    );
    await expect(repo.bulkPatch([{ id: 'user-1', data: { name: 'Ada' } }])).rejects.toThrow(
      /bulkUpdate\(\)\/bulkPatch\(\) cannot run write interceptor\(s\) 'audit'/,
    );
    await expect(repo.bulkDelete(['user-1'])).rejects.toThrow(
      /bulkDelete\(\) cannot run write interceptor\(s\) 'audit'/,
    );
  });
});
