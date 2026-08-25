# Issue #112 — Implementation notes (for adversarial review)

**Implementer:** Cursor Grok 4.5 (implement-plan) · **Branch:**
`fix/issue-112-nested-transaction-guard` · **Plan:**
`docs/plans/issue-112-nested-transaction-guard/PLAN.md` · **Baseline:** `main` @ `510f595`
(no rebase needed — `origin/main` still at the plan baseline; §3.4 line numbers re-verified via
`enumerate-runTransaction-sites.sh`: still exactly 2 code sites; after edits they sit at 4869 /
5190)

## Status

Done-pending-review. Shipped: ALS ambient marker + `assertNoAmbientTransaction` on the
interceptor-forced transaction branch; both `db.runTransaction` sites wrapped; U-8a–U-8h; I-16–I-17
(I-17 rewritten after self-review F1/F2); ADR-0040 Amendment after Decision 7; `patterns.md`
caution rewrite; `scope-and-capabilities.md` clause. Full §10 gate green twice (initial + after
self-review fixes). Plan directory left in place for review (§11.12 cleanup is post-review).

## Ambiguities resolved

None. §1 D1–D4 left no open forks for the implementer.

## Deviations from the plan

1. **Inline comments around the two wrap sites and the guard call** — brief WHY comments at the
   call sites (ordering vs withMetadata guard; T1 rationale on the outer wrap). No behavior or API
   deviation.

2. **§7 step 4 baseline-fail procedure** — used file-backup mutation checks (skill restore rule)
   rather than `git stash push -- src/core/...`. Same evidence: throwers fail when the guard or
   the outer wrap is removed; U-8f fails when nesting refusal is widened into `runInTransaction`.

3. **I-17 attempt metric / contention setup (post self-review)** — the plan's probe and §8.2
   sketch used a shared `attempts` counter + 25ms sleep. Adversarial review F1/F2 showed that is
   false-green-capable (two first attempts hit 2 with zero retries). Replaced with per-worker
   callback-entry counts + first-read barrier (same pattern as `repository-write-outcomes` I4).
   Still asserts the §8.2 property (guard on every attempt of a genuine retry); stronger than the
   plan's sketched metric.

## Files touched and why

| File | Change | Plan reference |
| ---- | ------ | -------------- |
| `src/core/FirestoreRepository.ts` | Import ALS; `activeTransactionDb`; wrap both `runTransaction` sites; `assertNoAmbientTransaction` | §6.1 |
| `src/tests/unit/writeInterceptors.unit.test.ts` | U-8a–U-8h + header bullet | §8.1 |
| `src/tests/integration/repository-write-interceptors.integration.test.ts` | I-16–I-17 + header list | §8.2 |
| `docs/adr/0040-repository-write-interceptors.md` | Amendment blockquote after Decision 7 | §9.2 |
| `website/.../patterns.md` | Rewrite nested-tx caution block | §9.3 |
| `website/.../scope-and-capabilities.md` | One clause on write-interceptors row | §9.3 |
| `docs/plans/.../notes.md` | This file | plan-execution skill |

## Edge cases / traps handled

| Trap | Handled by | Pinned by |
| ---- | ---------- | --------- |
| T1 — wrap only inner site | Both `db.runTransaction` sites wrapped in `activeTransactionDb.run` | U-8a, I-16 (mutation: unwrap outer → both fail) |
| T2 — tx-clone plain write | Same guard; same-db identity | U-8e |
| T3 — boolean / global marker | `AsyncLocalStorage<Firestore>` + `activeDb !== this.db` | Structural (named gap §8.3) |
| T4 — refuse all nesting | Guard only on promoted branch | U-8f (mutation: widen into `runInTransaction` → fails) |

## Tests added

| Id | Suite | Asserts | Guards |
| -- | ----- | ------- | ------ |
| U-8a | unit | nested promoted write throws `/already open/` | T1 |
| U-8b | unit | `updateInTransaction` joins, no throw | regression |
| U-8c | unit | standalone promoted write ok | regression |
| U-8d | unit | none/batch nested writes ok | regression |
| U-8e | unit | tx-clone plain `update` throws | T2 |
| U-8f | unit | explicit nested `runInTransaction` returns `'ok'` | T4/D3 |
| U-8g | unit | message names `'audit'` not `'mirror'`; contend/deadlock; `*InTransaction` | message quality |
| U-8h | unit | readOnly outer also sets marker | §5 bound |
| I-16 | integration | same as U-8a on emulator | T1 |
| I-17 | integration | per-worker max entries ≥ 2; guard throw count == entry count | ALS retry scope |

## Mutation checks

Restored via `/tmp/FirestoreRepository.ts.112.backup` (never `git checkout` on dirty tree).

| Test | Mutation | Result |
| ---- | -------- | ------ |
| U-8a, U-8e, U-8g, U-8h | Remove `assertNoAmbientTransaction` call | **Fails** — promises resolve / error is null |
| U-8a | Unwrap only outer `runInTransaction` ALS wrap (T1) | **Fails** — resolves instead of rejecting |
| U-8c, U-8f | Same outer-unwrap mutation | Still pass (inner wrap + no forced promotion) |
| U-8f | Refuse nested `runInTransaction` when ambient set (T4 widen) | **Fails** — `nested runInTransaction refused (mutation)` |
| I-16 (and I-17 via describe match) | Unwrap only outer ALS wrap | **Fails** — nested `update` resolves |

## Gate results

**Run 1 (initial implementation):** all 14 legs green.

| Leg | Result |
| --- | ------ |
| `test:types` | ✓ |
| `lint` | ✓ |
| `check:format` | ✓ (after `prettier --write` on the two test files) |
| `test:unit` | ✓ **37 suites / 501 tests** (was 37 / 493; +8 as predicted) |
| `test:integration:emulator` | ✓ **38 suites / 613 tests** (was 38 / 611; +2 as predicted) |
| `test:unit:coverage` + `gate:unit` | ✓ all unit gates passed |
| `test:integration:coverage` + `gate:integration` | ✓ FirestoreRepository lines 98.39% / branches 93.61% / functions 95.16% |
| `build` | ✓ |
| `check:package` | ✓ |
| `check:consumer` | ✓ local leg `firebase-admin@^14.0.0` (peer legs CI-owned) |
| `check:docs` | ✓ 207 doc files |
| `docs:build` | ✓; `grep ':::' website/dist/guides/advanced/patterns/index.html` → no matches |

**Run 2 (after self-review F1/F2/F3/F5 fixes):** all 14 legs green again; suite counts unchanged
37/501 and 38/613; no leaked `:::`.

## Anti-instructions checklist

| Anti-instruction | Confirmed |
| ---------------- | --------- |
| Do not scope marker as bare boolean | Yes — `AsyncLocalStorage<Firestore>` + identity compare |
| Do not wrap only one `runTransaction` site | Yes — both sites wrapped (`:4868`, `:5189`) |
| Do not make `runInTransaction` refuse when nested | Yes — guard only in promoted branch |
| Do not implement ambient-context/join | Yes — detect-and-throw only |
| Do not ship `PROTOTYPE (#112)` comments | Yes — real §6.1 JSDoc; `grep PROTOTYPE` empty |
| Do not edit ADR-0040 Decision 7 / Consequences prose | Yes — amendment blockquote only; Consequences bullet untouched |
| Do not touch QB / CG / Errors / ErrorParser / express / index | Yes — only `FirestoreRepository.ts` in `src/` |
| Do not commit unless asked | Yes |

## §11 audit

| §11 item | Result | Evidence |
| -------- | ------ | -------- |
| 1 §6.1 applied with real JSDoc | PASS | `src/core/FirestoreRepository.ts:636–649`, `:4880–4916` |
| 2 Both `runTransaction` sites wrapped | PASS | `:4868`, `:5189` |
| 3 U-8a–U-8h; fail on unfixed baseline | PASS | unit file U-8 block; mutation table above |
| 4 I-16–I-17 + header list | PASS | integration header lines 26–27; tests `:1733`, `:1757` |
| 5 ADR-0040 amendment only | PASS | `docs/adr/0040-…:150–162`; Decision 7 / Consequences unchanged |
| 6 `patterns.md` rewrite; no leaked `:::` | PASS | caution at `:678`; gate grep empty |
| 7 `scope-and-capabilities.md` clause | PASS | row at `:49` |
| 8 Anti-instructions | PASS | checklist above |
| 9 Full gate green; counts as predicted | PASS | Run 1 + Run 2 |
| 10 `notes.md` | PASS | this file (uncommitted until asked) |
| 11 No scratch probe copies | PASS | no `_scratch112*` under `src/tests/` |
| 12 Plan directory removal | deferred | post-review cleanup commit — skill forbids removing it now |

## Independent adversarial review

**Reviewer:** fresh `generalPurpose` subagent ([Adversarial review #112](a40d5865-8b6e-460d-beb4-fb51d998d6ad)) · **Reviewed:** uncommitted tree (diff, plan, tests — not these notes) · **Fixes in:** same uncommitted tree · **Verdict after fixes:** pass with fixes

Prompted to refute. Full review text stayed in-session; dispositions:

### Findings fixed

1. **F1 blocker — I-17 `attempts >= 2` false-green** — shared counter hits 2 on two first
   attempts with zero retries. Fixed: per-worker `callbackEntriesByWorker` +
   `max(... ) >= 2`, and `guardThrowsByWorker[i] === callbackEntriesByWorker[i]`.
2. **F2 major — sleep-based contention** — replaced 25ms sleep with first-read barrier
   (`bothFirstReads`), matching `repository-write-outcomes` I4.
3. **F3 minor — U-8g incomplete message pin** — added `/contend or deadlock/` and
   `/\*InTransaction helpers/` assertions.
4. **F5 nit — header omits U-8h** — unit file header now mentions readOnly (U-8h).

### Findings not treated as defects

- **F4 minor — T3 unpinned by tests** — plan §8.3 explicitly names this as a deliberate
  structural gap (type is `AsyncLocalStorage<Firestore>`, not `<boolean>`); not required by the
  plan. Left as named gap.

### Findings deferred

- None.

### Gate re-run after fixes

All 14 §10 legs green (Run 2 above). Suite counts unchanged.

## Could-not-verify

Carried from plan §5:

- Only Node 24.18.0 + installed `firebase-admin` exercised locally; `check:consumer` peer legs
  still CI-owned for `^12` / `^13` / pinned-firestore.
- Production (non-emulator) Firestore not exercised.
- Rejected ambient-context/join direction (D1) was not prototyped; cost estimate is qualitative.

U-8h (`readOnly` outer) is now a real regression test (no longer only reasoned about).

## Open questions for the reviewer

None — F4 (T3 second-db test) is available if the external reviewer wants it closed; the plan
explicitly left it structural.
