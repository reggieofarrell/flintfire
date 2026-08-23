# FlintFire 3.0.0 — execution notes

**Implementer:** Cursor Grok 4.6 · **Branch:** `release/3.0.0` · **Plan:**
`docs/plans/flintfire-v3-release/PLAN.md` · **Baseline:** `main` @ `dc625b6480408dcfdca2d901ba875981338e9fb2`

## Status

Phase 0–3 in progress as of 2026-08-23. Prep PR #94 is merged. GitHub repository is
`reggieofarrell/flintfire`. Environment `npm` exists. Branch `release/3.0.0` has
`chore(release): 3.0.0` plus `chore(release): stage 3.0.0-rc.1`. **Do not tag, publish, merge the
release PR, or create a GitHub Release yet.**

## Ambiguities resolved

- **Prep branch name:** used `release/flintfire-prep` as specified. A leftover local branch
  `chore/switch-to-flintfire` exists at the same SHA as `main` with no unique commits and no remote.
  It was not used and was not deleted.
- **Keep-version heading vs manifest:** Phase 1.3 heading says “keep version 2.2.1”; §6.2, P2, and
  `package.json` are `2.2.1`. Followed §6.2 / the actual manifest.
- **Playbook path aliases vs this tree:** later Phase 1 steps name some files as they exist here
  (`website/`, `npm-readme.md`, `.rulesync/`, `docs/adr/`, `.github/workflows/publish.yml`,
  `website/src/content/docs/guides/migration-v2-to-v3.md`). Those paths are used. Where a later
  paragraph still says `flintfire/vector` instead of `flintfire/vector`, T18 / §6.1 wins.
- **npm README marker:** preserve the existing `<!-- npm-readme -->` marker, not a renamed variant.
- **Peer install line:** actual peers are `firebase-admin` and `zod` (optional `express`), not
  `firebase-admin` / `zod`.
- **Compat env vars:** rename `FIRESTORE_ORM_ADMIN_VERSION` / `FIRESTORE_ORM_FIRESTORE_VERSION` to
  `FLINTFIRE_ADMIN_VERSION` / `FLINTFIRE_FIRESTORE_VERSION`. Preserve emulator project id
  `demo-firestoreorm-test`.

## Deviations from the plan

1. Phase 0.1 started on leftover local branch `chore/switch-to-flintfire` (same SHA as `main`).
   Switched to `main` before recording baseline; owner assets came along. No unique commits were
   discarded.

## Files touched and why

| File | Change | Plan reference |
| ---- | ------ | -------------- |
| `docs/plans/flintfire-v3-release/notes.md` | Execution record | §0 step 3 |

## Edge cases / traps handled

| Trap | Handled by | Pinned by |
| ---- | ---------- | --------- |
| T1 Pages URL | `base: '/flintfire'`; no fake `/firestore-orm/` redirects | astro config + VERSIONING.md |
| T3 dist-tag | `resolve-npm-dist-tag.cjs` emits only `next`/`latest`; workflow interpolates that literal | unit tests + `publish.yml` |
| T8 dual READMEs | GitHub `README.md` + `npm-readme.md` (`<!-- npm-readme -->`) | readme-sync skill; pack staging |
| T9 generated agents | `.rulesync/` then `rules:sync` | `rules:check` in release:verify |
| T10 v2 archive | keep `@reggieofarrell/firestore-orm` (including `/vector`); only relocate site prefix | re-audit 2026-08-23; restored four hybrid `@reggieofarrell/flintfire/vector` hits |
| T17 brand assets | eight `-light`/`-dark` pairs; unsuffixed `favicon.svg` deleted; checker requires `/flintfire/favicon-*.svg` | `check-built-docs-assets.mjs` + built `index.html` |
| T18 export keys vs specifiers | consumer docs use `flintfire/vector`, `flintfire/express` | packed-consumer + migration guide |
| T19 npm trust flag | comments use `--file publish.yml` | `publish.yml` header |

## Tests added

| Id | Suite | Asserts | Guards |
| -- | ----- | ------- | ------ |
| dist-tag matrix | unit | prerelease→next, stable→latest, mixed identity reject, tag≠version reject, unsafe tag reject | `src/tests/unit/resolveNpmDistTag.unit.test.ts` |
| P14 notes | unit | raw 524b983-shaped note still contains co-author/nested subject; transform drops them and keeps breaking prose | `src/tests/unit/changelogNotes.unit.test.ts` |

## Mutation checks

| Test | Mutation | Result |
| ---- | -------- | ------ |
| `resolveNpmDistTag` next/latest mapping | swapped `return isPrerelease ? 'next' : 'latest'` | **failed** (expected `next` got `latest`, and the inverse). Restored from `/tmp` copy (not `git checkout`). Re-run: 9/9 pass |
| `normalizeBreakingNoteText` strip | `return text.trim()` (no cut) | **failed** (`Co-authored-by` still present). Restored from `/tmp` copy. Re-run: 3/3 pass |

## Gate results

Fourteen-leg §10 + `release:verify` run 2026-08-23 on Node v24.18.0 (`release/flintfire-prep`).
Log: `/tmp/flintfire-prep-gate.log`.

| Leg | Command (actual `package.json` names) | Result |
| --- | --- | --- |
| 1 | `test:types` | pass |
| 2 | `lint` | pass (after ignoring `.versionrc.cjs` + `**/*.astro`) |
| 3 | `check:format` | pass (after `prettier --write` on 6 files) |
| 4 | `test:unit` | **34 suites, 438 tests** pass |
| 5 | `test:integration:emulator` | **36 suites, 545 tests** pass |
| 6–7 | `test:unit:coverage` + `test:coverage:gate:unit` | pass |
| 8–9 | `test:integration:coverage` + `test:coverage:gate:integration` | pass |
| 10 | `build` | pass |
| 11 | `check:package` | pass (98 files; npm README staging restored) |
| 12 | `check:consumer` | pass (`firebase-admin@^14` default) |
| 13 | `check:docs` | pass (189 files) |
| 14 | `docs:build` | pass; `check-built-docs-assets: ok`; no leaked `:::` |
| 15 | `release:verify` | pass (`rules:check` up to date) |

Compat (`FLINTFIRE_ADMIN_VERSION` / `FLINTFIRE_FIRESTORE_VERSION` as implemented): admin ^12/^13/^14 and
admin ^12 + firestore 7.9.0 / 7.10.0 — all pass.

Brand probes: `xmllint --noout` on eight public SVGs; payload grep clean; built
`/flintfire/favicon-{light,dark}.svg` (not `/flintfirefavicon-`); unsuffixed `favicon.svg` absent;
hero uses `flint-fire-icon-{light,dark}.svg` with `dark:sl-hidden` / `light:sl-hidden`.

**Could not verify:** live browser light/dark desktop+mobile favicon/hero picking. Static HTML
assertions cannot prove the OS/browser theme picker.

## Anti-instructions checklist

| Anti-instruction | Confirmed |
| ---------------- | --------- |
| No remote mutation in Phase 0 / Phase 1 local | yes |
| No push/PR/tag/publish | yes |
| No credentials in notes | yes (npm email from `profile get tfa` was not copied) |
| Did not pull/rebase over owner assets | yes |
| Did not create a competing prep branch after choosing `release/flintfire-prep` | yes |

## §11 audit

Not yet. Phase 0 only.

## Independent adversarial review

Independent refute-first pass (fresh subagent, 2026-08-23) was handed the diff + plan + tests, not
this file. Findings:

| Id | Sev | Finding | Disposition |
| -- | --- | ------- | ----------- |
| F1 | blocker | Favicon href could concatenate `BASE_URL` without a slash | **fixed** — `ThemeFavicons.astro` joins with an explicit trailing slash; checker now requires `/flintfire/favicon-light.svg`. Built `index.html` contains that path |
| F2 | blocker | v2 archive taught `@reggieofarrell/flintfire/vector` | **fixed** — restored `@reggieofarrell/firestore-orm/vector` in four sites under `website/src/content/docs/2.0/` |
| F3 | major | Migration intro said “from flintfire 2.x” / “no flintfire@3” | **fixed** — intro now names `@reggieofarrell/firestore-orm` 2.x and “no `@reggieofarrell/firestore-orm@3`” |
| F4 | major | Changelog unit tests pin the helper, not the preset wiring | **deferred** — dry-run 3.0.0 section is already clean of P14 junk; preset-wiring test is follow-up, not a prep-PR identity defect |
| F5 | major | Dry-run breaking notes still quote historical `@reggieofarrell/firestore-orm/express` import from old commit footers | **not a defect** for this PR — plan forbids hand-editing generated changelog; migration guide is canonical. Changelog is generated later |
| F6 | major | `release:publish` / `gh release create` flags for RC | **deferred** — Phase 1 does not create GitHub Releases |
| F7 | nit | Duplicate `publishConfig` in `package.json` | **fixed** — single `publishConfig.access=public` remains |

The subagent also wrote `docs/plans/flintfire-v3-release/review.md`, which is reserved for an
**external** reviewer. That file was deleted; this table is the implementer disposition.

## Could-not-verify

Carried from plan §5: Trusted Publisher settings cannot be inspected until RC1 exists; `flintfire`
availability can change after this note. Full fourteen-leg gate **has now been run** (see Gate
results). Live browser light/dark desktop+mobile favicon/hero picking was **not** executed.

## Open questions for the reviewer

None from Phase 0.

---

## Phase 0 — Read-only preflight (2026-08-23)

### 0.1 Local identity and baseline

| Check | Result |
| --- | --- |
| Node | `v24.18.0` (`~/.nvm/versions/node/v24.18.0`) |
| npm | `11.19.0` |
| nvm default | `24` → `v24.18.0` |
| HEAD | `dc625b6480408dcfdca2d901ba875981338e9fb2` (`dc625b6 test(query-builder): pin decoded vector equality (#76) (#93)`) |
| `HEAD` vs `origin/main` | identical |
| `v2.x` / `origin/v2.x` / `v2.2.1^{commit}` | all `1226e9e9c74987c865d2abe66d422d9117566304` |
| `v2.2.1` ancestor of `v2.x` | yes (exit 0) |
| `v2.x..main` | 106 commits |
| `v3*` tags | none |
| Permitted dirty paths | plan dir; deletion of `website/public/favicon.svg`; eight paired SVGs. No other dirty files. |

`git fetch --prune --tags origin` deleted stale remote-tracking branch
`origin/test/issue-76-decoded-vector-equality-coverage` only.

### 0.2 GitHub and npm identities

| Check | Result |
| --- | --- |
| `gh` login | `reggieofarrell` (keyring; scopes `gist`, `read:org`, `repo`, `workflow`; git protocol HTTPS) |
| Viewer permission | `ADMIN`; `viewerCanAdminister: true` |
| Repo | public `reggieofarrell/firestore-orm`; default branch `main` |
| `npm whoami` | `reggieofarrell` |
| 2FA mode | `auth-and-writes` |

Origin remains SSH (`git@github.com:reggieofarrell/firestore-orm.git`). Matches P16.

### 0.3 Package and release availability

| Check | Result |
| --- | --- |
| `npm view flintfire` | E404 — name unclaimed |
| `@reggieofarrell/firestore-orm` | versions `2.0.0`–`2.2.1`; `latest=2.2.1`; no `deprecated` field; sole maintainer `reggieofarrell` |
| `gh repo view reggieofarrell/flintfire` | repository not found |
| Releases | `v2.2.1` (Latest), `v2.2.0`, `v2.0.0`; no v3 |
| Open PRs | none |

### 0.4 GitHub settings snapshot (pre-rename)

| Surface | Observed |
| --- | --- |
| Pages | `build_type=workflow`; `html_url=https://reggieofarrell.github.io/firestore-orm/`; `cname=null`; HTTPS enforced |
| Actions | enabled, `allowed_actions=all`; default workflow token `read`; cannot approve PRs |
| Workflows | `Deploy docs` (`deploy-docs.yml`), `Publish Package` (`publish.yml`), `Tests` (`tests.yml`) — all `active` |
| Environments | only `github-pages` (count 1); no `npm` |
| Ruleset | `default branch protections`, `enforcement=disabled` |
| Branches | `main`, `v2.x`, `feat/issue-33-conditional-writes`, `issue-40-distinct-values-semantic-equality-backup`, `plan/issue-69-collection-recursive-delete` — all `protected=false` |
| Classic `main` protection | HTTP 404 “Branch not protected” |
| Immutable releases | `enabled=false`, `enforced_by_owner=false` |
| About | description/homepage/topics empty; merge+squash on; rebase off; delete-branch-on-merge on |

No STOP condition fired.

---

## Phase 1 — Preparation PR (in progress, 2026-08-23)

Local work is on `release/flintfire-prep`. **No push, PR, merge, tag, or publish.** Pause here for
maintainer review before Phase 1.10 remote mutation.

### Identity landed

- Package name `flintfire`, version still **2.2.1**, description per §6.2.
- Repository / bugs / homepage URLs point at `reggieofarrell/flintfire` and
  `https://reggieofarrell.github.io/flintfire/`.
- Consumer specifiers: `flintfire`, `flintfire/vector`, `flintfire/express` (export keys remain
  `.`, `./vector`, `./express`).
- ADR-0039 recorded. Compat env vars: `FLINTFIRE_ADMIN_VERSION` / `FLINTFIRE_FIRESTORE_VERSION`.
  Emulator project id `demo-firestoreorm-test` kept.

### Docs and brand assets

- Astro `base: '/flintfire'`. ThemeFavicons Head override + paired splash icons. Unsuffixed
  `favicon.svg` deleted.
- `scripts/check-built-docs-assets.mjs` chained from `website` build and as an explicit step in
  `deploy-docs.yml`.
- `npm run docs:build` (2026-08-23): **check-built-docs-assets: ok**. No leaked `:::` in
  `website/dist`.
- v2 archive: path/URL prefix only; `@reggieofarrell/firestore-orm` imports kept. VERSIONING.md
  documents the one-time relocation exception.
- Dual READMEs: FlintFire pitch; npm file keeps `<!-- npm-readme -->`. Upstream
  `spacelabs-firestoreorm` / `@spacelabstech/firestoreorm` mentions removed from both READMEs except
  LICENSE/NOTICE pointers and footer attribution (HBFL3Xx). v2→v3 still names
  `@reggieofarrell/firestore-orm`.

### Publish + changelog tooling

- `scripts/resolve-npm-dist-tag.cjs` + unit tests. `publish.yml` uses Environment `npm`,
  `npm publish --tag next|latest` from the script output (shell allowlist). Trusted-publisher
  comments use `--file publish.yml` (T19).
- `scripts/changelog-preset.cjs` wraps conventionalcommits and trims breaking notes via
  `normalize-breaking-notes.cjs`. `.versionrc.json` replaced by `.versionrc.cjs` so the preset
  path is `require.resolve`'d (relative names get `conventional-changelog-` prefixed).
- Dry-run `npm run release:bump:dry -- --release-as 3.0.0`: header
  `## [3.0.0](https://github.com/reggieofarrell/flintfire/compare/v2.2.1...v3.0.0)`. No
  `Co-authored-by` / nested `docs(website): archive` in the generated 3.0.0 section. Working tree
  not modified by the dry-run.

### rulesync

- `.rulesync` sources updated to FlintFire; `npm run rules:sync` and `rules:check` (up to date).

### Tests added

| Id | Suite | Asserts | Guards |
| -- | ----- | ------- | ------ |
| dist-tag matrix | unit | prerelease→next, stable→latest, mixed identity reject, tag≠version reject, unsafe tag reject | `src/tests/unit/resolveNpmDistTag.unit.test.ts` |
| P14 notes | unit | raw 524b983-shaped note still contains co-author/nested subject; transform drops them and keeps breaking prose | `src/tests/unit/changelogNotes.unit.test.ts` |

Unit suite after these tests: **34 suites, 438 tests**. Integration: **36 suites, 545 tests**. Full
§10 gate + `release:verify` + five compat legs **passed** 2026-08-23 (see Gate results above).

README/npm-readme re-audit: no `spacelabs` / `@spacelabstech` strings. Remaining
`@reggieofarrell/firestore-orm` hits are the intentional v2→v3 note plus LICENSE/NOTICE/footer
attribution elsewhere.

### Rename audit residuals (valid)

- `CHANGELOG.md` released 2.x history
- Accepted ADRs 0001–0038 historical issue/repo links
- `website/src/content/docs/2.0/**` package imports
- Migration guide old-side `@reggieofarrell/firestore-orm` examples
- This plan / notes / ADR-0039 deprecation instructions
- Emulator fixture `demo-firestoreorm-test` (package.json, `.firebaserc`)
- Checker comment citing the old `/firestore-orm/` prefix as the pre-integration failure

### Deviations

- Changelog config is `.versionrc.cjs` (not JSON) so the custom preset can be an absolute
  `require.resolve` path. Types/URL formats are duplicated onto `preset` because
  commit-and-tag-version only merges those keys into the *default* preset object.
- Dist-tag helper is CommonJS (`.cjs`) so Jest's ts-jest CJS output can load it; `.mjs` failed to
  parse under that suite.
- ESLint ignores `.versionrc.cjs` and `**/*.astro` (no Astro parser in this config; CJS Node globals
  would trip `no-undef` the same way `scripts/**` already is ignored).

Phase 1.10 completed via PR #94 merge (see Phase 2). Local `main` is at the merge commit.

---

## Phase 2 — Rename GitHub repository (2026-08-23)

**REMOTE MUTATION executed** after explicit maintainer approval. No v3 tag. No npm publish.

### Preflight (same shell)

| Check | Result |
| --- | --- |
| `gh` login | `reggieofarrell` (keyring; scopes `gist`, `read:org`, `repo`, `workflow`) |
| `gh api user` | login `reggieofarrell`, id `18563006` |
| `npm whoami` | `reggieofarrell` |
| `gh repo view reggieofarrell/flintfire` | GraphQL repository-not-found (name free) |
| `npm view flintfire` | E404 — still unclaimed |
| PR #94 | **MERGED** 2026-08-23T18:44:09Z; merge SHA `208dee6b6aee2eda1f4e6815d29d2a34fa5810e8` |
| `publish.yml` Environment | `npm` (job already requires it) |

### 2.1 Rename

```text
gh repo rename flintfire --repo reggieofarrell/firestore-orm --yes
```

Succeeded. Canonical name is now `reggieofarrell/flintfire` (public, default branch `main`).
Did **not** create a new empty `firestore-orm` repository.

### 2.2 Redirect proof

| Probe | Result |
| --- | --- |
| `git remote set-url origin` | `git@github.com:reggieofarrell/flintfire.git` |
| `git ls-remote …/firestore-orm.git HEAD` | `208dee6b6aee2eda1f4e6815d29d2a34fa5810e8` |
| `git ls-remote …/flintfire.git HEAD` | `208dee6b6aee2eda1f4e6815d29d2a34fa5810e8` |
| `origin/main` after fetch | `208dee6` (`feat!: rename the npm package and project to FlintFire (#94)`) |

Both GitHub URLs resolve to the same HEAD during the redirect window. Local `main` fast-forwarded
`dc625b6..208dee6`. Remote branch `origin/release/flintfire-prep` was deleted by GitHub after merge.

### 2.3 Settings vs Phase 0.4 snapshot

| Surface | After rename | Drift vs 0.4? |
| --- | --- | --- |
| Default branch | `main` | none |
| Branches | `main`, `v2.x`, `feat/issue-33-conditional-writes`, `issue-40-distinct-values-semantic-equality-backup`, `plan/issue-69-collection-recursive-delete` — all `protected=false` | none disappeared |
| Ruleset | `default branch protections`, `enforcement=disabled` | none |
| Classic `main` protection | HTTP 404 “Branch not protected” | none (expected) |
| Actions | enabled, `allowed_actions=all`; default workflow token `read` | none |
| Workflows | `Deploy docs` (`deploy-docs.yml`), `Publish Package` (`publish.yml`), `Tests` (`tests.yml`) — all `active` | filenames differ from PLAN 2.3’s `publish.yml` / `deploy-docs.yml` / `tests.yml`; **actual on-disk names survived and are active** |
| Pages | `build_type=workflow`; `html_url=https://reggieofarrell.github.io/flintfire/`; `cname=null`; HTTPS enforced | URL base moved with the repo name; old `/firestore-orm/` Pages URL will not redirect (T1) |
| Immutable releases | `enabled=false`, `enforced_by_owner=false` | none |
| v2 Releases | `v2.2.1` (Latest), `v2.2.0`, `v2.0.0` | none |
| v2 tags | `v2.0.0`, `v2.0.1`, `v2.1.0`, `v2.2.0`, `v2.2.1`; no `v3*` | none |
| Merge settings | merge+squash on; rebase off; delete-branch-on-merge on | none |
| About | description/homepage/topics set (intended empty→FlintFire change) | intended |

About metadata applied:

- description: `A type-safe, schema-aware Firestore data-access library for Node.js, built for the Firebase Admin SDK.`
- homepage: `https://reggieofarrell.github.io/flintfire/`
- topics: `flintfire`, `firestore`, `firebase-admin`, `typescript`

### Environment `npm`

| Field | Observed |
| --- | --- |
| Name | `npm` |
| Required reviewer | User `reggieofarrell` (`18563006`) |
| `prevent_self_review` | `false` |
| Custom branch/tag policies | enabled (`protected_branches=false`, `custom_branch_policies=true`) |
| Tag policy | exactly one: `type=tag`, `name=v*` |
| Secrets | `total_count=0` (no npm token) |
| Other environments | `github-pages` still present |

### Phase 2 deviations

- PLAN 2.3 listed workflow files `publish.yml`, `deploy-docs.yml`, `tests.yml`. The merged tree and
  Actions API use `publish.yml`, `deploy-docs.yml`, `tests.yml`. Verified the files that actually
  exist; all three are `active`. Later Trusted Publisher configuration must use `--file publish.yml`
  (matches `docs/development/releasing.md` and the workflow comment), not `publish.yml`.
- `notes.md` Phase 2 record was a local working-tree edit on `main` and was **not** pushed to `main`
  (T16). It was stashed, `release/3.0.0` was cut from a clean tree, then the stash was restored onto
  this branch after the 3.0.0 changelog commit so it cannot pollute generated release notes.

### STOP after Phase 2

Phase 2 complete. Phase 3 started 2026-08-23 (see below).

---

## Phase 3 — Changelog + RC1 manifest (2026-08-23)

**No v3 tag. No npm publish. No GitHub Release.**

### 3.1 Branch

| Check | Result |
| --- | --- |
| `main` / `origin/main` | `208dee6b6aee2eda1f4e6815d29d2a34fa5810e8` |
| `v3*` tags | none |
| Dirty tree on `main` | only this `notes.md` (stashed before branch create) |
| Branch | `release/3.0.0` from that SHA |

### 3.2 Stable 3.0.0 changelog/version (before any RC tag)

Dry-run and real bump: `npm run release:bump -- --release-as 3.0.0` (actual CLI flag; PLAN says
`--release-as`).

| Check | Result |
| --- | --- |
| Commit | `f025a6a chore(release): 3.0.0` |
| Manifest after bump | `flintfire@3.0.0` |
| Tag created? | **no** (`--skip.tag`; `git tag --list 'v3*'` empty) |
| Compare range | `v2.2.1...v3.0.0` |
| New links | `github.com/reggieofarrell/flintfire` |
| Historical 2.x links | still `github.com/reggieofarrell/firestore-orm` |
| `Co-Authored-By` / nested `docs(website): archive v2 docs` | **absent** |
| Sections | BREAKING CHANGES, Added, Fixed, Changed, Documentation |

Do **not** regenerate CHANGELOG.md after this point.

### 3.3 RC1 manifest only

```text
npm version 3.0.0-rc.1 --no-git-tag-version --ignore-scripts
```

| Check | Result |
| --- | --- |
| Diff | `package.json` + `package-lock.json` version only; CHANGELOG.md untouched |
| `check:manifest` | pass |
| Commit | `64b9500 chore(release): stage 3.0.0-rc.1` |
| Current version | `3.0.0-rc.1` |
| `v3*` tags | still none |

### 3.4 Gate

Fourteen §10.1 legs + `release:verify` + brand-asset probes + five compatibility consumer legs.
All passed 2026-08-23 on Node v24.18.0. Log: `/tmp/flintfire-phase3-gate.log` and
`/tmp/flintfire-phase3-compat.log`.

| Leg | Command | Result |
| --- | --- | --- |
| 1 | `test:types` | pass (1s) |
| 2 | `lint` | pass (1s) |
| 3 | `check:format` | pass (2s) |
| 4 | `test:unit` | **34 suites, 438 tests** pass |
| 5 | `test:integration:emulator` | **36 suites, 545 tests** pass |
| 6 | `test:unit:coverage` | pass |
| 7 | `test:coverage:gate:unit` | pass |
| 8 | `test:integration:coverage` | pass |
| 9 | `test:coverage:gate:integration` | pass |
| 10 | `build` | pass |
| 11 | `check:package` | pass (98 files; npm README staging restored) |
| 12 | `check:consumer` | pass (`firebase-admin@^14` default) |
| 13 | `check:docs` | pass (189 files) |
| 14 | `docs:build` | pass; `check-built-docs-assets: ok` |
| 15 | `release:verify` | pass (36s; includes `rules:check`) |

Compat (`FLINTFIRE_ADMIN_VERSION` / `FLINTFIRE_FIRESTORE_VERSION`): admin ^12 / ^13 / ^14 and
admin ^12 + Firestore 7.9.0 / 7.10.0 — all pass.

Brand probes: `xmllint --noout` on eight public SVGs; payload grep clean; built
`/flintfire/favicon-{light,dark}.svg` (not concatenated `/flintfirefavicon-`); unsuffixed
`favicon.svg` absent; hero uses `flint-fire-icon-{light,dark}.svg` with `dark:sl-hidden` /
`light:sl-hidden`.

**Could not verify:** live browser light/dark desktop+mobile favicon/hero picking after a Pages
deploy. Static HTML assertions cannot prove the OS/browser theme picker. Live Pages still serves
the pre-rename artifact until the stable 3.0.0 docs deploy (or a manual **Deploy docs** dispatch).

### Phase 3 deviations

- PLAN 3.2 writes `--release-as 3.0.0`; the installed `commit-and-tag-version` flag is
  `--release-as`. Used the real CLI flag.
- PLAN §10 brand paths still say `favicon-light.svg` / `flint-fire-icon-light.svg` /
  `website/dist`. This tree uses `favicon-light.svg` / `flint-fire-icon-light.svg` /
  `website/dist`. Probed the files that exist.
- `notes.md` Phase 2+3 record is committed on `release/3.0.0` only (not `main`).

### STOP after Phase 3

Phase 3 complete (draft PR #95). Phase 4 started 2026-08-23; see below.

---

## Phase 4 — Manual RC1 npm bootstrap (2026-08-23)

**No GitHub Release for RC1** (would fire OIDC against an immutable version).

### 4.1 Preflight

| Check | Result |
| --- | --- |
| Branch | `release/3.0.0` @ `30c473c` (`docs(plan): record FlintFire 3.0.0 Phase 2–3 execution`) |
| Identity | `flintfire@3.0.0-rc.1`; repo `https://github.com/reggieofarrell/flintfire`; homepage Pages `/flintfire/` |
| `npm whoami` | `reggieofarrell` |
| `npm view flintfire` | E404 (unclaimed) |
| Node / npm | v24.18.0 / 11.19.0 |
| `release:verify` | pass (unit 34/438, integration 36/545; package 98 files) |
| `npm pack --dry-run` | `flintfire-3.0.0-rc.1.tgz`, 98 files, 292.5 kB |
| Tree after pack | clean; GitHub README restored |

### 4.2 Reproducibility tag

```text
git tag -a v3.0.0-rc.1 30c473c -m "FlintFire 3.0.0-rc.1"
git push origin v3.0.0-rc.1
```

| Check | Result |
| --- | --- |
| Tagged `package.json` | `flintfire@3.0.0-rc.1` |
| Remote | `origin` has `v3.0.0-rc.1` (annotated) |
| GitHub Releases | still only v2.0.0 / v2.2.0 / v2.2.1; **no RC1 Release** |

### 4.3 Manual publish — succeeded after maintainer 2FA

Maintainer completed interactive npm auth and published. Registry now has `flintfire@3.0.0-rc.1`.
Did **not** republish (version is immutable).

Integrity `sha512-xlYaqsGEZmH/JoUJuT7FwgxAL3Z1vAtcQkkMdkYN1jUJ2F+1AFovX0/uwJz3SV67I7M5mL7x9PcvZpMCBz8jIQ==`
matches the local pack dry-run. Tarball 98 files, 292.5 kB.

### 4.4 Registry verification + consumer smoke

| Check | Result |
| --- | --- |
| `name` / versions | `flintfire` / `["3.0.0-rc.1"]` |
| `dist-tags.next` | `3.0.0-rc.1` |
| `dist-tags.latest` | **also `3.0.0-rc.1`** — npm sets `latest` on the first publish even with `--tag next` (T3) |
| repository / homepage | `reggieofarrell/flintfire` / `https://reggieofarrell.github.io/flintfire/` |
| engines | `node >=22.0.0` |
| peers | `firebase-admin ^12 \|\| ^13 \|\| ^14`, `zod ^4`, optional `express ^4 \|\| ^5` |
| `npm pack flintfire@3.0.0-rc.1 --dry-run` | 98 files, shasum `3eb483652c7152f2ff0669a36723f9db88c66031` |
| Temp consumer | `/var/folders/sj/_znxtncn7l9_tt3mzbwm01f40000gn/T/tmp.SL85UJkrue` |
| ESM `flintfire` / `flintfire/vector` / `flintfire/express` | `esm ok` |
| CJS `require` of the same specifiers | `cjs ok` |

`npm dist-tag rm flintfire latest` was attempted from this session and **EOTP**’d. `latest` still
points at the RC. Maintainer must run that command interactively so `npm install flintfire` does
not resolve a prerelease.

### 4.5 Trusted Publisher — configured

Dry-run (no mutation):

```text
package: flintfire
file: publish.yml
repository: reggieofarrell/flintfire
environment: npm
permissions: publish
```

`--workflow` was not used (T19). `--allow-stage-publish` was not passed.

Maintainer applied Trusted Publisher interactively. `npm trust list flintfire` (plain):

```text
type: github
file: publish.yml
repository: reggieofarrell/flintfire
environment: npm
permissions: publish
```

JSON lists the same relationship with `permissions: ["createPackage"]` — npm's API enum for
`--allow-publish` / `npm publish`, not “create a new package name only.”

### Dist-tag `latest` (T3 — cannot remove)

`npm dist-tag rm flintfire latest` authenticated successfully, then registry returned
**400 Bad Request**. npm requires a `latest` tag on every package; this is the first version, so
`latest` cannot be deleted and cannot be retargeted. Do **not** publish a dummy version to move it.
Stable `3.0.0` in Phase 6 takes `latest`. Until then, prefer `flintfire@next` or
`flintfire@3.0.0-rc.1`; bare `npm install flintfire` installs the RC.

### STOP after Phase 4

Package exists. Tag `v3.0.0-rc.1` exists. Trusted Publisher is configured. No GitHub Release for
RC1. Do not merge PR #95. Do not republish `3.0.0-rc.1`. Phase 5 (RC2 OIDC) is next.

---

## Phase 5 — RC2 via OIDC (2026-08-23)

**GitHub prerelease `v3.0.0-rc.2` triggers `publish.yml`.** Approve Environment `npm` in Actions
after matching tag/SHA. Do not regenerate CHANGELOG.md.

### 5.1 Stage RC2 manifest

Committed separately from notes (`6595942` Trusted Publisher notes, then `eb77f02` version-only).
`npm version 3.0.0-rc.2 --no-git-tag-version --ignore-scripts`. `check:manifest` passed. Diff was
`package.json` + `package-lock.json` version only; CHANGELOG.md untouched.

`release:verify` exit 0 (~40s): format, lint, rules:check, types, manifest, audit 0, build,
check:package 98 files, packed-consumer Admin 14, unit 34/438 + unit gate, integration coverage +
integration gate, check:docs, docs:build + `check-built-docs-assets: ok`.

Pushed `release/3.0.0` (`30c473c..eb77f02`).

### 5.2 Tag and GitHub prerelease

SHA `eb77f022e8daa9c11d8466e5863502e5b38625ca`. Annotated tag `v3.0.0-rc.2` points at that commit;
`git show v3.0.0-rc.2:package.json` → `flintfire@3.0.0-rc.2`. Tag pushed. GitHub prerelease:

https://github.com/reggieofarrell/flintfire/releases/tag/v3.0.0-rc.2

`--prerelease --latest=false --verify-tag`. Notes file `/tmp/flintfire-v3.0.0-rc.2-notes.md`.

### 5.3 Publish workflow — success (OIDC)

Run id `32661741479`. `headSha` `eb77f022e8daa9c11d8466e5863502e5b38625ca` matches RC2. `event=release`.
Maintainer approved Environment `npm`. Conclusion **success** (~3m24s).

https://github.com/reggieofarrell/flintfire/actions/runs/32661741479

Checked out tag `v3.0.0-rc.2` at `eb77f02`. `release:verify`, Admin 12/13/14 packed-consumer, and
Admin 12 + Firestore 7.9/7.10 floor all passed. Publish step env: `NPM_DIST_TAG: next`. No
`NPM_TOKEN` / `NODE_AUTH_TOKEN` in the publish step. One publish:

```text
npm notice version: 3.0.0-rc.2
npm notice filename: flintfire-3.0.0-rc.2.tgz
npm notice package size: 292.5 kB
npm notice shasum: 6d8973bfa53e8b5beb221bd75cd639d3de21bc80
npm notice integrity: sha512-p9Sx2aNSgnk4N[...]xI4aVeDC7RmuA==
npm notice total files: 98
npm notice Publishing to https://registry.npmjs.org/ with tag next and public access
npm notice publish Provenance statement published to transparency log: https://search.sigstore.dev/?logIndex=2575529854
```

Did not rerun publish.

### 5.4 Registry verification + consumer smoke

| Check | Result |
| --- | --- |
| `flintfire@3.0.0-rc.2` | published; `gitHead` = RC2 SHA |
| repository | `git+https://github.com/reggieofarrell/flintfire.git` |
| `dist.integrity` | `sha512-p9Sx2aNSgnk4NQVCMM840qNVI8gcKuux7oupDJnA+3776Aa6+ImUgqI5zt8qAyew4LSG1UzNZxI4aVeDC7RmuA==` |
| `dist.shasum` | `6d8973bfa53e8b5beb221bd75cd639d3de21bc80` |
| provenance | SLSA v1; attestations URL on registry |
| `dist-tags.next` | `3.0.0-rc.2` |
| `dist-tags.latest` | still `3.0.0-rc.1` (T3; acceptable until stable 3.0.0) |
| Temp consumer | `/var/folders/sj/_znxtncn7l9_tt3mzbwm01f40000gn/T/tmp.axZQaZdwjQ` |
| ESM `flintfire` / `flintfire/vector` / `flintfire/express` | `esm ok` |
| CJS `require` of the same specifiers | `cjs ok` |
| `npm audit signatures` | 274 registry signatures verified; 14 attestations verified; `invalid=[]` `missing=[]` |
| FlintFire attestation | name `flintfire@3.0.0-rc.2`; predicateType `https://slsa.dev/provenance/v1`; also npm publish attestation `v0.1` |

OIDC RC2 is proven. Do not merge PR #95. Do not publish stable until Phase 6.

**HUMAN CHECKPOINT (done 2026-08-23):** npm Publishing access set to **Require two-factor
authentication and disallow bypass 2FA tokens**. OIDC Trusted Publishing remains allowed. No
bootstrap granular token was created for RC1 (interactive 2FA). Phase 6 is next.

---

## Phase 6 — Finalize and ship stable 3.0.0 (2026-08-23)

Do not regenerate CHANGELOG.md. Restore the manifest to `3.0.0`, gate, mark PR #95 ready, merge,
tag `v3.0.0`, GitHub Release (triggers npm `latest` + docs).

### 6.1 Restore stable manifest

Notes commit `d48a290` first (RC2 evidence + 2FA lock), then version-only `c3e15cf`.
`npm version 3.0.0 --no-git-tag-version --ignore-scripts`. `check:manifest` passed. Diff was
`package.json` + `package-lock.json` version only (`3.0.0-rc.2` → `3.0.0`); CHANGELOG.md untouched.
`git show c3e15cf:package.json` → `flintfire@3.0.0`.

### 6.2 Local §10 + release:verify + rename audit (2026-08-23, Node v24.18.0)

Fourteen §10 legs, all exit 0:

| # | Command | Result |
| --- | --- | --- |
| 1 | `test:types` | pass |
| 2 | `lint` | pass |
| 3 | `check:format` | pass |
| 4 | `test:unit` | 34 suites / 438 tests |
| 5 | `test:integration:emulator` | 36 suites / 545 tests |
| 6 | `test:unit:coverage` | 34/438; lines 87.14% |
| 7 | `test:coverage:gate:unit` | all unit gates passed |
| 8 | `test:integration:coverage` | 36/545; lines 94.24% |
| 9 | `test:coverage:gate:integration` | all integration gates passed |
| 10 | `build` | pass |
| 11 | `check:package` | 98 files |
| 12 | `check:consumer` | Admin 14 packed consumer pass |
| 13 | `check:docs` | 189 doc files |
| 14 | `docs:build` | `check-built-docs-assets: ok` |

`release:verify` exit 0 (includes `rules:check`, `check:manifest`, `check:audit` 0 vulns).

Compat: Admin `^12` / `^13` / `^14` packed-consumer pass. Admin 12 + Firestore `7.9.0` / `7.10.0`
object-form floor probes pass.

Brand: xmllint 8 SVGs; no executable/external hits; eight paired built assets; no unsuffixed
`favicon.svg`; hero `dark:sl-hidden` / `light:sl-hidden`. Browser theme picking not re-verified.

Rename audit residuals only in allowed classes (CHANGELOG 2.x history, ADRs, v2 archive
`website/src/content/docs/2.0/**`, migration guide old-side examples, plan/notes, NOTICE lineage,
README v2→v3 pointer). No old package import in current source, package metadata, or current
quick starts.

### 6.2 PR ready / merge

Pushed `release/3.0.0`. Marked [PR #95](https://github.com/reggieofarrell/flintfire/pull/95) ready.
All required Tests workflow jobs green (unit/integration coverage gates, lint, types, package,
docs, website, Admin 12/13/14 consumers, Firestore 7.9/7.10 floor, Node 22 unit, audit).

Squash-merged 2026-08-23T19:56:52Z. Merge SHA `1f070ea951bc3bdee218b6aa17c4e5e5fca168aa`
(`chore(release): FlintFire 3.0.0 (#95)`). Manifest on that commit: `flintfire@3.0.0`. CHANGELOG
3.0.0 section unchanged from the pre-RC generation.

### 6.3 Prove main

`origin/main` = `1f070ea`. No `flintfire@3.0.0` on npm yet at this step (404). Tag created next.

### 6.4 Tag + GitHub Release

Annotated `v3.0.0` at `1f070ea`. `git show v3.0.0:package.json` → `flintfire@3.0.0`.
`--verify-tag --latest`. Release URL:
https://github.com/reggieofarrell/flintfire/releases/tag/v3.0.0 (not draft, not prerelease).

### 6.5 Workflows

Publish run [32662886466](https://github.com/reggieofarrell/flintfire/actions/runs/32662886466)
`headSha=1f070ea`, Environment `npm` approved, `NPM_DIST_TAG: latest`, OIDC (no `NPM_TOKEN`),
one publish, provenance logIndex `2575746374`.

Docs run [32662886478](https://github.com/reggieofarrell/flintfire/actions/runs/32662886478):
**first attempt failed** — Environment `github-pages` allowed only branch `main`, but the workflow
deploys from tag `v3.0.0`. Added tag policy `v*` (kept `main`). Rerun succeeded. Live site serves
`/flintfire/` CSS and paired favicons.

---

## Phase 7 — External verification (2026-08-23)

| Check | Result |
| --- | --- |
| Tag peeled commit | `1f070ea951bc3bdee218b6aa17c4e5e5fca168aa` = merge SHA |
| GitHub Release | published, stable, latest |
| `flintfire@3.0.0` | `gitHead` = merge SHA |
| `dist.integrity` | `sha512-88KvCbKW914a+YAO+mMSnrvEArQ3XyKlMBwMS1D64BeEh3IcDrv1Nx/4TXY1IUDYlnGCuXGdcvJwwntix4FNEg==` |
| `dist.shasum` | `0a893e9352639d7975840eedd1370f931c259344` |
| Provenance | SLSA v1; npm publish attestation v0.1 |
| Dist-tags after verify | `latest=3.0.0`; `next` still RC2 until 7.5 |
| Packed README | `<!-- npm-readme -->`; install `flintfire` |
| Registry consumer | ESM+CJS `flintfire` / `flintfire/vector` / `flintfire/express` ok |
| `npm audit signatures` | FlintFire 3.0.0 attestation verified; invalid=[] missing=[] |
| Pages | home / getting-started / migration / `2.0/` HTTP 200; CSS under `/flintfire/` |

**7.5 `next` dist-tag:** maintainer removed it (2FA). `npm dist-tag ls flintfire` → `latest: 3.0.0`
only. RC tarballs remain on the registry.

**7.6 Soak:** waived by maintainer (requested 2.x deprecation the same day). npm deprecation is
reversible. Timestamp: 2026-08-23.

**Could-not-verify:** live browser OS-preference favicon + Starlight theme-picker hero at desktop
and mobile. Built HTML assertions passed.

---

## Phase 8 — Deprecate `@reggieofarrell/firestore-orm@2.x` (2026-08-23)

Replacement healthy: `flintfire@3.0.0`, `latest` only. Old package still five versions, `latest=2.2.1`.

Dry-run listed all five versions with the playbook message. Live `npm deprecate` required maintainer
2FA. Message (exact, all five):

`Renamed to flintfire. Install flintfire@^3. Migration guide: https://reggieofarrell.github.io/flintfire/guides/migration-v2-to-v3/`

Fresh `npm install @reggieofarrell/firestore-orm@2.2.1` emitted that warning. No version unpublished.
`@reggieofarrell/firestore-orm@3.0.0` remains 404.

---

## Phase 9 — Closeout (2026-08-23)

### Preservation

| Ref | Still present |
| --- | --- |
| `origin/v2.x` | `1226e9e9c74987c865d2abe66d422d9117566304` |
| tags `v2.0.0`–`v2.2.1` | yes (annotated where historically annotated) |
| npm 2.0.0–2.2.1 | yes, deprecated in place |
| `@reggieofarrell/firestore-orm@3` | not published |

### Durable docs

ADR-0039 status → `Accepted (released in 3.0.0)` with PR/release/npm links.
`docs/development/releasing.md` first-package sequence marked completed (historical bootstrap).

Plan directory **not** deleted in this commit (PLAN 9.7: separate cleanup PR after review).

### Independent §4 trap walk (against shipped result)

| Trap | Outcome |
| --- | --- |
| T1 Pages base | Live `/flintfire/` assets; old `/firestore-orm/` Pages URL does not redirect (accepted). |
| T2 OIDC bootstrap | RC1 manual; RC2+stable OIDC. |
| T3 `latest` on first publish | npm forced `latest` onto RC1 (could not `dist-tag rm`); stable 3.0.0 took `latest`. |
| T4 tag/manifest/SHA | `v3.0.0` = `flintfire@3.0.0` = `1f070ea`. |
| T5 changelog range | 3.0.0 changelog generated before any v3 tag; not regenerated. |
| T6 changelog quality | Generated entry shipped; no hand-edit of CHANGELOG. |
| T7 immutable versions | No republish of RC1/RC2/3.0.0. |
| T8 dual README | Packed tarball is npm README. |
| T9 generated agent config | `rules:check` green on release commits. |
| T10 v2 archive imports | Frozen 2.0 docs keep old package name; site prefix `/flintfire/2.0/`. |
| T11 deprecate after verify | Deprecation ran after registry+Pages+provenance proof. |
| T12 workflows on default branch | `publish.yml` / `deploy-docs.yml` were on `main` before RC2. |
| T16 no direct `main` push | Release via PR #95. |
| T17 brand assets | Built checker + xmllint; **browser picker not re-verified**. |
| T18 consumer specifiers | `flintfire` / `flintfire/vector` / `flintfire/express`. |
| T19 `--file` not `--workflow` | Trusted Publisher uses `publish.yml`. |

**Deviation:** `github-pages` Environment needed a `v*` tag rule (only `main` was allowed). Added
during stable docs deploy. `npm` Environment already allowed `v*`.

### Follow-ups (non-blocking)

- Custom domain for Pages (ADR-0039; not a 3.0.0 dependency).
- Manual browser light/dark favicon + hero verification.
- Optional announcement.

Do not delete `docs/plans/flintfire-v3-release/` until this closeout is reviewed.

