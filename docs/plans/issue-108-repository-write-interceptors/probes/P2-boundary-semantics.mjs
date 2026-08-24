/**
 * P2..P6 — Emulator-verified behavioural facts the interceptor implementation depends on.
 *
 * Run (from repo root, emulator supplied by firebase emulators:exec):
 *   firebase emulators:exec --project demo-firestoreorm-test --only firestore \
 *     "node docs/plans/issue-108-repository-write-interceptors/probes/P2-boundary-semantics.mjs"
 *
 * Each block prints `<id> :: <observation>`. Nothing here touches src/.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
initializeApp({ projectId: 'demo-firestoreorm-test' });
const db = getFirestore();
const col = db.collection(`probe108_${Date.now()}`);

const out = (id, value) => console.log(`${id} :: ${value}`);

// ---------------------------------------------------------------------------
// P2 — Does WriteBatch.commit() return receipts 1:1 with enqueue order across
//      MIXED op kinds? This is what group-aware positional receipt mapping rests on.
// ---------------------------------------------------------------------------
{
  const a = col.doc('p2-a');
  const b = col.doc('p2-b');
  const c = col.doc('p2-c');
  await a.set({ n: 0 });
  await c.set({ n: 0 });

  const batch = db.batch();
  batch.create(b, { n: 1 }); // create
  batch.update(a, { n: 2 }); // update
  batch.delete(c); // delete
  const results = await batch.commit();
  out('P2.count', `enqueued 3 (create,update,delete) -> receipts ${results.length}`);
  out(
    'P2.shape',
    `every receipt has writeTime: ${results.every(r => r.writeTime !== undefined)}; ` +
      `distinct writeTimes: ${new Set(results.map(r => r.writeTime.toMillis())).size}`,
  );
}

// ---------------------------------------------------------------------------
// P3 — Does the EMULATOR enforce the 500-operation WriteBatch limit? Test design
//      depends on this: if it does not, a chunk-boundary test cannot assert by failure.
// ---------------------------------------------------------------------------
{
  const batch = db.batch();
  for (let i = 0; i < 501; i++) batch.set(col.doc(`p3-${i}`), { i });
  try {
    const results = await batch.commit();
    out('P3.limit', `501-op batch COMMITTED (no client/emulator limit); receipts ${results.length}`);
  } catch (error) {
    out('P3.limit', `501-op batch REJECTED: ${error.constructor.name}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// P4 — Transaction ordering: does a read AFTER a write in the same transaction throw?
//      The interceptor read phase must run before the primary write is staged; this is
//      the error an interceptor that reads too late inside *InTransaction would hit.
// ---------------------------------------------------------------------------
{
  const target = col.doc('p4-a');
  await target.set({ n: 1 });
  try {
    await db.runTransaction(async tx => {
      tx.update(target, { n: 2 });
      await tx.get(target); // read after write
    });
    out('P4.readAfterWrite', 'ALLOWED (no error)');
  } catch (error) {
    out(
      'P4.readAfterWrite',
      `${error.constructor.name}: ${error.message}${error.code !== undefined ? ` (code=${error.code})` : ''}`,
    );
  }
}

// ---------------------------------------------------------------------------
// P5 — Does db.runTransaction expose ANY per-operation receipt? (ADR-0037 premise.)
// ---------------------------------------------------------------------------
{
  const target = col.doc('p5-a');
  const value = await db.runTransaction(async tx => {
    tx.create(target, { n: 1 });
    return 'callback-value';
  });
  out('P5.txReturn', `runTransaction resolved to: ${JSON.stringify(value)} (typeof ${typeof value})`);
  const staged = await db.runTransaction(async tx => tx.create(col.doc('p5-b'), { n: 1 }));
  out('P5.stageReturn', `tx.create(...) returned: ${staged?.constructor?.name ?? String(staged)}`);
}

// ---------------------------------------------------------------------------
// P6 — Does a read-only transaction reject a staged write, and with what message?
//      Relevant because runInTransaction hands a FULL repo even under { readOnly: true }.
// ---------------------------------------------------------------------------
{
  try {
    await db.runTransaction(async tx => {
      tx.create(col.doc('p6-a'), { n: 1 });
    }, { readOnly: true });
    out('P6.readOnlyWrite', 'ALLOWED (no error)');
  } catch (error) {
    out('P6.readOnlyWrite', `${error.constructor.name}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// P7 — Does a FAILED transaction attempt commit anything it staged? (ADR-0040's
//      retry-safety claim: an interceptor that only stages is safe to re-run.)
//      Retry RE-ENTRY itself is already covered by the repo's own integration test
//      `repository-write-outcomes.integration.test.ts` I4, so it is not re-probed here.
// ---------------------------------------------------------------------------
{
  const primary = col.doc('p7-primary');
  const sibling = col.doc('p7-sibling');
  try {
    await db.runTransaction(async tx => {
      tx.create(primary, { n: 1 });
      tx.create(sibling, { n: 1 }); // stands in for the interceptor's staged write
      throw new Error('interceptor threw after staging');
    });
  } catch (error) {
    out('P7.abortThrow', `${error.constructor.name}: ${error.message}`);
  }
  const [p, s] = await Promise.all([primary.get(), sibling.get()]);
  out('P7.abortState', `primary.exists=${p.exists} sibling.exists=${s.exists}`);
}

// ---------------------------------------------------------------------------
// P8 — Cross-`Firestore`-instance staging: what happens when a DocumentReference
//      from a DIFFERENT Firestore instance is staged into this batch? An interceptor
//      addresses siblings "through a repository", and nothing stops that repository
//      from being built on another Firestore instance.
// ---------------------------------------------------------------------------
{
  const { initializeApp: initApp } = await import('firebase-admin/app');
  const { getFirestore: getFs } = await import('firebase-admin/firestore');
  const otherApp = initApp({ projectId: 'demo-firestoreorm-test' }, 'probe108-second');
  const db2 = getFs(otherApp);
  const foreign = db2.collection(col.id).doc('p8-foreign');
  const batch = db.batch();
  try {
    batch.create(foreign, { n: 1 });
    const results = await batch.commit();
    out('P8.crossInstance', `ACCEPTED at stage AND commit; receipts ${results.length}`);
  } catch (error) {
    out('P8.crossInstance', `${error.constructor.name}: ${error.message}`);
  }
  try {
    await db2.runTransaction(async tx => {
      tx.create(col.doc('p8-tx-foreign'), { n: 1 });
    });
    out('P8.crossInstanceTx', 'ACCEPTED');
  } catch (error) {
    out('P8.crossInstanceTx', `${error.constructor.name}: ${error.message}`);
  }
  await db2.terminate();
}

await db.recursiveDelete(col);
await db.terminate();
