/**
 * Once-per-class warning when a subclass overrides a {@link FirestoreRepository} write method.
 *
 * Why this exists: overriding `update` / `create` / `delete` (etc.) compiles and looks like an
 * enforced invariant, but sibling write paths do not self-delegate through the override. The
 * constructor-time check catches the common prototype/method override shape; class-field and
 * ctor-body assignments are invisible until after `super()` returns (see issue #103).
 *
 * @see ADR-0043 — write-override warning (issue #103)
 * @see ADR-0040 — write interceptors (issue #108), the enforcement mechanism this warning now
 *   redirects to. Wiring the lazy field-style/ctor-body check into that choke point is still
 *   outstanding; interceptors do not remove the blind spot, they give the warning somewhere correct
 *   to point.
 */

/**
 * Public write entry points on {@link FirestoreRepository}. Overriding any of these does **not**
 * enforce an invariant across sibling paths — the warning names the bypasses.
 *
 * Durability: keep this list in sync with the type-test partition in
 * `src/tests/types/write-override-warning.type-test.ts`. The type-test `Missing` / `Extra` guards
 * fail when a public instance member is unclassified or when a listed write name is not on the class.
 */
export const REPOSITORY_WRITE_METHODS = [
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

/** One of {@link REPOSITORY_WRITE_METHODS}. */
export type RepositoryWriteMethod = (typeof REPOSITORY_WRITE_METHODS)[number];

/**
 * Sibling paths that bypass a given write override. Used only in the warning text so the message
 * names concrete leaks rather than a generic "other methods may bypass".
 *
 * Self-delegates are omitted from their target's bypass list so the warning does not invent a
 * leak that does not exist:
 * - `patch` → `this.update` — omit `patch()` from the `update` list
 * - `patchInTransaction` → `this.updateInTransaction` — omit `patchInTransaction()` from the
 *   `updateInTransaction` list
 *
 * Keep `patchInTransaction()` on the `update` list: non-transactional `update` overrides are
 * still bypassed by the transactional patch alias (true leak).
 */
const BYPASS_PATHS: Record<RepositoryWriteMethod, readonly string[]> = {
  update: [
    'upsert()',
    'bulkUpdate()',
    'bulkPatch()',
    'query().update()',
    'bulkWrite()',
    'updateInTransaction()',
    'patchInTransaction()',
  ],
  patch: [
    'update()',
    'upsert()',
    'bulkUpdate()',
    'bulkPatch()',
    'query().update()',
    'bulkWrite()',
    'updateInTransaction()',
    'patchInTransaction()',
  ],
  create: [
    'createWithId()',
    'bulkCreate()',
    'bulkCreateWithIds()',
    'upsert()',
    'createInTransaction()',
    'createWithIdInTransaction()',
    'bulkWrite()',
  ],
  createWithId: [
    'create()',
    'bulkCreate()',
    'bulkCreateWithIds()',
    'upsert()',
    'createInTransaction()',
    'createWithIdInTransaction()',
    'bulkWrite()',
  ],
  delete: [
    'bulkDelete()',
    'query().delete()',
    'deleteInTransaction()',
    'bulkWrite()',
    'recursiveDelete()',
    'recursiveDeleteCollection()',
  ],
  // For bulk / transactional / recursive entry points, every other write path is a bypass.
  bulkCreate: [
    'create()',
    'createWithId()',
    'bulkCreateWithIds()',
    'upsert()',
    'bulkWrite()',
    'createInTransaction()',
    'createWithIdInTransaction()',
  ],
  bulkCreateWithIds: [
    'create()',
    'createWithId()',
    'bulkCreate()',
    'upsert()',
    'bulkWrite()',
    'createInTransaction()',
    'createWithIdInTransaction()',
  ],
  bulkUpdate: [
    'update()',
    'patch()',
    'upsert()',
    'bulkPatch()',
    'query().update()',
    'bulkWrite()',
    'updateInTransaction()',
    'patchInTransaction()',
  ],
  bulkPatch: [
    'update()',
    'patch()',
    'upsert()',
    'bulkUpdate()',
    'query().update()',
    'bulkWrite()',
    'updateInTransaction()',
    'patchInTransaction()',
  ],
  bulkDelete: [
    'delete()',
    'query().delete()',
    'deleteInTransaction()',
    'bulkWrite()',
    'recursiveDelete()',
    'recursiveDeleteCollection()',
  ],
  // Every other write path bypasses a bulkWrite override — list them concretely (no globs) so the
  // message does not understate leaks such as patch / upsert / recursiveDeleteCollection.
  bulkWrite: [
    'create()',
    'createWithId()',
    'update()',
    'patch()',
    'delete()',
    'upsert()',
    'bulkCreate()',
    'bulkCreateWithIds()',
    'bulkUpdate()',
    'bulkPatch()',
    'bulkDelete()',
    'query().update()',
    'query().delete()',
    'createInTransaction()',
    'createWithIdInTransaction()',
    'updateInTransaction()',
    'patchInTransaction()',
    'deleteInTransaction()',
    'recursiveDelete()',
    'recursiveDeleteCollection()',
  ],
  upsert: [
    'create()',
    'update()',
    'patch()',
    'bulkCreate()',
    'bulkUpdate()',
    'createInTransaction()',
    'updateInTransaction()',
    'bulkWrite()',
  ],
  // patchInTransaction() is omitted — it self-delegates to this.updateInTransaction (same shape as
  // patch → update). Listing it here would be a T5-class false bypass (review M1).
  updateInTransaction: [
    'update()',
    'patch()',
    'upsert()',
    'bulkUpdate()',
    'query().update()',
    'bulkWrite()',
  ],
  patchInTransaction: [
    'update()',
    'patch()',
    'upsert()',
    'bulkUpdate()',
    'query().update()',
    'bulkWrite()',
    'updateInTransaction()',
  ],
  createInTransaction: [
    'create()',
    'createWithId()',
    'bulkCreate()',
    'upsert()',
    'createWithIdInTransaction()',
    'bulkWrite()',
  ],
  createWithIdInTransaction: [
    'create()',
    'createWithId()',
    'bulkCreate()',
    'upsert()',
    'createInTransaction()',
    'bulkWrite()',
  ],
  deleteInTransaction: [
    'delete()',
    'bulkDelete()',
    'query().delete()',
    'bulkWrite()',
    'recursiveDelete()',
    'recursiveDeleteCollection()',
  ],
  recursiveDelete: [
    'delete()',
    'bulkDelete()',
    'query().delete()',
    'deleteInTransaction()',
    'bulkWrite()',
    'recursiveDeleteCollection()',
  ],
  recursiveDeleteCollection: [
    'delete()',
    'bulkDelete()',
    'query().delete()',
    'deleteInTransaction()',
    'bulkWrite()',
    'recursiveDelete()',
  ],
};

/**
 * Constructor identity used for WeakSet keying and the suppress flag. Never invoked — only compared
 * by reference and read for `.name` / `.prototype` / the static opt-out. Replaces bare `Function`
 * so `@typescript-eslint/no-unsafe-function-type` stays clean (prototype.patch used `Function`).
 */
type ConstructorIdentity = {
  readonly name: string;
  readonly prototype: object;
  suppressWriteOverrideWarning?: boolean;
};

/** Constructors that have already emitted the once-per-class warning in this process. */
const warnedConstructors = new WeakSet<object>();

/**
 * Walk the prototype chain between `ctor.prototype` and `FirestoreRepository.prototype`, collecting
 * write-method names that are own properties on an intermediate prototype (method-style overrides).
 *
 * Class-field and ctor-body assignments are invisible here — they land on the instance after
 * `super()` returns.
 */
export function collectOverriddenWriteMethods(
  ctor: ConstructorIdentity,
  basePrototype: object,
): RepositoryWriteMethod[] {
  const found = new Set<RepositoryWriteMethod>();
  let proto: object | null = ctor.prototype;
  while (proto && proto !== basePrototype && proto !== Object.prototype) {
    for (const name of REPOSITORY_WRITE_METHODS) {
      if (Object.prototype.hasOwnProperty.call(proto, name)) {
        found.add(name);
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
  return [...found].sort((left, right) => left.localeCompare(right));
}

/**
 * Build the once-per-class warning string.
 *
 * The redirect points at `registerWriteInterceptor` first (ADR-0040, shipped in 3.0.0): it is the
 * only mechanism that actually enforces an invariant across every write path, which is what a
 * write-method override looks like it does and does not. The facade stays as the fallback, because
 * it is still the right answer when the invariant needs composition or a narrowed public surface
 * rather than an atomic sibling write.
 *
 * The warning itself stays: interceptors add a correct path, they do not remove the wrong one.
 */
export function formatWriteOverrideWarning(
  className: string,
  overridden: readonly RepositoryWriteMethod[],
): string {
  const details = overridden
    .map(name => {
      const bypasses = BYPASS_PATHS[name].join(', ');
      return `  - ${name}() is bypassed by: ${bypasses}`;
    })
    .join('\n');
  const displayName = className || '(anonymous subclass)';
  return (
    `[flintfire] ${displayName} overrides write method(s) that do not enforce an invariant across ` +
    `sibling write paths.\n${details}\n` +
    `Prefer repo.registerWriteInterceptor({ name, write }), which the repository guarantees runs in ` +
    `the same atomic boundary as every write above (or refuses the write) — or a facade that owns ` +
    `the write paths, when the invariant needs composition rather than an atomic sibling write. ` +
    `See "Enforced denormalization" in the docs. ` +
    `To silence this warning deliberately, set \`static suppressWriteOverrideWarning = true\` on the subclass.`
  );
}

/**
 * Emit at most one `console.warn` per subclass constructor when that class overrides one or more
 * write methods on its prototype chain.
 *
 * @param instance - The repository being constructed (`this` from the base constructor)
 * @param baseConstructor - The `FirestoreRepository` constructor function (identity short-circuit)
 * @param basePrototype - `FirestoreRepository.prototype` (walk stop)
 */
export function warnIfWriteMethodsOverridden(
  instance: object,
  baseConstructor: ConstructorIdentity,
  basePrototype: object,
): void {
  // `instance.constructor` is lib-typed as Function; narrow to the identity shape we actually use.
  const Ctor = instance.constructor as ConstructorIdentity;
  // Zero cost for plain FirestoreRepository instances (withSchema / subcollection / tx clones).
  if (Ctor === baseConstructor) return;
  // Documented opt-out for deliberate partial overrides (logging, etc.).
  if (Ctor.suppressWriteOverrideWarning === true) return;
  // Once per class per process — DI and runInTransaction construct many instances.
  if (warnedConstructors.has(Ctor)) return;

  const overridden = collectOverriddenWriteMethods(Ctor, basePrototype);
  if (overridden.length === 0) return;

  warnedConstructors.add(Ctor);
  console.warn(formatWriteOverrideWarning(Ctor.name, overridden));
}
