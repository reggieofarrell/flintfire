/**
 * Probe 02 — subclass identity is dropped by every derivation path.
 *
 * Proves: `subcollection()` and `withSchema()` return plain `FirestoreRepository` instances, and
 * `runInTransaction` constructs with `new FirestoreRepository` (not `this.constructor`).
 *
 * Run (from repo root, after `npm run build`):
 *   node docs/plans/issue-103-write-override-warning/probes/02-identity-drop.mjs
 */
import fs from 'node:fs';
import { z } from 'zod';
import { FirestoreRepository } from '../../../../dist/index.js';

const db = {
  collection: () => ({
    withConverter() {
      return this;
    },
    doc() {
      return {};
    },
  }),
};

const userSchema = z.object({ name: z.string() });
const orderSchema = z.object({ total: z.number() });

class UserRepository extends FirestoreRepository {
  async update(...args) {
    return super.update(...args);
  }
}

const user = new UserRepository(db, 'users');
const sub = user.subcollection('u1', 'orders', orderSchema);
const ws = FirestoreRepository.withSchema(db, 'users', userSchema);

const rows = {
  'user-ctor': user.constructor.name,
  'user-update-is-override': user.update === UserRepository.prototype.update,
  'sub-ctor': sub.constructor.name,
  'sub-instanceof-User': sub instanceof UserRepository,
  'sub-update-is-override': sub.update === UserRepository.prototype.update,
  'withSchema-is-FR': ws.constructor === FirestoreRepository,
};

// Source-level: runInTransaction allocates with `new FirestoreRepository(...txArgs)`.
const src = fs.readFileSync('src/core/FirestoreRepository.ts', 'utf8');
const txAlloc = /const txRepo = new FirestoreRepository<[^>]+>\(\.\.\.txArgs\);/.test(src);
rows['tx-alloc-is-new-FR'] = txAlloc;

// Count hard-coded `return new FirestoreRepository` / `new FirestoreRepository(...args)` sites that
// drop subclass identity (factories + tx clone) — not JSDoc examples.
const hardCoded = [
  ...src.matchAll(/return new FirestoreRepository/g),
  ...src.matchAll(/const txRepo = new FirestoreRepository/g),
].length;
rows['hardcoded-new-FR-count'] = hardCoded;

for (const [k, v] of Object.entries(rows)) {
  console.log(k, v);
}

const checks = [
  ['user-update-is-override', true],
  ['sub-ctor', 'FirestoreRepository'],
  ['sub-instanceof-User', false],
  ['sub-update-is-override', false],
  ['withSchema-is-FR', true],
  ['tx-alloc-is-new-FR', true],
  ['hardcoded-new-FR-count', 4], // withSchema x2 paths, subcollection, txRepo
];

let failed = false;
for (const [k, want] of checks) {
  if (rows[k] !== want) {
    console.error('FAIL', k, 'got', rows[k], 'want', want);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log('OK');
