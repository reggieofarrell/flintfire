# Issue #112 — Refuse a write-interceptor transaction nested inside one already open

**Implementer:** implementer (Cursor Cloud Agent, teammate, or a later session) · **Reviewer:**
owner / `implementation-review` skill · **Baseline:** `main` @ `510f595` (`feat(repository):
guarantee write interceptors run in the primary write's atomic boundary (#108) (#113)`) ·
**Branch:** `fix/issue-112-nested-transaction-guard` — already created and pushed with this plan on
it; check it out, do not cut a new one

**Issue:** [#112](https://github.com/reggieofarrell/flintfire/issues/112) — labels `enhancement`.
Not in ADR-0017's `#35–#41` parity/`v3.x` deferral set (that range tops out at `#41`; #112 is a
follow-up filed against ADR-0040 / #108, not an ADR-0017 item), so the ADR-0017 amendment
blockquote and living-index-footer bookkeeping do **not** apply (§9.1). It is not labeled `bug`
either — it is a follow-up enhancement to ADR-0040 that closes a hazard #108 knowingly shipped
undefended, filed from that PR's own "could-not-verify" note.

> **Acceptance (verbatim from the issue):** "Whatever is chosen, the guide's caution block should
> be updated or removed to match."

> **Owner decision on direction (asked live before this plan was written, not verbatim from the
> issue):** of the three directions the issue poses — ambient transaction context (join), detect
> and throw, or docs-only — the owner chose **detect and throw**. This plan implements only that
> direction; §1 records the fork and the rejected alternatives with the evidence gathered before
> asking.

---

## §0 How to use this plan

1. Read §1 (settled — do not re-litigate) and §4 (traps) **before** writing code.
2. §6 is copy-verbatim and was compile-checked as a **scoped prototype** — the exact edit, `tsc`
   only, then reverted (no gate, no tests, no JSDoc written against it) — recorded in §12.
   `prototype.patch`, beside this file, is that reverted diff; every symbol in it still needs the
   real JSDoc `PLAN.md` describes in §6 (the patch's own comments are `PROTOTYPE (#112)` markers,
   not the real thing). §7 is the ordered build sequence, §8 the tests, §9 docs/ADR, §10 the gate,
   §11 done, §12 the planner's own verification record.
3. Every claim in §3 was produced by an executed probe on this baseline. Probes are in
   `docs/plans/issue-112-nested-transaction-guard/probes/` — re-run them if you doubt one. **Do not
   trust the issue body over §3** (in this case the issue body's own analysis held up under
   verification — there is no contradiction to flag — but re-verify rather than assuming that from
   this sentence).
4. Two probes need a *live* copy to run (jest's `testMatch` only picks up files under
   `src/tests/unit/` or `src/tests/integration/`) — each probe file's header says exactly where to
   copy it and what to delete afterward. Do not leave a copy under `src/` when you are done; the
   permanent versions are the promoted tests in §8, added directly to the existing suite files.
5. **Follow the `plan-execution` skill** — it owns the implementer's contract: `notes.md` written
   as you go, the mutation checks, and the independent refute-first self-review you must pass
   before declaring this ready for external review.

---

## §1 Owner-approved decisions

| Id     | Fork | Decision | Rejected alternative and why |
| ------ | ---- | -------- | ----------------------------- |
| **D1** | Which of the issue's three directions to implement | **Detect and throw.** Track whether a transaction is already open (per `Firestore` instance) and refuse a transaction-mode write that would nest a second one, naming the interceptor(s) that forced the mode and pointing at the `*InTransaction` helpers. | **Ambient context (join)** — rejected: needs the same detection *plus* cross-repository read-before-write reordering, handling an ambient `readOnly` transaction colliding with a write, and staging into a `Transaction` object the callee never opened — a materially larger and riskier change to a database library, for ergonomics rather than correctness. **Docs only** — rejected: leaves the hazard live; the caution block already exists and the issue was filed specifically because a doc block is not a defense. |
| **D2** | How broadly to scope "already in a transaction" | **Same `Firestore` instance only**, not "any transaction anywhere." Compare the ambient marker's `Firestore` object identity against `this.db` before refusing. | **Global (any db)** — rejected (derived, not asked, but flagged here because it is the kind of silent over-refusal a reasonable implementer reaches for by default): a multi-database application legitimately nesting unrelated transactions on two different `Firestore` instances has no contention risk and would be blocked for no reason. The reported hazard (ADR-0040 Decision 7 footgun) is specifically about the **same** instance; ADR-0040 already draws the identical instance-identity line for interceptor write targets ("Every target must be on the same Firestore instance", `patterns.md`). |
| **D3** | Whether explicit (user-authored) nested `runInTransaction` calls should also be refused | **No — out of scope.** Only the *silent, interceptor-forced* promotion this ADR introduced is refused. An explicit `repoA.runInTransaction(() => repoB.runInTransaction(...))` is unchanged. | **Refuse all nested transactions** — rejected (derived, not asked): that is a materially larger behavior change to a well-understood, pre-existing Firestore pattern that predates ADR-0040 and #108 entirely; the issue's own title and "Why it is not fixed in #108" section scope the hazard to the interceptor-forced case specifically. Widening it is real scope creep flagged for the owner rather than assumed — see the note after this table. |
| **D4** | ADR bookkeeping shape | **Amendment blockquote inside ADR-0040** (in its voice, after Decision 7), not a new superseding ADR. | A **new ADR** — rejected: `docs/adr/README.md`'s general "immutable once Accepted, supersede with a new ADR" convention would suggest this, but ADR-0040 itself already amends its own Decisions 1 and 3 in place for #108's refinements (the `set` verb, the duplicate-name refusal) rather than superseding — and the `implementation-planning` skill's own bookkeeping map calls this exact case ("an earlier ADR's decision is refined") an Amendment block. Following the ADR's own established precedent over the general convention is the smaller, more consistent choice. |

**On D3 — flagging it explicitly rather than assuming:** the issue is titled "Write interceptors in
transaction mode make nested transactions easy to hit" and its "Why it is not fixed in #108"
section reasons entirely about the interceptor-forced case; nothing in the issue asks for general
nested-transaction detection. D3 is therefore read directly from the issue's own scope, not an
independent owner call — flagged here only so the implementer does not "improve" it by widening the
throw to explicit nesting, which §4 T4 and §8 U-8f exist to catch.

---

## §2 Scope

### In scope

| Area | Change |
| ---- | ------ |
| `src/core/FirestoreRepository.ts` | New module-level `AsyncLocalStorage<Firestore>` marker; wrap both `db.runTransaction(...)` call sites to set it; new private `assertNoAmbientTransaction` guard called from the interceptor-forced transaction branch. |
| `src/tests/unit/writeInterceptors.unit.test.ts` | New `describe` block, U-8a–U-8g (§8.1). |
| `src/tests/integration/repository-write-interceptors.integration.test.ts` | Two new tests, I-16–I-17 (§8.2), continuing the file's existing `I-` numbering from I-15. |
| `docs/adr/0040-repository-write-interceptors.md` | Amendment blockquote after Decision 7 (§9.2). |
| `website/src/content/docs/guides/advanced/patterns.md` | Rewrite the existing `:::caution[...]` block (lines 678–695) that names #112 (§9.3). |
| `website/src/content/docs/reference/scope-and-capabilities.md` | One clause added to the write-interceptors row (§9.3). |

### Explicitly out of scope

- **The ambient-context/join direction** — D1. Belongs to a future issue only if the owner later
  wants it; not opened as a follow-up here because it was a deliberately rejected alternative, not
  a deferred piece of this one.
- **Refusing explicit nested `runInTransaction` calls with no interceptor involved** — D3.
- **Any change to `src/core/QueryBuilder.ts` or `src/core/CollectionGroup.ts`** — neither calls
  `db.runTransaction` (N1, §3.1); the fixed-batch/query-builder write terminals already refuse a
  read-capable interceptor outright (ADR-0040 Decision 4), so they cannot reach the promoted
  transaction branch this guard sits in front of.
- **`src/express/index.ts` status-code mapping** — the new throw is a plain `Error`, matching every
  existing write-interceptor refusal (`assertNoWriteMetadataUnderTransactionMode`,
  `assertNoReadCapableInterceptor`, `assertNoInterceptorsRegistered`, `assertNoBulkHooksRegistered`
  — N2, §3.1); none of those are specially mapped either, so this is not a "new error class" per
  the docs-bookkeeping map and needs no `Errors.ts` / `ErrorParser.ts` / express changes.
- **`docs/development/testing.md` and the other testing-docs-sync targets** — no new test
  infrastructure (harness, factory, mock module, coverage-gate matcher) is added; only new test
  *cases* inside two existing files. The testing-docs-sync rule triggers on "add, rename, move, or
  delete test infrastructure," which this is not.

### Scope correction

None found. The issue's own technical analysis ("Why it is not fixed in #108", the code excerpt)
matches the current tree exactly — re-verified in §3, not assumed from the issue body.

---

## §3 Verified facts

### 3.1 Blast radius and refusal-style precedent — `probes/enumerate-runTransaction-sites.sh`

| Id  | Expression / condition | Observed | Note |
| --- | ----------------------- | -------- | ---- |
| P1  | `grep -rn "\.runTransaction(" src/core/*.ts` | Exactly 2 code matches, both in `FirestoreRepository.ts`: line 4846 (`runInterceptedWrite`'s transaction-mode branch — the promoted write) and line 5125 (`runInTransaction`'s own `db.runTransaction` call). A 3rd match at line 5049 is a JSDoc comment, not code. | The blast radius is fully enumerable by reading; no prototype was needed to *find* the sites (only to compile-check the fix — §12). |
| N1  | Same grep restricted to `QueryBuilder.ts` / `CollectionGroup.ts` | 0 matches in either file | Confirms the "deliberately not changed" entries below. |
| N2  | `grep -n "throw new Error" src/core/FirestoreRepository.ts` near every existing write-interceptor refusal (`assertNoWriteMetadataUnderTransactionMode:4798`, `assertNoReadCapableInterceptor:4751`, `assertNoInterceptorsRegistered:4770`, `assertNoBulkHooksRegistered:3735`) | All four throw a plain `new Error(...)`, none is a subclass of the custom classes in `Errors.ts` | Establishes the precedent this plan's new guard follows — a plain `Error`, not a new error class. |
| N3  | `grep -n "status(" src/express/index.ts` | 8 status branches, none keyed to any of the N2 messages | Confirms none of the existing plain-`Error` interceptor refusals get special HTTP-status treatment either; the new one needs none. |

### 3.2 The mechanism, mocked — `probes/nested-transaction-guard.unit.probe.ts`

Ran with `prototype.patch` applied, copied into `src/tests/unit/_scratch112.unit.test.ts`:
`npx jest --config jest.config.unit.js src/tests/unit/_scratch112.unit.test.ts` → **5 passed, 0
failed** on the first run only after fixing one bug in the *probe itself* (a missing `return` on
the outer callback in the "explicit nesting is unchanged" case, which made the assertion check the
wrong thing — not a defect in the guard; see the probe file's inline history if curious). All five
scenarios below are asserted, not reasoned about:

| Id   | Scenario | Result |
| ---- | -------- | ------ |
| P2   | Cross-repository plain write, same `db`, inside another repo's `runInTransaction` | Throws, message matches `/already open/` |
| P3   | Same scenario using `updateInTransaction` (joining) instead of `update` | Resolves, no throw |
| P4   | Transaction-mode write called standalone, no ambient transaction | Resolves, no throw |
| P5   | Explicit nested `runInTransaction` (repo-to-repo), no interceptor forcing a promoted write inside it | Resolves to the inner callback's own return value, no throw — confirms D3 |
| P6   | The **same** repository's tx-clone (`txRepo` handed to the callback) calling its own plain `update()` instead of `updateInTransaction` | Throws, message matches `/already open/` — confirms T2 (§4) is real, not hypothetical |

### 3.3 The mechanism against real Firestore, including a genuine retry — `probes/nested-transaction-guard.integration.probe.ts`

Ran the same way against the emulator (`firebase emulators:exec --project
demo-firestoreorm-test --only firestore "npx jest --config jest.config.integration.js
src/tests/integration/_scratch112.integration.test.ts"`) → **2 passed, 0 failed**:

| Id  | Scenario | Result |
| --- | -------- | ------ |
| P7  | Cross-repository nesting against the real Admin SDK (not the unit mock) | Throws, `/already open/` |
| P8  | Two concurrent `runInTransaction` calls contending on the same document, forcing a genuine SDK retry; the nested write is attempted on **every** attempt | `attempts >= 2` (confirms a real retry happened) and the nested write threw on both attempts | This is the fact evidence-rule-7 exists for: reading the SDK source cannot tell you whether `AsyncLocalStorage`'s context survives across the Admin SDK's internal retry-and-reinvoke loop. It does, because the whole `db.runTransaction(...)` call — including every retry — runs inside the single synchronous callback passed to `AsyncLocalStorage.run(...)`, which is the scope ALS attaches to. |

### 3.4 Authoritative site enumeration (`main` @ `510f595`)

| File | Lines | Change |
| ---- | ----- | ------ |
| `src/core/FirestoreRepository.ts` | 1 | Add `import { AsyncLocalStorage } from 'node:async_hooks';` before the existing `firebase-admin/firestore` import block |
| `src/core/FirestoreRepository.ts` | 634 (after `EMPTY_INTERCEPTOR_READS`) | Add module-level `const activeTransactionDb = new AsyncLocalStorage<Firestore>();` |
| `src/core/FirestoreRepository.ts` | 4845–4846 | Insert `this.assertNoAmbientTransaction(operation);` before the existing `assertNoWriteMetadataUnderTransactionMode` call; wrap the `db.runTransaction(...)` call in `activeTransactionDb.run(this.db, () => ...)` |
| `src/core/FirestoreRepository.ts` | after line 4862 (end of `runInterceptedWrite`) | New private method `assertNoAmbientTransaction` |
| `src/core/FirestoreRepository.ts` | 5125, 5147/5183 | Wrap `runInTransaction`'s `db.runTransaction(...)` call the same way |

**Deliberately NOT changed:**

- `src/core/QueryBuilder.ts`, `src/core/CollectionGroup.ts` — N1: neither opens a transaction, so
  neither can reach the guarded branch.
- `src/core/Errors.ts`, `src/core/ErrorParser.ts`, `src/express/index.ts` — N2, N3: the new throw
  follows the established plain-`Error` precedent for interceptor refusals; none of those four
  siblings gets a custom class or a status mapping either.
- `src/index.ts` and `src/vector/index.ts` — no new exported symbol; `AsyncLocalStorage` and the new
  private method are both internal (confirmed by the declaration-emit check in §12 — neither
  appears in the emitted `.d.ts` at all).
- The `assertNoWriteMetadataUnderTransactionMode` check itself — unchanged, still runs after the new
  guard (order chosen so the more fundamental "you cannot even open this transaction" error surfaces
  before the `withMetadata` one when both conditions happen to be true; this is a UX ordering choice
  with no correctness consequence either way).

### 3.5 Gate headroom (integration gate owns `FirestoreRepository.ts`)

Measured from `coverage/integration/lcov.info` via `node scripts/check-coverage-gates.mjs --suite
integration`, on the unmodified baseline:

| Gate | lines (thr.) | branches (thr.) | functions (thr.) | Slack |
| ---- | ------------ | ---------------- | ------------------ | ----- |
| FirestoreRepository (emulator) | 98.37% (90%) | 93.51% (75%) | 95.12% (85%) | 8.37 / 18.51 / 10.12 points |

Substantial headroom on every dimension; the new guard method, its one new branch (`activeDb ===
undefined || activeDb !== this.db`), and the two wrap sites are exercised by U-8a–U-8g and I-16–I-17
(§8), so no gate risk is expected. This is measured, not reasoned about — re-run the same command
after adding the tests and compare.

---

## §4 Traps

Ordered by how badly a reasonable implementer gets them wrong.

### T1 — Wrapping only the *inner* `db.runTransaction` call, not the outer one, makes the fix do nothing for the issue's own example (P1, P7)

The issue's example is `orderRepo.runInTransaction(async (tx, orders) => { ... await
userRepo.update(...) })` — the **outer** call is the public `runInTransaction()` method (line
5125), not the interceptor-forced branch (line 4846). If the ambient marker is only set at line
4846 (because that call site is the one obviously "about" this issue), the marker is never set for
the outer, ordinary transaction the issue's own example opens, and the guard at line 4846 never
fires for the reported scenario — while still passing any test that happens to nest the promoted
branch inside *itself*. This fails **silently**: no compile error, and a test suite that only checks
the inner site (missing I-16, which specifically nests inside the *outer* `runInTransaction`) would
not catch it. Both `db.runTransaction` call sites must be wrapped (§6, §3.4).

### T2 — The tx-clone handed to a `runInTransaction` callback still has plain write methods, and calling them now throws too (P6)

`runInTransaction`'s callback receives `txRepo`, a **clone** of the calling repository, not a
different object with a restricted surface — `txRepo.update(...)` (plain) and
`txRepo.updateInTransaction(tx, ...)` are both callable, and only the second one is the "correct"
usage. An implementer reasoning about this fix purely in terms of "repository A calling into
repository B" will correctly guard the cross-repository case and may not realize the identical
hazard exists when a caller mistakenly uses the tx-clone's plain method on **itself** — which this
guard also (correctly) refuses, because it is still opening a second, independent transaction on
the same `Firestore` instance. U-8e / P6 exist specifically because this is easy to under-scope.

### T3 — Scoping the marker globally instead of per-`Firestore`-instance silently over-refuses (D2)

The straightforward implementation of "is a transaction open" is a bare boolean or `true` sentinel
in the `AsyncLocalStorage`, not a `Firestore` reference. That passes every test in this plan (all of
them use one `db`), so nothing here catches a global implementation directly — but it is wrong: it
would refuse a legitimate nested transaction on a **second, unrelated** `Firestore` instance, which
has no contention risk. Store and compare the `Firestore` instance (`activeTransactionDb.run(this.db,
...)`, checked via `activeDb !== this.db`), not a boolean.

### T4 — Widening the check to explicit nested `runInTransaction` calls is scope creep, not a bug fix (D3, P5, U-8f)

It is tempting to reason "nesting two independent transactions is bad, full stop" and make
`runInTransaction` itself refuse when the ambient marker is already set, regardless of whether an
interceptor forced anything. **Do not.** That changes behavior for a pattern that predates ADR-0040
and #108 entirely, is not what the issue asks for, and is a real behavior change for any caller
already doing deliberate multi-transaction orchestration. U-8f is the regression anchor: it must
keep passing.

---

## §5 Could not verify / bounds

- **Only one Node major and one `firebase-admin` major were exercised.** Everything in §3.2/§3.3 ran
  under the dev-installed `firebase-admin` (`^14.0.0` per `package.json` `engines`/devDependency)
  against Node 24.18.0. `AsyncLocalStorage` has been stable Node API since well before this
  project's `>=22.0.0` floor, and the mechanism does not touch `firebase-admin` internals at all
  (it wraps the call from the *outside*), so a cross-major behavior difference is very unlikely —
  but the `^12` / `^13` / pinned-firestore `check:consumer` legs (§10) were not run by this plan;
  only CI runs those.
- **The `{ readOnly: true }` outer-transaction case was reasoned about, not independently probed.**
  `runReadOnlyAt` and `runInTransaction(fn, { readOnly: true })` share the exact same wrapped
  `db.runTransaction` call site (line 5125) already probed in §3.3, so the ambient marker is set
  identically regardless of the `readOnly` option — there is no separate code path for it to miss.
  U-8h (§8.1) is specified as a cheap regression test for this rather than left silently assumed,
  but no probe run backs it beyond that code-path identity argument.
- **Production (non-emulator) Firestore was never exercised.** §3.3's retry probe rests on the
  emulator's contention behavior, consistent with every other integration test in this codebase.
- **The rejected ambient-context/join direction (D1) was not prototyped.** Its cost estimate in §1
  is qualitative (based on reading `stageInterceptedWrite`'s existing read-before-write-ordering
  logic and reasoning about what generalizing it to an *implicit* caller would require), not
  measured. If a future issue revisits that direction, do not treat this plan's cost comparison as
  load-bearing evidence — it was a decision input, not a spec.

---

## §6 API specification

### 6.1 `src/core/FirestoreRepository.ts` — ambient transaction marker + guard

Import (top of file, before the existing `firebase-admin/firestore` import block):

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
```

Module-level marker (immediately after `EMPTY_INTERCEPTOR_READS`, line 634):

```ts
/**
 * Ambient record of the `Firestore` instance whose transaction is currently open, scoped to the
 * async call chain by {@link AsyncLocalStorage} — set only around the SDK's own
 * `db.runTransaction(...)` calls (both in {@link FirestoreRepository.runInTransaction} and in the
 * write-interceptor-forced branch of {@link FirestoreRepository.runInterceptedWrite}), and checked
 * by {@link FirestoreRepository.assertNoAmbientTransaction} before a transaction-mode write would
 * open a SECOND, independent transaction on the same instance (issue #112).
 *
 * Scoped to the `Firestore` instance, not a bare boolean, so that nesting a transaction on a
 * genuinely different `Firestore` instance — which carries no contention risk — is not refused
 * (T3, D2).
 */
const activeTransactionDb = new AsyncLocalStorage<Firestore>();
```

New private method (placed directly after `runInterceptedWrite`, i.e. after its current closing
brace at line 4862 — see `prototype.patch` for the exact location):

```ts
/**
 * Refuses a transaction-mode write when a transaction is already open on the SAME `Firestore`
 * instance, rather than silently opening a second, independent one (ADR-0040 Amendment, issue
 * #112).
 *
 * The hazard: a read-capable interceptor promotes every single-document write on its repository to
 * `db.runTransaction(...)` (ADR-0040 Decision 7). Calling such a write from inside another
 * `runInTransaction` callback — including the SAME repository's own tx-clone calling a plain write
 * method instead of its `*InTransaction` counterpart (T2) — would otherwise nest two independent
 * transactions, which can contend or deadlock on overlapping documents.
 *
 * Deliberately scoped to the same `Firestore` instance (T3) and to this promoted-write branch only
 * — an explicit, interceptor-free `runInTransaction` nested inside another one is unchanged (T4);
 * this refusal targets only the silent promotion ADR-0040 introduced.
 */
private assertNoAmbientTransaction(operation: string): void {
  const activeDb = activeTransactionDb.getStore();
  if (activeDb === undefined || activeDb !== this.db) return;
  const forcing = this.interceptors
    .filter(interceptor => typeof interceptor.read === 'function')
    .map(interceptor => `'${interceptor.name}'`)
    .join(', ');
  throw new Error(
    `${operation} cannot run: write interceptor(s) ${forcing} declare a read phase, so this ` +
      'write needs its own transaction, but one is already open on this Firestore instance. ' +
      'Nesting a second, independent transaction inside the first can contend or deadlock on ' +
      'overlapping documents. Use the *InTransaction helpers to join the transaction you are ' +
      'already in.',
  );
}
```

Call site 1 — `runInterceptedWrite`'s transaction branch (line 4845, right before the existing
`assertNoWriteMetadataUnderTransactionMode` call), and wrap the `db.runTransaction` call itself:

```ts
this.assertNoAmbientTransaction(operation);
this.assertNoWriteMetadataUnderTransactionMode(options, operation);
await activeTransactionDb.run(this.db, () =>
  this.db.runTransaction(async tx => {
    // ALL reads before ANY write — Firestore rejects a read staged after a write in the same
    // transaction, and this ordering is the whole reason `write` phases are synchronous.
    const reads = await this.runInterceptorReads(intercepted, tx);
    const target = tx as StagingTarget;
    stage(target);
    for (const stageInterceptor of this.collectInterceptorWrites(intercepted, reads)) {
      stageInterceptor(target);
    }
  }),
);
return undefined;
```

Call site 2 — `runInTransaction`'s own `db.runTransaction` call (line 5125, closing paren moves from
line 5183 to wrap the whole call — see `prototype.patch` for the byte-exact diff, since the callback
body between these two lines is 30+ lines long and unchanged):

```ts
return await activeTransactionDb.run(this.db, () =>
  this.db.runTransaction(async tx => {
    // ...unchanged callback body...
  }, options),
);
```

**How this was compile-checked:** applied verbatim to `src/core/FirestoreRepository.ts` (not a
scratch file elsewhere — this code's types depend on the surrounding class members), ran `npm run
test:types` → clean, then reverted (`git checkout -- src/core/FirestoreRepository.ts`). Recorded in
§12. `prototype.patch` is that exact diff, marked `PROTOTYPE (#112)` in its two comments — replace
both with the real JSDoc above; the patch's comments are placeholders, not what ships.

### 6.2 Size

1 file changed in `src/core/`, +~35 lines (import, marker + JSDoc, guard method + JSDoc, two call-site
edits); 2 test files changed, +~130 lines across both; 1 ADR amendment (~15 lines); 2 website pages
(~20 lines changed). No public API signature changes — every new symbol is unexported. Runtime
behavior change: a `Error` is now thrown in a scenario that previously proceeded (silently opening a
second transaction) — see §10 for the breaking-or-not ruling.

---

## §7 Implementation sequence

1. Check out `fix/issue-112-nested-transaction-guard` — it already exists and carries this plan. If
   `main` has moved past `510f595`, rebase onto it and **re-run §3.1's probe and re-verify every
   line number in §3.4 before editing anything** — this file has exactly two `db.runTransaction`
   call sites today; if that count changed, stop and re-plan rather than guessing which one is new.
2. Apply §6.1 to `src/core/FirestoreRepository.ts` (or `git apply
   docs/plans/issue-112-nested-transaction-guard/prototype.patch` and then replace both `PROTOTYPE
   (#112)` comments with the real JSDoc from §6.1 — do not ship the placeholder comments).
3. Add the JSDoc to `activeTransactionDb`'s call sites is already covered by the surrounding method
   JSDoc; no further doc placement needed.
4. Write the tests (§8) **before** confirming the gate — verify each new test fails on the unfixed
   baseline (temporarily revert just the `src/core/FirestoreRepository.ts` change with `git stash
   push -- src/core/FirestoreRepository.ts`, run the new tests, confirm they fail, `git stash pop`).
5. Docs + ADR (§9). Order matters here only in that the ADR amendment and the `patterns.md` rewrite
   should land in the same commit as the code change — do not split them across commits.
6. Full gate (§10), `prettier --write` if `check:format` flags anything, `notes.md`. Leave the plan
   directory in place for review — the cleanup commit that removes it comes after.

### Anti-instructions

- **Do not** scope the ambient marker as a bare boolean (T3) — it must carry and compare the
  `Firestore` instance.
- **Do not** wrap only one of the two `db.runTransaction` call sites (T1) — both, or the fix does
  nothing for the issue's own reported scenario.
- **Do not** make `runInTransaction` itself refuse when nested (T4, D3) — only the interceptor-forced
  branch gets the new guard call.
- **Do not** implement the ambient-context/join direction "while you're in there" — D1 already
  settled this; it is a materially different, larger change and was explicitly rejected.
- **Do not** ship the `PROTOTYPE (#112)` comments from `prototype.patch` verbatim — replace both
  with the real JSDoc in §6.1.
- **Do not** edit ADR-0040's existing prose (the Decision 7 paragraph, the "mode-union footgun"
  Consequences bullet) — add the Amendment blockquote after Decision 7 and leave the original text
  untouched (§9.2), matching how #108's own amendments were added.
- **Do not** touch `src/core/QueryBuilder.ts`, `src/core/CollectionGroup.ts`, `src/core/Errors.ts`,
  `src/core/ErrorParser.ts`, `src/express/index.ts`, or `src/index.ts` — none of them needs a change
  (§2, §3.4).
- **Do not** commit unless asked; leave the tree clean and report the subject line (§10).

---

## §8 Test specification

### 8.1 Unit — `src/tests/unit/writeInterceptors.unit.test.ts`

New `describe('write interceptors — nested transaction guard (U-8)', ...)` block, added after the
existing U-6 block. Reuses `createHarness()` already in this file (it already shares one `db`
between `repo` and `siblingRepo` — no harness change needed).

| Id   | Asserts | Observable when it fails | Guards |
| ---- | ------- | -------------------------- | ------ |
| U-8a | A plain write on a transaction-mode repository, called from inside a **different** repository's `runInTransaction` callback on the same `db`, throws naming "already open" | The call resolves instead of rejecting, or rejects with a different message | T1 |
| U-8b | The same scenario using `updateInTransaction(tx, ...)` instead of `update(...)` does **not** throw | The call rejects | (regression anchor — proves the fix does not over-refuse the documented correct usage) |
| U-8c | A transaction-mode write called standalone (no ambient transaction at all) does **not** throw | The call rejects | (regression anchor — additivity outside any transaction) |
| U-8d | A `mode: 'none'` or `mode: 'batch'` repository's write, called from inside another repo's `runInTransaction`, does **not** throw | The call rejects | (regression anchor — the guard only applies to the promoted-transaction branch) |
| U-8e | The **same** repository's tx-clone (`txRepo` from its own `runInTransaction` callback) calling its own plain `update()` throws naming "already open" | Resolves instead of rejecting | T2 |
| U-8f | An explicit nested `runInTransaction` (repo-to-repo, no interceptor promotion inside it) does **not** throw, and the inner callback's return value propagates | Rejects, or the outer resolves to the wrong value | T4, D3 |
| U-8g | The thrown error's message names exactly the read-capable interceptor(s) that forced the mode (mirrors `assertNoWriteMetadataUnderTransactionMode`'s existing message-content assertions in U-5) | Message omits the interceptor name, or names a write-only one | (message-quality regression anchor) |
| U-8h | An outer `runInTransaction(fn, { readOnly: true })` also sets the ambient marker — nesting a promoted write inside a read-only outer transaction throws the same way | Resolves instead of rejecting | §5 bound — cheap regression test for a case reasoned about, not independently probed |

### 8.2 Integration — `src/tests/integration/repository-write-interceptors.integration.test.ts`

Two new tests, continuing the file's `I-` numbering from I-15 (see the file's header JSDoc, which
lists I-1 through I-15 — add I-16/I-17 to that list too, §9 note below).

| Id   | Asserts | Observable when it fails | Guards |
| ---- | ------- | -------------------------- | ------ |
| I-16 | Same as U-8a, against the real emulator (not the unit mock) | Resolves instead of rejecting | T1 — closes the gap a mock cannot: proves the real `Firestore.runTransaction` participates correctly in the `AsyncLocalStorage` context |
| I-17 | Two concurrent `runInTransaction` calls contending on the same document force a genuine SDK retry (`attempts >= 2`), and the nested write throws on **every** attempt, not just the first | `attempts < 2` (no real retry happened — probe setup issue) or the guard fails to throw on a later attempt | Confirms the marker's scope is the whole outer `db.runTransaction` call including retries, not just the first invocation of the callback |

### 8.3 Trap coverage — the inverse direction

| Trap | Site | Falsifying test | What it observes |
| ---- | ---- | ---------------- | ------------------- |
| T1 | Missing the wrap at the *outer* `runInTransaction` call site (line 5125) | U-8a, I-16 | Both nest the promoted write inside the **outer, public** `runInTransaction` call — exactly the issue's own example — so a fix that only wraps the inner site (line 4846) fails both |
| T2 | The tx-clone's own plain write inside its own `runInTransaction` | U-8e | Directly exercises `txRepo.update(...)` (not `.updateInTransaction`) from inside `siblingRepo.runInTransaction(...)`'s own callback |
| T3 | Marker scoped globally instead of per-`Firestore`-instance | None in this plan — no test uses two `Firestore` instances | **Named gap, not silently assumed**: §5 does not list this because it is a design constraint enforced by code review and the JSDoc's stated invariant, not something worth a second `Firestore` mock purely to prove a negative that the type signature (`AsyncLocalStorage<Firestore>`, not `<boolean>`) already makes structurally hard to get wrong by accident. If you want to close this gap anyway, a second `db` object in the unit harness with an unrelated repository is the way to do it — not required by this plan. |
| T4 | Widening the throw to explicit nested `runInTransaction` | U-8f | Directly exercises the explicit-nesting case with no interceptor forcing a promoted write inside it, and asserts it still resolves |

### 8.4 Coverage gates

| Changed path | Gate |
| ------------- | ---- |
| `src/core/FirestoreRepository.ts` | Integration (`test:coverage:gate:integration`) — per `.claude/rules/test-awareness.md`'s ownership table |

Measured headroom is in §3.5 — do not re-reason about gate risk, re-measure after adding the tests.

---

## §9 Docs and ADR bookkeeping

### 9.1 Bookkeeping that does **not** apply

- **ADR-0017 amendment blockquote / living-index footer** — #112 is not in ADR-0017's `#35–#41`
  set (confirmed: `grep -n "112" docs/adr/0017-v3-core-operations-scope.md` → 0 matches) and
  ADR-0040 carries no living-index footer itself (confirmed: `grep -n "have since shipped"
  docs/adr/0040-repository-write-interceptors.md` → 0 matches).
- **New error class bookkeeping** (`Errors.ts` / `ErrorParser.ts` / `src/express/index.ts` status
  mapping) — not a new error class; see §2/§3.1 N2/N3.
- **`docs/development/testing.md` / testing-docs-sync targets** — no new test infrastructure; see
  §2.
- **`readme-sync`** — grepped both `README.md` and `npm-readme.md` for "interceptor" and
  "transaction". `npm-readme.md`: 0 matches. `README.md:34` matches "transaction" once, in the
  top-level feature list ("...chainable query builder, transaction helpers, subcollection
  support...") — a generic mention of transaction support, not write interceptors or this specific
  nested-transaction hazard. Neither README mentions write interceptors at all, and this generic
  line needs no change for this issue.
- **`reference/repository.md`** — grepped for "nested", "second", "already inside a transaction":
  0 matches. It documents `registerWriteInterceptor` and `runInTransaction`'s signatures but never
  duplicated the nested-transaction caution block or the coverage table that lives in
  `patterns.md`, so there is nothing there to update.
- **`docs/reference/scope-and-capabilities.md`'s row does need one clause added** — see §9.3, not a
  "does not apply" item; listed here only to flag that it was checked, not skipped.

### 9.2 ADR amendment — `docs/adr/0040-repository-write-interceptors.md`

Insert immediately after Decision 7's paragraph (after the sentence ending "...must name the
interceptor that forced the mode." — current line 148) and before Decision 8:

```markdown
   > Amendment (3.0.0, issue #112): the mode-union footgun this decision creates — a read-capable
   > interceptor silently promoting every single-document write on a repository to its own
   > transaction — is now refused rather than only documented. The repository tracks, via
   > `AsyncLocalStorage`, which `Firestore` instance currently has a transaction open on the calling
   > async chain, checked right before the promoted branch would open a second one. A
   > transaction-mode write that would nest a second, independent transaction on the **same**
   > instance while one is already open throws, naming the interceptor(s) that forced the mode and
   > pointing at the `*InTransaction` helpers. Scoped to the same `Firestore` instance only —
   > nesting on a genuinely different instance carries no contention risk and is not refused.
   > Explicit nested `runInTransaction` calls with no interceptor promotion involved are unchanged:
   > this refusal targets only the silent promotion this ADR introduced, not general transaction
   > nesting, which predates this ADR and is a separate, already-understood pattern. See
   > [issue #112](https://github.com/reggieofarrell/flintfire/issues/112).
```

Do not edit the Decision 7 paragraph itself, and do not edit the "mode-union footgun" bullet under
Consequences → "Harder / costs" — both stay as historical snapshots, matching how #108's own
amendments (under Decisions 1 and 3) left the original prose untouched.

No change to `docs/adr/README.md`'s index table — ADR-0040's Status/Date/Title are unchanged by an
amendment (same convention #108 followed).

### 9.3 Website edits

| Page | Line | Change |
| ---- | ---- | ------ |
| `website/src/content/docs/guides/advanced/patterns.md` | 678–695 | Replace the `:::caution[Under transaction mode, do not call a plain write inside someone else's transaction]` block with the text below. |
| `website/src/content/docs/reference/scope-and-capabilities.md` | 49 | Insert one clause into the existing write-interceptors row, before the trailing "Additive: nothing changes until one is registered." sentence: `A transaction-mode write also throws instead of nesting a second transaction when one is already open on the same `Firestore` instance (issue #112).` |

Replacement caution block for `patterns.md` (note the blank line before the closing `:::` — the
skill's own warning about `:::` fences landing on a content line and rendering literally in the
built HTML applies here; verify with `npm run docs:build` and grep the output, per §10):

````markdown
:::caution[Under transaction mode, a nested write now throws instead of silently opening a second transaction]
A read-capable interceptor makes every single-document write on that repository open its own
transaction. Calling one from **inside** another repository's `runInTransaction` callback on the
**same** `Firestore` instance now throws, naming the interceptor that forced the mode, instead of
silently nesting two independent transactions:

```typescript
await orderRepo.runInTransaction(async (tx, orders) => {
  await orders.updateInTransaction(tx, id, { status: 'shipped' }); // ✅ joins this transaction
  await userRepo.update(userId, { lastOrderId: id });              // ❌ throws — nested transaction refused
});
```

This also fires when the write is on the **same** repository: the `orders` handed to your callback
above still has a plain `update()`, and calling it — instead of `updateInTransaction` — throws for
the identical reason. Use the `*InTransaction` helpers for every write inside a transaction
callback; they join the transaction you are already in rather than opening a second one. Resolved in
[#112](https://github.com/reggieofarrell/flintfire/issues/112) — previously this was documented
guidance only.

:::
````

After making this edit, run `npm run docs:build` and grep the built output for a leaked literal
`:::` (the skill's own §9 warning — this shipped live twice before, #33/#34):

```bash
npm run docs:build
grep -rn ':::' website/dist/guides/advanced/patterns/index.html
```

Expected result: **no matches** (a match means the closing fence landed on a content line and the
aside did not render).

### 9.4 READMEs

Checked, not affected — see §9.1.

### 9.5 Follow-up issue

None. D1's rejected alternative (ambient-context/join) is recorded in §1 for posterity; it is not
tracked as a follow-up because it was a deliberate rejection, not a deferred scope cut.

---

## §10 Gate and commit

```bash
npm run test:types && npm run lint && npm run check:format && npm run test:unit && npm run test:integration:emulator && npm run test:unit:coverage && npm run test:coverage:gate:unit && npm run test:integration:coverage && npm run test:coverage:gate:integration && npm run build && npm run check:package && npm run check:consumer && npm run check:docs && npm run docs:build
```

Fourteen legs. Report failures with output — never claim a leg passed that you did not execute.

**Baseline, measured on this plan's own baseline with a clean tree** (§12): unit **37 suites / 493
tests**, integration **38 suites / 611 tests**. Both counts must go up (U-8a–U-8h add 8 unit tests;
I-16–I-17 add 2 integration tests) — expect unit **37 suites / 501 tests**, integration **38 suites
/ 613 tests** (no new suite *files*, only new tests inside the two existing ones). Watch the
integration `FirestoreRepository (emulator)` coverage gate (§3.5) — it has 8+ points of headroom on
every dimension, so this should not be close.

Re-run the probes against the finished code (should still pass — they are what this plan's own
verification ran):

```bash
bash docs/plans/issue-112-nested-transaction-guard/probes/enumerate-runTransaction-sites.sh
```

(The other two probes are superseded once §8's tests are promoted into the real suites — no need to
re-copy them in; running the real suites covers the same ground.)

**Commit subject** (Conventional Commits; commitlint runs on `commit-msg`):

```
fix(repository): refuse a write-interceptor transaction nested inside one already open (#112)
```

`fix` rather than `feat`: the issue frames this as closing a correctness/safety hazard ("Write
interceptors in transaction mode make nested transactions easy to hit"), not adding a new
capability — the write-interceptor feature itself is unchanged; this closes a gap in it.

**Is it breaking?** **Not breaking.** It folds into the unreleased 3.0.0, same as ADR-0040 itself.
The only repositories that can observe any difference are ones that (a) have already registered a
read-capable write interceptor — new, unreleased API from #108 — **and** (b) are already calling a
plain write nested inside another transaction on the same `Firestore` instance, which was already a
documented anti-pattern (the very `:::caution` block this plan rewrites) that could silently
contend or deadlock. Such a caller now gets a loud, descriptive throw instead of a latent
concurrency hazard — a strict improvement, not a new restriction on any pattern the docs recommended.

---

## §11 Definition of done

| #   | Item |
| --- | ---- |
| 1   | §6.1 applied to `src/core/FirestoreRepository.ts`, with real JSDoc (not the `PROTOTYPE (#112)` placeholders from `prototype.patch`) |
| 2   | Both `db.runTransaction` call sites wrapped (T1) |
| 3   | U-8a–U-8h added to `writeInterceptors.unit.test.ts`; each verified to fail on the unfixed baseline (§7 step 4) |
| 4   | I-16–I-17 added to `repository-write-interceptors.integration.test.ts`, and its header JSDoc's I-1..I-15 list extended to include them |
| 5   | ADR-0040 amendment added after Decision 7 (§9.2); no other ADR-0040 prose edited |
| 6   | `patterns.md` caution block rewritten (§9.3); built HTML grep for stray `:::` comes back empty |
| 7   | `scope-and-capabilities.md` row updated (§9.3) |
| 8   | Nothing in the §7 anti-instruction list violated |
| 9   | Full gate green (§10) with real output; suite counts as predicted (or a reported, explained deviation) |
| 10  | `notes.md` committed: deviations, unverified items (§5), adversarial self-review |
| 11  | Both scratch probe copies deleted from `src/tests/unit/` and `src/tests/integration/` if they were ever recreated locally — only the permanent §8 tests remain |
| 12  | `git rm -r docs/plans/issue-112-nested-transaction-guard/` — this plan directory is removed in this PR, after review |

---

## §12 Pre-handoff verification

| Check | Command / method | Result |
| ----- | ------------------ | ------ |
| §6 blocks compile as written | Applied verbatim to `src/core/FirestoreRepository.ts`, `npm run test:types`, then `git checkout -- src/core/FirestoreRepository.ts` | Clean — 0 diagnostics |
| Every `from '…'` specifier §6 uses | Same compile — only new specifier is `node:async_hooks` (Node builtin) | Resolved; no package to declare |
| Declaration emit | `npx tsc --declaration --emitDeclarationOnly -p tsconfig.json --outDir /tmp/flintfire-dts-check` with the prototype applied, then `grep -n "activeTransactionDb\|assertNoAmbientTransaction\|AsyncLocalStorage" .../FirestoreRepository.d.ts` | `assertNoAmbientTransaction` appears as a bare `private assertNoAmbientTransaction;` (no signature, standard TS elision for private members with no `@internal`/`stripInternal` involvement); `activeTransactionDb` and `AsyncLocalStorage` do not appear at all — no undeclared package risk |
| Mechanism, mocked (§3.2) | `probes/nested-transaction-guard.unit.probe.ts`, prototype applied, copied into `src/tests/unit/`, run | 5/5 passed |
| Mechanism, real emulator incl. retry (§3.3) | `probes/nested-transaction-guard.integration.probe.ts`, prototype applied, copied into `src/tests/integration/`, run via `firebase emulators:exec` | 2/2 passed, retry confirmed (`attempts >= 2`) |
| Existing write-interceptor unit suite still green with the prototype applied | `npx jest --config jest.config.unit.js src/tests/unit/writeInterceptors.unit.test.ts` | 25/25 passed — additivity confirmed |
| Blast-radius enumeration (§3.1) | `probes/enumerate-runTransaction-sites.sh` | 2 code matches, both accounted for |
| Baseline suite counts | `npm run test:unit`; `firebase emulators:exec ... "npm run test:integration"` (clean tree, no prototype applied) | unit 37 suites / 493 tests; integration 38 suites / 611 tests |
| Gate headroom | `npm run test:integration:coverage` then `node scripts/check-coverage-gates.mjs --suite integration` (clean tree) | FirestoreRepository (emulator): lines 98.37%/90%, branches 93.51%/75%, functions 95.12%/85% — see §3.5 |
| ADR-0017 / living-index applicability | `grep -n "112" docs/adr/0017-v3-core-operations-scope.md` (0 matches); `grep -n "have since shipped" docs/adr/0040-repository-write-interceptors.md` (0 matches) | Neither applies — §9.1 |
| README applicability | `grep -n "interceptor\|transaction" README.md npm-readme.md` (checked separately) | `npm-readme.md`: 0 matches. `README.md:34`: one generic "transaction helpers" feature-list mention, unrelated to write interceptors — no change needed. See §9.1. |
| `reference/repository.md` applicability | `grep -n "nested\|second\|already inside a transaction" website/src/content/docs/reference/repository.md` | 0 matches — §9.1 |
| Unresolved conditionals | Re-read §§2–9 | None found |
| Trap coverage inverse walk | §4 against §8.3 | T1→U-8a/I-16, T2→U-8e, T4→U-8f; T3 named as a deliberate structural (not test) guard — see §8.3 |

---

## Appendix — probe inventory (`probes/`, beside this file)

| File | What it proves |
| ---- | ---------------- |
| `enumerate-runTransaction-sites.sh` | The blast radius is exactly 2 call sites (P1), and neither `QueryBuilder.ts` nor `CollectionGroup.ts` is affected (N1) |
| `nested-transaction-guard.unit.probe.ts` | The ALS-based guard mechanism produces the right behavior in all 5 mocked scenarios, including the same-repo tx-clone case (P2–P6) — promoted into U-8a/b/c/e/f |
| `nested-transaction-guard.integration.probe.ts` | The mechanism holds against real Firestore, including through a genuine contention retry (P7–P8) — promoted into I-16/I-17 |
