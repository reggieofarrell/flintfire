/**
 * Once-per-class warning when a subclass overrides a {@link FirestoreRepository} write method.
 *
 * Why this exists: overriding `update` / `create` / `delete` (etc.) compiles and looks like an
 * enforced invariant, but sibling write paths do not self-delegate through the override. The
 * constructor-time check catches the common prototype/method override shape; class-field and
 * ctor-body assignments are invisible until after `super()` returns (see issue #103).
 *
 * @see ADR-0043 — write-override warning (issue #103)
 * @see ADR-0040 — future choke-point extension for field-style overrides
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
 * `patch` is omitted from the `update` bypass list because `patch` delegates to `this.update`.
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
  bulkWrite: [
    'create()',
    'update()',
    'delete()',
    'bulkCreate()',
    'bulkUpdate()',
    'bulkDelete()',
    'query().update()',
    'query().delete()',
    '*InTransaction()',
    'recursiveDelete()',
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
  updateInTransaction: [
    'update()',
    'patch()',
    'upsert()',
    'bulkUpdate()',
    'query().update()',
    'bulkWrite()',
    'patchInTransaction()',
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
  return [...found].sort() as RepositoryWriteMethod[];
}

/**
 * Build the once-per-class warning string. Points at the facade pattern (the mechanism that works
 * today); when ADR-0040 interceptors ship, only the redirect half of this string needs editing.
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
    `Prefer a facade that owns the write paths (see "Enforced denormalization" in the docs). ` +
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
