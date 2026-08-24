# ADR-0043: Once-per-class warning when a subclass overrides an unenforceable write method

- **Status:** Accepted
- **Date:** 2026-08-24
- **Deciders:** maintainer
- **Related:** Issue [#103](https://github.com/reggieofarrell/flintfire/issues/103);
  [ADR-0040](0040-repository-write-interceptors.md) (future choke point / field-style detection);
  [ADR-0042](0042-subclass-schema-argument-assembly.md) (subclass construction); website guide
  _Advanced patterns_ (Enforced denormalization); audit H1 @
  [`0ef66cb`](https://github.com/reggieofarrell/flintfire/blob/0ef66cb3888496d0959a82ec2068546265be5928/docs/audits/2026-08-23-website-docs-audit.md)

## Context

Subclassing `FirestoreRepository` and overriding a write method (`update`, `create`, `delete`, …)
compiles and looks like an enforced invariant. It is not. Sibling write paths do not self-delegate
through the override: only a minority of entry points reach a given override (roughly 2/9 update,
1/8 create, 1/7 delete on the audited matrix). `patch` is the notable exception — it delegates to
`this.update`, so an `update` override _is_ reached by `patch()`. Factory helpers (`withSchema`,
`subcollection`) and the transaction-scoped repo allocate a plain `FirestoreRepository`, dropping
subclass identity entirely.

Docs already warn against override-as-enforcement (PR #101 / patterns guide). TypeScript already
rejects _narrowing_ overrides via TS2416. The remaining hole is silent: a developer who overrides
anyway gets no runtime signal, and data can diverge through bypass paths. This ADR adds a guardrail
only — it does not restore subclass identity or introduce a write choke point (that is ADR-0040 /
#80).

## Decision

We will emit a **once-per-class `console.warn`** from the base constructor when a subclass overrides
one or more of the 19 public write methods:

1. **Constructor-time, method-shape only.** Walk prototypes between the subclass and
   `FirestoreRepository.prototype` for own properties named in `REPOSITORY_WRITE_METHODS`.
   Class-field and ctor-body assignments land on the instance after `super()` and remain a known
   blind spot until ADR-0040's write choke point can observe them.
2. **Keyed by constructor in a module-level `WeakSet`.** Zero cost for plain `FirestoreRepository`
   instances (identity short-circuit). Silent for method _additions_. At most one warn per class per
   process — DI and `runInTransaction` construct many instances.
3. **Static opt-out:** `static suppressWriteOverrideWarning = true` on the subclass (default `false`
   on the base for discoverability). No `NODE_ENV` / `process.env` gate — the library has no
   env-dependent behavior in `src/` today, and suppressing the warn in production is where a silent
   denorm miss is most expensive.
4. **Message** lists each overridden method with concrete bypasses, prefixes `[flintfire]`, names
   the static opt-out, and redirects to the facade / "Enforced denormalization" docs (not
   interceptors — ADR-0040 is still Proposed). When interceptors ship, only the redirect half of the
   string changes.
5. **Drift guard:** a type-test partitions `keyof FirestoreRepository` into Write ∪ NonWrite with
   asserted `Missing` / `Extra*` = `never`. The runtime const stays internal (not re-exported from
   `src/index.ts`).
6. **`BYPASS_PATHS.update` omits `patch()`** because `patch` delegates to `this.update`.

## Consequences

- First intentional `console.warn` in library `src/` (tests already spy console elsewhere).
- Subclasses that override write methods see stderr once per process; deliberate partial overrides
  set the static flag.
- After ADR-0040 ships, the warning remains useful — edit the redirect string; field-style detection
  can move to the choke point without removing this constructor check for method overrides.
- Additive / non-breaking: warn, do not throw or seal methods (would break `jest.spyOn`,
  `super.update()`, etc.).

## Alternatives considered

- **Gate on `NODE_ENV` / env var** — rejected: suppresses where the miss is most expensive;
  introduces the library's first env-dependent behavior.
- **Seal / throw / convert methods to arrows** — rejected in the issue: breaks legitimate patterns
  and remains defeatable.
- **Lazy-on-first-write now** — no single write choke point yet (`runUpdate` / `commitInChunks` have
  multiple call sites); deferred with field-style detection to ADR-0040.
- **Per-instance warn** — would flood stderr under DI / transactions.
- **Public barrel export of `REPOSITORY_WRITE_METHODS`** — docs-api-sync / packageExports cost for
  an internal classification list; type-test + relative unit imports suffice.
- **Module registry / Symbol opt-out** — more surface than a static flag on the subclass.

## References

- Issue [#103](https://github.com/reggieofarrell/flintfire/issues/103)
- Audit H1 @ commit `0ef66cb` (website docs audit)
- [ADR-0040](0040-repository-write-interceptors.md)
- [ADR-0042](0042-subclass-schema-argument-assembly.md)
- `src/core/writeOverrideWarning.ts`, `FirestoreRepository` constructor
- Website: Advanced patterns → Enforced denormalization / Custom repository methods
