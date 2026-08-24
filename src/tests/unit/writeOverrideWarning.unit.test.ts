/**
 * Strategy: unit-test the once-per-class write-override warning (issue #103 / ADR-0043). No
 * Firestore I/O — construction against `createMockFirestoreDb()` is enough to exercise the base
 * constructor call and the helper. Verification points:
 *   1. Plain `FirestoreRepository` and adds-only subclasses emit zero warns (T3 / T6 / P4).
 *   2. Method-style write overrides warn once per constructor; message names the methods and
 *      omits `patch()` from the `update` bypass list (T5 / U-3).
 *   3. `updateInTransaction` overrides omit `patchInTransaction()` from that method's bypass
 *      line (M1 / U-3b — transactional self-delegate mirror of T5).
 *   4. Second instance of the same overriding class stays silent (WeakSet keyed by ctor — T3/T7).
 *   5. `static suppressWriteOverrideWarning = true` silences deliberate overrides (D2).
 *   6. Multi-override and two-level chains list every overridden write (P5 / P6).
 *   7. `REPOSITORY_WRITE_METHODS` matches the authoritative 19-name list.
 *   8. Class-field overrides are **not** detected today (characterization of T2 / D3).
 *   9. `bulkWrite` bypass text lists concrete paths (no `*InTransaction()` glob; includes
 *      `recursiveDeleteCollection()` — N1 completeness).
 *
 * Coverage of `FirestoreRepository.ts` is owned by the integration gate; this helper file has no
 * path-specific gate (§5) — unit coverage here is still mandatory.
 */
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import {
  REPOSITORY_WRITE_METHODS,
  formatWriteOverrideWarning,
} from '../../core/writeOverrideWarning.js';
import { createMockFirestoreDb } from '../shared/mocks/firestore.mocks.js';

/** Stub db — construction validates the path but never touches Firestore I/O. */
const { db } = createMockFirestoreDb();

type Doc = { name: string };

/** Authoritative 19-name write list from plan §3.3 — keep U-8 in sync with the type-test Write union. */
const AUTHORITATIVE_WRITE_METHODS = [
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
] as const;

describe('writeOverrideWarning', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    // Isolate from any other suite that might spy console.warn globally (T6).
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  // U-1 — base construction must short-circuit before any prototype walk.
  it('U-1: plain FirestoreRepository emits no warn', () => {
    new FirestoreRepository<Doc>(db, 'users');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // U-2 — method additions are legitimate; they must stay silent (P4 / T6).
  it('U-2: subclass that only adds a method emits no warn', () => {
    class AddsOnlyRepo extends FirestoreRepository<Doc> {
      findActive() {
        return this.query().where('name', '==', 'a').get();
      }
    }
    new AddsOnlyRepo(db, 'users');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // U-3 — method-style update override warns; bypass list must omit patch() (T5 / P17).
  it('U-3: subclass overriding update warns once and omits patch() from update bypasses', () => {
    class UpdateOverrideRepo extends FirestoreRepository<Doc> {
      override async update(
        ...args: Parameters<FirestoreRepository<Doc>['update']>
      ): ReturnType<FirestoreRepository<Doc>['update']> {
        return super.update(...args);
      }
    }
    new UpdateOverrideRepo(db, 'users');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0] ?? '');
    expect(message).toContain('[flintfire]');
    expect(message).toContain('UpdateOverrideRepo');
    expect(message).toContain('update()');
    // The update bypass line must not list patch() — patch delegates to this.update.
    // Use /patch\(\)/ (not a substring of patchInTransaction) so a false "patch()" entry fails.
    const updateBypassLine = message
      .split('\n')
      .find(line => line.includes('update() is bypassed by:'));
    expect(updateBypassLine).toBeDefined();
    expect(updateBypassLine).not.toMatch(/patch\(\)/);
    expect(message).toContain('static suppressWriteOverrideWarning = true');
  });

  // U-3b — transactional self-delegate mirror of U-3 / T5 (review M1).
  // patchInTransaction → this.updateInTransaction, so listing patchInTransaction() as a bypass of
  // updateInTransaction would invent a leak. Mutation: adding it back must fail this test alone.
  it('U-3b: subclass overriding updateInTransaction omits patchInTransaction() from that bypass line', () => {
    class TxUpdateOverrideRepo extends FirestoreRepository<Doc> {
      override async updateInTransaction(
        ...args: Parameters<FirestoreRepository<Doc>['updateInTransaction']>
      ): ReturnType<FirestoreRepository<Doc>['updateInTransaction']> {
        return super.updateInTransaction(...args);
      }
    }
    new TxUpdateOverrideRepo(db, 'users');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0] ?? '');
    expect(message).toContain('TxUpdateOverrideRepo');
    expect(message).toContain('updateInTransaction()');
    // Isolate the updateInTransaction bypass line — patchInTransaction() must not appear on it.
    // Keep patchInTransaction() on BYPASS_PATHS.update (true non-tx leak); only this line is pinned.
    const txBypassLine = message
      .split('\n')
      .find(line => line.includes('updateInTransaction() is bypassed by:'));
    expect(txBypassLine).toBeDefined();
    expect(txBypassLine).not.toMatch(/patchInTransaction\(\)/);
  });

  // U-4 — WeakSet is keyed by constructor, not instance (T3 / T7).
  describe('U-4: once-per-class', () => {
    class OncePerClassRepo extends FirestoreRepository<Doc> {
      override async update(
        ...args: Parameters<FirestoreRepository<Doc>['update']>
      ): ReturnType<FirestoreRepository<Doc>['update']> {
        return super.update(...args);
      }
    }

    it('second instance of the same overriding class does not warn again', () => {
      new OncePerClassRepo(db, 'users');
      new OncePerClassRepo(db, 'users');
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  // U-5 — documented static opt-out (D2).
  it('U-5: suppressWriteOverrideWarning = true silences an overriding subclass', () => {
    class SuppressedOverrideRepo extends FirestoreRepository<Doc> {
      static suppressWriteOverrideWarning = true;
      override async update(
        ...args: Parameters<FirestoreRepository<Doc>['update']>
      ): ReturnType<FirestoreRepository<Doc>['update']> {
        return super.update(...args);
      }
    }
    new SuppressedOverrideRepo(db, 'users');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // U-6 — multi-override message names every overridden write (P6).
  it('U-6: overriding update and bulkUpdate names both in the message', () => {
    class MultiOverrideRepo extends FirestoreRepository<Doc> {
      override async update(
        ...args: Parameters<FirestoreRepository<Doc>['update']>
      ): ReturnType<FirestoreRepository<Doc>['update']> {
        return super.update(...args);
      }
      override async bulkUpdate(
        ...args: Parameters<FirestoreRepository<Doc>['bulkUpdate']>
      ): ReturnType<FirestoreRepository<Doc>['bulkUpdate']> {
        return super.bulkUpdate(...args);
      }
    }
    new MultiOverrideRepo(db, 'users');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0] ?? '');
    expect(message).toContain('update()');
    expect(message).toContain('bulkUpdate()');
  });

  // U-7 — prototype walk climbs past the immediate parent (P5).
  it('U-7: two-level chain names delete and update', () => {
    class TwoLevelParent extends FirestoreRepository<Doc> {
      override async update(
        ...args: Parameters<FirestoreRepository<Doc>['update']>
      ): ReturnType<FirestoreRepository<Doc>['update']> {
        return super.update(...args);
      }
    }
    class TwoLevelChild extends TwoLevelParent {
      override async delete(
        ...args: Parameters<FirestoreRepository<Doc>['delete']>
      ): ReturnType<FirestoreRepository<Doc>['delete']> {
        return super.delete(...args);
      }
    }
    new TwoLevelChild(db, 'users');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0] ?? '');
    expect(message).toContain('TwoLevelChild');
    expect(message).toContain('delete()');
    expect(message).toContain('update()');
  });

  // U-8 — durability of the runtime list vs the plan / type-test Write union.
  it('U-8: REPOSITORY_WRITE_METHODS matches the authoritative 19-name list', () => {
    expect([...REPOSITORY_WRITE_METHODS].sort()).toEqual([...AUTHORITATIVE_WRITE_METHODS].sort());
    expect(REPOSITORY_WRITE_METHODS).toHaveLength(19);
  });

  // U-9 — characterization of today's blind spot (T2 / D3): field-style is invisible at ctor time
  // because class fields initialize *after* `super()` returns. This documents non-detection; it does
  // not alone prove the walk never inspects the instance (an instance check at end-of-super would
  // still see no field).
  it('U-9: class-field override does not warn (documents ctor-time non-detection)', () => {
    class FieldStyleOverrideRepo extends FirestoreRepository<Doc> {
      // Intentionally a class field, not a method — lands on the instance after super() returns.
      update = async (
        ...args: Parameters<FirestoreRepository<Doc>['update']>
      ): ReturnType<FirestoreRepository<Doc>['update']> => {
        return FirestoreRepository.prototype.update.apply(this, args);
      };
    }
    new FieldStyleOverrideRepo(db, 'users');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // Formatter unit — anonymous display name fallback + D4 redirect (facade, not interceptors).
  it('formatWriteOverrideWarning falls back for empty class names and avoids interceptor redirect', () => {
    const message = formatWriteOverrideWarning('', ['update']);
    expect(message).toContain('(anonymous subclass)');
    expect(message).toContain('Enforced denormalization');
    // D4 durability: do not point at unshipped ADR-0040 interceptors.
    expect(message).not.toMatch(/interceptor/i);
  });

  // N1 — bulkWrite bypass text must enumerate concrete sibling paths (no glob understatement).
  it('N1: bulkWrite bypass list is concrete (no *InTransaction glob; includes recursiveDeleteCollection)', () => {
    const message = formatWriteOverrideWarning('BulkWriteOverride', ['bulkWrite']);
    const bulkWriteBypassLine = message
      .split('\n')
      .find(line => line.includes('bulkWrite() is bypassed by:'));
    expect(bulkWriteBypassLine).toBeDefined();
    // Glob understatement from the prototype — pin that it is gone.
    expect(bulkWriteBypassLine).not.toMatch(/\*InTransaction\(\)/);
    // Representative omissions the review called out — must appear as concrete names.
    expect(bulkWriteBypassLine).toContain('patch()');
    expect(bulkWriteBypassLine).toContain('upsert()');
    expect(bulkWriteBypassLine).toContain('bulkPatch()');
    expect(bulkWriteBypassLine).toContain('patchInTransaction()');
    expect(bulkWriteBypassLine).toContain('recursiveDeleteCollection()');
  });
});
