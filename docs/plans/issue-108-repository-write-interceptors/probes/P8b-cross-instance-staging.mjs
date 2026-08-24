/**
 * P8b — Staging a DocumentReference from a DIFFERENT `Firestore` instance into this
 * instance's WriteBatch. ADR-0040 has interceptors address siblings "through a repository";
 * nothing stops that repository being built on another `Firestore` instance. Does the SDK
 * guard it, and if not, where does the write go?
 *
 * Run: firebase emulators:exec --project demo-firestoreorm-test --only firestore \
 *   "node docs/plans/issue-108-repository-write-interceptors/probes/P8b-cross-instance-staging.mjs"
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
const db1 = getFirestore(initializeApp({ projectId: 'demo-firestoreorm-test' }, 'one'));
const db2 = getFirestore(initializeApp({ projectId: 'demo-other-project' }, 'two'));

const COL = 'p8b';
const foreignRef = db2.collection(COL).doc('x');
console.log('P8b.refIdentity   ::', `path=${foreignRef.path} firestore===db2 ? ${foreignRef.firestore === db2}`);

// Control: a NATIVE write through db2 is readable through db2.
await db2.collection(COL).doc('control').set({ marker: 'native-db2' });
const control = await db2.collection(COL).doc('control').get();
console.log('P8b.control       ::', `native db2 write readable through db2: ${control.exists}`);

// The actual test: stage db2's ref into db1's batch.
const batch = db1.batch();
try {
  batch.create(foreignRef, { marker: 'staged-into-db1' });
  const receipts = await batch.commit();
  console.log('P8b.commit        ::', `ACCEPTED; receipts=${receipts.length} writeTime=${receipts[0].writeTime.toDate().toISOString()}`);
} catch (error) {
  console.log('P8b.commit        ::', `${error.constructor.name}: ${error.message}`);
}

for (const [label, db] of [['db1(demo-firestoreorm-test)', db1], ['db2(demo-other-project)', db2]]) {
  const direct = await db.collection(COL).doc('x').get();
  const listed = (await db.collection(COL).listDocuments()).map(d => d.id).sort();
  console.log(`P8b.readback      :: ${label}: doc('x').exists=${direct.exists} listDocuments=[${listed}]`);
}

await db1.terminate();
await db2.terminate();
