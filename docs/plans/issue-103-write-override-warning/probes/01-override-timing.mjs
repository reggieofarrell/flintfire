/**
 * Probe 01 — override detection timing vs constructor-time visibility.
 *
 * Proves: method-style overrides are visible on the prototype during/after the base ctor;
 * class-field and ctor-body assignments are invisible on the prototype (only on the instance
 * after construction). Also proves adds-only subclasses are silent and 2-level chains accumulate.
 *
 * Run (from repo root, after `npm run build`):
 *   node docs/plans/issue-103-write-override-warning/probes/01-override-timing.mjs
 */
import { FirestoreRepository } from '../../../../dist/index.js';

const WRITE = [
  'bulkCreate',
  'bulkCreateWithIds',
  'bulkDelete',
  'bulkPatch',
  'bulkUpdate',
  'bulkWrite',
  'create',
  'createInTransaction',
  'createWithId',
  'createWithIdInTransaction',
  'delete',
  'deleteInTransaction',
  'patch',
  'patchInTransaction',
  'recursiveDelete',
  'recursiveDeleteCollection',
  'update',
  'updateInTransaction',
  'upsert',
];

function detectOnProto(ctor) {
  const found = new Set();
  let proto = ctor.prototype;
  const base = FirestoreRepository.prototype;
  while (proto && proto !== base && proto !== Object.prototype) {
    for (const name of WRITE) {
      if (Object.prototype.hasOwnProperty.call(proto, name)) found.add(name);
    }
    proto = Object.getPrototypeOf(proto);
  }
  return [...found].sort();
}

function detectOnInstance(inst) {
  const found = new Set();
  for (const name of WRITE) {
    if (Object.prototype.hasOwnProperty.call(inst, name)) {
      found.add(name);
      continue;
    }
    let p = Object.getPrototypeOf(inst);
    const base = FirestoreRepository.prototype;
    while (p && p !== base && p !== Object.prototype) {
      if (Object.prototype.hasOwnProperty.call(p, name)) {
        found.add(name);
        break;
      }
      p = Object.getPrototypeOf(p);
    }
  }
  return [...found].sort();
}

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

class ProtoOverride extends FirestoreRepository {
  async update(...args) {
    return super.update(...args);
  }
}
class FieldOverride extends FirestoreRepository {
  update = async (...args) => super.update(...args);
}
class CtorBodyOverride extends FirestoreRepository {
  constructor(...a) {
    super(...a);
    this.update = async (...args) => super.update(...args);
  }
}
class AddsOnly extends FirestoreRepository {
  findActive() {
    return this.query();
  }
}
class TwoLevelBase extends FirestoreRepository {
  async update(...args) {
    return super.update(...args);
  }
}
class TwoLevelChild extends TwoLevelBase {
  async delete(...args) {
    return super.delete(...args);
  }
}
class MultiOverride extends FirestoreRepository {
  async update(...args) {
    return super.update(...args);
  }
  async bulkUpdate(...args) {
    return super.bulkUpdate(...args);
  }
}

const rows = {
  'proto-class': detectOnProto(ProtoOverride),
  'field-class': detectOnProto(FieldOverride),
  'ctorbody-class': detectOnProto(CtorBodyOverride),
  'proto-inst': detectOnInstance(new ProtoOverride(db, 'users')),
  'field-inst': detectOnInstance(new FieldOverride(db, 'users')),
  'ctorbody-inst': detectOnInstance(new CtorBodyOverride(db, 'users')),
  'adds-only': detectOnProto(AddsOnly),
  'two-level': detectOnProto(TwoLevelChild),
  multi: detectOnProto(MultiOverride),
};

for (const [k, v] of Object.entries(rows)) {
  console.log(k, JSON.stringify(v));
}

const expect = {
  'proto-class': ['update'],
  'field-class': [],
  'ctorbody-class': [],
  'proto-inst': ['update'],
  'field-inst': ['update'],
  'ctorbody-inst': ['update'],
  'adds-only': [],
  'two-level': ['delete', 'update'],
  multi: ['bulkUpdate', 'update'],
};

let failed = false;
for (const [k, want] of Object.entries(expect)) {
  const got = JSON.stringify(rows[k]);
  const need = JSON.stringify(want);
  if (got !== need) {
    console.error('FAIL', k, 'got', got, 'want', need);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log('OK');
