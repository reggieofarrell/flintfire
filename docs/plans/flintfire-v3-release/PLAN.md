# FlintFire 3.0.0 release and package-migration playbook

**Status:** Ready to execute · **Owner:** Reggie O'Farrell · **Implementer:** human or agent ·
**Reviewer:** maintainer · **Baseline:** `main` @ `dc625b6`
(`test(query-builder): pin decoded vector equality (#76) (#93)`) · **Prepared and reverified:**
2026-08-23

**Issue:** None. This is a one-time release-operations handoff for the approved FlintFire rename,
not an implementation plan for a numbered GitHub issue.

> **Outcome:** Publish the existing, substantially changed library as unscoped `flintfire@3.0.0`
> from the renamed `reggieofarrell/flintfire` repository; preserve the v2 line and its history;
> prove npm Trusted Publishing with a release candidate; then deprecate—but do not unpublish—every
> `@reggieofarrell/firestore-orm@2.x` version with a message pointing to FlintFire and the migration
> guide.

---

## §0 How to use this playbook

This file is both the implementation plan and the live release checklist. A human can execute the
commands directly. An agent can execute local and read-only steps, but must pause for explicit
approval before every remote mutation identified as **REMOTE MUTATION**. npm login, one-time
passwords, GitHub Environment approvals, and npm package-settings changes are **HUMAN CHECKPOINTS**.

1. Read §1 and §4 before changing anything. The naming, repository, versioning, and deprecation
   decisions are settled.
2. Execute §7 in order. Do not combine phases or skip a checkpoint because later steps are designed
   around the state produced by earlier ones.
3. Copy this file to the working branch with the preparation PR. During execution, write timestamps,
   command output summaries, release URLs, workflow-run URLs, npm integrity values, and deviations to
   `docs/plans/flintfire-v3-release/notes.md`.
4. Treat every `STOP` as a hard stop. Fix or escalate the condition before continuing.
5. Use Node 24 for all release work. Do not weaken a test, package, audit, documentation, or coverage
   gate to make the release pass.
6. Follow the `readme-sync` skill for `README.md` / `npm-readme.md`, the `adr` skill for ADR-0039,
   and the `plan-execution` skill while implementing the preparation PR.
7. Do not place credentials, npm OTPs, access tokens, or copied browser-session data in `notes.md`,
   shell history, commits, GitHub comments, or workflow inputs.
8. The release is complete only when §11 is entirely checked, including old-package deprecation and
   verification from a clean registry consumer.

### Command conventions

Commands assume a POSIX shell and start from the repository root. Use task-specific variables only:

```bash
export FLINTFIRE_REPO_ROOT="/Users/reggieofarrell/Git/firestore-orm"
cd "$FLINTFIRE_REPO_ROOT"
```

On a machine where that path differs, replace it with the clone's absolute path. Never reuse
`$HOME`, `$CODEX_HOME`, or another system variable for release state.

### Stop conditions

Stop immediately if any of these is true:

- `flintfire` exists on npm and is not already owned by Reggie O'Farrell.
- The authenticated npm or GitHub identity is not the intended owner.
- `main`, `origin/main`, `v2.x`, `origin/v2.x`, and the expected tags do not have the relationships
  recorded in §3.
- The worktree contains unrelated changes.
- The generated 3.0.0 changelog contains co-author trailers, nested commit messages, duplicated
  release notes, or links to the old repository for the new 3.0.0 section.
- A release tag does not point to a commit whose `package.json.version` exactly matches the tag.
- Any mandatory gate, workflow, registry smoke test, provenance check, or docs deployment fails.
- npm reports that a version was published after a workflow appeared to fail. npm versions are
  immutable; verify registry state before retrying.

---

## §1 Owner-approved decisions

| Id | Decision | Rejected alternative and why |
| --- | --- | --- |
| **D1** | Brand the project **FlintFire**; npm and import name are lowercase unscoped `flintfire`. | `FireODM`, `FireSchema`, and retaining the scoped package name were considered earlier and rejected. FlintFire avoids making ORM/ODM taxonomy part of the brand. |
| **D2** | Release the renamed library as **3.0.0** and preserve semver continuity. | Restarting at `0.1.0` would erase useful continuity with the already published 2.x fork and understate a mature, intentionally breaking release. |
| **D3** | Rename the existing GitHub repository to `reggieofarrell/flintfire`. | A new repository would split issues, history, stars, PRs, tags, and redirects without giving consumers a meaningful benefit. |
| **D4** | Publish v3 only as `flintfire`; do **not** publish `@reggieofarrell/firestore-orm@3`. | Dual-publishing creates two canonical package identities and makes future support and provenance ambiguous. |
| **D5** | Preserve `@reggieofarrell/firestore-orm@2.x`, the `v2.x` branch, and all v2 tags. | Unpublishing breaks lockfiles and cached deployments. Rewriting the v2 branch or tags destroys the release record. |
| **D6** | Deprecate the full old `2.x` range only after the stable FlintFire package, docs, and migration path are verified. | Deprecating before the replacement is usable strands consumers; leaving 2.x silently active does not direct them to the maintained line. |
| **D7** | Use a manually published `3.0.0-rc.1` only to create the new npm package, then prove OIDC with `3.0.0-rc.2`; publish stable `3.0.0` through OIDC. | npm Trusted Publishing cannot be configured for a package that does not yet exist. Publishing stable manually would skip the release automation and provenance proof. |
| **D8** | Prereleases use npm dist-tag `next`; stable uses `latest`. Prereleases never update production docs. | A bare prerelease publish can become `latest`, and prerelease docs can claim APIs that are not yet stable. |
| **D9** | GitHub Pages moves to `https://reggieofarrell.github.io/flintfire/`. A custom domain is optional follow-up work, not a release dependency. | GitHub does not redirect a project Pages URL when its repository is renamed. Keeping `/firestore-orm/` is not compatible with the renamed project site. |
| **D10** | Do not publish a documentation-only `2.2.2`. The npm deprecation banner is the old-package redirect. | A final old-name patch creates another installable release and an extra publishing path solely to replace registry README text. |
| **D11** | Preserve public class and type names such as `FirestoreRepository`; the release renames the package and brand, not the API vocabulary. | Renaming stable API symbols adds unrelated migration work and risk to an already large major release. |
| **D12** | Describe FlintFire as a type-safe, schema-aware Firestore data-access library for Node.js and the Firebase Admin SDK. Retain ORM-related npm keywords for discoverability. | Calling it an ODM in the main pitch reopens a taxonomy question the brand intentionally avoids; removing search terms makes the package harder to find. |
| **D13** | Ship the eight owner-supplied SVGs as four explicit light/dark pairs. A `-light.svg` asset is used in light mode and its `-dark.svg` peer is used in dark mode; there is no unsuffixed fallback asset. | Treating one variant as universal discards the owner-supplied theme work. Keeping the old unsuffixed names would make the canonical asset contract ambiguous and lets Starlight silently request a deleted file. |

---

## §2 Scope

### In scope

| Area | Required change |
| --- | --- |
| npm identity | `@reggieofarrell/firestore-orm` → `flintfire`; retain version continuity and publish `3.0.0` |
| GitHub identity | Rename the existing repository `firestore-orm` → `flintfire`; keep owner and history |
| Documentation identity | Rename active branding, install commands, imports, package links, repo links, and Pages base |
| Brand assets | Commit and integrate all four owner-supplied FlintFire light/dark SVG pairs with theme, fallback, base-path, and accessibility constraints |
| v2 migration | Preserve v2 branch/tags/package; keep historical v2 imports; provide an explicit old-name → new-name migration step |
| Publish automation | Bootstrap RC1 manually; support prerelease `next` publishing; prove OIDC with RC2; publish stable with `latest` |
| Release notes | Generate a complete v2.2.1 → v3.0.0 changelog before any v3 prerelease tags exist; fix malformed generator output at its source |
| Registry transition | Verify the new package, then deprecate every old 2.x version with the canonical message |
| Release evidence | Record SHAs, tags, workflow URLs, npm metadata, provenance, smoke tests, and deprecation output |

### Explicitly out of scope

- No new repository and no transfer to a different GitHub owner.
- No `@reggieofarrell/firestore-orm@3` compatibility release or meta-package.
- No unpublishing or deleting any npm version.
- No force-moving or deleting v2 tags.
- No reset to `0.x` and no change to the already published 2.x versions.
- No public API symbol rename solely for branding.
- No change to the emulator project id `demo-firestoreorm-test`; it is an internal fixture identity,
  and changing it adds release risk without consumer value.
- No semantic rewrite of the frozen v2 documentation. Only its site-path prefix and live repository
  links may be mechanically relocated; its old package imports and v2 behavior remain historical.
- No custom docs domain in this release.
- No hand-edited 3.0.0 changelog section. Generator fixes and generated output are in scope;
  manually curating generated Markdown after the fact is not.
- No logo or favicon redesign. The owner-supplied `-light.svg` / `-dark.svg` files and names are
  approved inputs and must be integrated as-is; altering their typography, colors, paths, or
  geometry—or restoring unsuffixed aliases—is outside this release.

---

## §3 Verified facts at the baseline

Every row below was checked on 2026-08-23. Re-run the corresponding probe immediately before
execution because registry and GitHub settings are mutable.

| Id | Verified fact | Evidence / command |
| --- | --- | --- |
| **P1** | The worktree was clean on `main`; `main...origin/main`; HEAD was `dc625b6`. | `git status --short --branch`; `git log -1 --oneline` |
| **P2** | The manifest is still `@reggieofarrell/firestore-orm@2.2.1`; repository and homepage still use `firestore-orm`. | `package.json:2-4`, `package.json:124-131` |
| **P3** | `v2.x`, `origin/v2.x`, and `v2.2.1^{commit}` all resolve to `1226e9e9c74987c865d2abe66d422d9117566304`; the v2.2.1 tag is an ancestor of `v2.x`. | `git rev-parse`; `git merge-base --is-ancestor v2.2.1 v2.x` returned 0 |
| **P4** | `main` is 106 commits ahead of `v2.x`; v3 work is unreleased. | `git rev-list --count v2.x..main`; no `v3*` tag was present |
| **P5** | npm `@reggieofarrell/firestore-orm` has versions 2.0.0 through 2.2.1, `latest=2.2.1`, and no deprecation message. | `npm view '@reggieofarrell/firestore-orm' --json` |
| **P6** | `npm view flintfire` returned `E404`; the unscoped name was unclaimed at the time of the audit. | `npm view flintfire --json` |
| **P7** | The public repository is `reggieofarrell/firestore-orm`, default branch `main`; existing stable GitHub Releases are `v2.0.0`, `v2.2.0`, and `v2.2.1` (latest). There is no v3 release. | Authenticated repository/release API |
| **P8** | The publish workflow runs only for a published GitHub Release, rejects every prerelease, validates tag = manifest version, runs the release gate, and then executes bare `npm publish`. | `.github/workflows/publish.yml:14-16`, `:50-68`, `:91-121` |
| **P9** | The docs workflow deploys only stable releases or a manual ref and checks out the release tag. | `.github/workflows/deploy-docs.yml:12-22`, `:35-75` |
| **P10** | The current Pages base, title, repository links, and live URL still use `firestore-orm`. | `website/astro.config.mjs:3-6`, `:24-30`, `:54-68`; `website/VERSIONING.md:21-35` |
| **P11** | Active docs and examples contain old package imports and `/firestore-orm/` site paths. The frozen v2 archive also contains old package imports and old site-path prefixes. | Exhaustive `rg` inventory in §7 phase 1 |
| **P12** | The repo generates tool-specific agent configuration from `.rulesync/`; generated `.agents/`, `.claude/`, `.cursor/`, root `AGENTS.md`, and `CLAUDE.md` must not be edited directly. | Root `AGENTS.md`; `.rulesync/rules/overview.md` |
| **P13** | The npm tarball displays `npm-readme.md` by staging it as `README.md` during pack; GitHub displays the committed `README.md`. | `readme-sync` skill; `docs/development/releasing.md:108-160` |
| **P14** | `npm run release:bump:dry -- --release-as 3.0.0` selects 3.0.0 and the complete v2.2.1→v3 range, but its output is malformed: it includes `Co-Authored-By` trailers and an embedded `docs(website): archive v2 docs...` body under breaking changes. | Executed dry run on `dc625b6`; offending squash body originates in commit `524b983` |
| **P15** | Node `v24.18.0` and npm `11.16.0` were available. | `node --version`; `npm --version` |
| **P16** | `gh` is authenticated as `reggieofarrell` with `repo` and `workflow` scopes; the account has repository `ADMIN` permission. `gh` reports HTTPS as its configured Git protocol, while this clone's existing `origin` is SSH; phase 2 preserves that SSH remote style. | `gh auth status`; `gh api user`; `gh repo view`; `git remote -v` |
| **P17** | GitHub repository redirects cover repository traffic after a rename, but GitHub Pages project-site URLs do not redirect. | [GitHub repository rename documentation](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository) |
| **P18** | npm deprecation can target a version range and attach a replacement message without deleting the package. | [npm deprecation documentation](https://docs.npmjs.com/deprecating-and-undeprecating-packages-or-package-versions/) |
| **P19** | npm Trusted Publishing requires an existing package and an exact GitHub owner/repository/workflow configuration; current npm and Node versions meet the CLI floor. | [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers/) and `docs/development/releasing.md` |
| **P20** | The npm CLI is authenticated as `reggieofarrell`; account 2FA mode is `auth-and-writes`, and published metadata lists that account as the sole old-package maintainer. `flintfire` still returns E404, while the old package remains at five undeprecated 2.x versions with `latest=2.2.1`. | `npm whoami`; `npm profile get tfa --json`; `npm view ... maintainers`; both package-state `npm view` probes |
| **P21** | `reggieofarrell/flintfire` does not currently resolve as a GitHub repository, so the target repository name is available under the owner. | `gh repo view reggieofarrell/flintfire` returned repository-not-found |
| **P22** | Pages is configured with `build_type=workflow`, no custom domain, and current URL `https://reggieofarrell.github.io/firestore-orm/`. The only Environment is `github-pages`; no `npm` Environment exists. | Pages and Environments REST APIs |
| **P23** | `Publish Package`, `Deploy docs`, and `Tests` are all active workflows. Actions are enabled for all actions; default workflow token permissions are read-only and cannot approve PRs. | Actions permissions/workflows APIs |
| **P24** | `main` is not classically protected. A repository ruleset named `default branch protections` targets the default branch but has `enforcement=disabled`; all five listed branches report `protected=false`. | branch, branch-protection, and rulesets APIs |
| **P25** | Release immutability is disabled, and all three existing v2 Releases report `immutable=false`. The release procedure therefore cannot claim GitHub immutability as a guard. | immutable-releases and releases APIs |
| **P26** | Repository About metadata is empty: no description, homepage, or topics. Merge commits and squash merges are allowed; rebase merges are disabled; merged branches are deleted. | repository REST/GraphQL metadata |
| **P27** | Eight owner-supplied SVGs are present as four `-light.svg` / `-dark.svg` pairs: favicon (both 513×513 viewBox), icon (light 288×473; dark 480×789), horizontal wordmark (both 1019×309), and vertical wordmark (light 832×997; dark 815×975). All are well-formed, self-contained paths with no script, foreign object, JavaScript URL, external image/font, or `<use>` dependency. Rendered pair inspection confirms navy detail/text in light variants and white detail/text in dark variants. | `xmllint --noout`; `file`; content/security grep; `rsvg-convert`; paired visual inspection on light and navy backgrounds |
| **P28** | The current production docs build exits successfully and copies all eight files, but it still emits `/firestore-orm/favicon.svg`. That unsuffixed file has been deliberately removed, so the built favicon link is a silent 404 until the prep PR configures the pair explicitly. | `npm run docs:build`; eight emitted-file checks; negative `website/dist/favicon.svg` check; `website/dist/index.html` inspection |
| **P29** | GitHub's current Environments API supports required User reviewers, `prevent_self_review`, custom deployment policies, and tag-specific patterns. This allows the `npm` Environment to require Reggie's approval while admitting only `v*` tags without relying on nonexistent branch protection. | GitHub deployment Environments and branch-policies REST documentation, API version `2026-03-10` |
| **P30** | This Starlight version supports explicit light/dark page assets through `data-theme` utility classes (`dark:sl-hidden` / `light:sl-hidden`). Its configured `favicon` accepts only one path, while its default `Head` component renders the computed head list; a supported `Head` override can delegate to the default and append paired media-aware favicon links after it. Starlight's built-in paired navigation `logo` imports source assets, but Vite explicitly rejects importing files from `public/`. | local `@astrojs/starlight` logo/favicon/head schemas, `SiteTitle.astro`, `Head.astro`, `style/util.css`, virtual-image loader, and Vite public-directory guard |

### Baseline identity commands

```bash
git status --short --branch
git log -1 --oneline
git rev-parse v2.x origin/v2.x 'v2.2.1^{commit}'
git merge-base --is-ancestor v2.2.1 v2.x
git rev-list --count v2.x..main
git tag --list 'v3*'
node --version
npm --version
```

Expected in a fresh clone: clean `main`, the SHAs and count recorded above, no `v3*` output, Node
24, and npm 11.5.1 or newer. In the owner's current worktree, phase 0.1's explicitly permitted plan,
legacy-favicon deletion, and eight paired SVG additions replace the clean-tree expectation until the
prep branch is created.

---

## §4 Traps

### T1 — Repository redirects do not relocate GitHub Pages (P10, P17)

Renaming the repository preserves normal GitHub URLs, but the old
`https://reggieofarrell.github.io/firestore-orm/` project-site URL will not redirect. All active
site paths, redirects, link-check assumptions, README links, and package metadata must move to
`/flintfire/`. Expect a short docs transition window between repository rename and the stable docs
deployment; do not deploy prerelease docs as the stable site to hide that window.

### T2 — OIDC cannot create the npm package (P19)

The Trusted Publisher settings page exists only after `flintfire` has a published version. RC1 must
be published manually with `--tag next`, then the exact renamed repository and workflow can be
authorized. Do not attempt the stable release as the bootstrap publish.

### T3 — A bare prerelease publish can claim `latest` (P8)

The current workflow correctly refuses prereleases because it uses bare `npm publish`. The prep PR
must route GitHub prereleases to `next` and stable releases to `latest`. The RC1 manual command must
also say `--tag next` explicitly.

### T4 — Tag, manifest, and checked-out commit must be identical release identities (P8)

For every RC and stable release, `v${package.json.version}` must be the tag name and the tag must
point to the exact commit being published. A release created from `main` while the RC manifest lives
only on a branch will publish the wrong tree or fail the identity check. Create and push the exact
tag first; use `gh release create --verify-tag`.

### T5 — RC tags can truncate the stable changelog range (P14)

`commit-and-tag-version` diffs from the latest semver tag. If `v3.0.0-rc.1` is created first, a
later stable bump can generate only the RC delta rather than the entire v2.2.1→v3.0.0 story.
Generate and commit the stable 3.0.0 changelog before creating any v3 tag, temporarily move the
manifest through RC1 and RC2, then restore it to 3.0.0 without regenerating the changelog.

### T6 — The current generated changelog is not releasable (P14)

Squash commit `524b983` contains a valid breaking-change footer followed by co-author trailers and
an embedded second commit description. The parser treats the remainder as part of the breaking
note. Fix the generator or its preset at the commit-note transform boundary and test the dry-run
output. Do not manually delete the bad text from `CHANGELOG.md`; it will return on regeneration.

### T7 — npm versions are immutable and workflow retries can double-publish (P5)

If a publish step times out or a workflow is marked failed, query npm before rerunning it. If the
version exists, do not retry `npm publish`; finish verification and repair the workflow separately.
Failed RCs advance to a new RC number. A bad stable release is corrected with a later patch and/or
deprecation, never by overwriting 3.0.0.

### T8 — GitHub and npm READMEs are different artifacts (P13)

Changing only `README.md` leaves the registry README stale; changing only `npm-readme.md` leaves
GitHub stale. Both must agree on the new package, docs, migration, peers, and quick start. A pack
failure can leave the staged README swap behind; use the documented restore command before any
commit.

### T9 — Generated agent configuration must be regenerated, not patched (P12)

Brand strings occur in generated skills and rules. Edit the `.rulesync/` source, run
`npm run rules:sync`, and commit source plus regenerated files. Direct edits to `.agents/`,
`.claude/`, `.cursor/`, `AGENTS.md`, or `CLAUDE.md` will be overwritten and fail `rules:check`.

### T10 — A global rename corrupts historical migration material (P11)

The v2 archive must still teach `@reggieofarrell/firestore-orm@2`. Accepted ADRs and old changelog
entries must still describe the historical package. Mechanically move `/firestore-orm/` URL
prefixes to `/flintfire/` inside the v2 archive, but do not replace its old package imports with
`flintfire`.

### T11 — Deprecating 2.x is visible immediately (P18)

The old-package warning affects every matching install as soon as the command succeeds. Do it only
after stable registry installation, all three subpaths, Pages, release SHA, and provenance are
verified. A typo can be corrected by rerunning `npm deprecate`; an empty message undeprecates.

### T12 — Release-triggered workflows must already exist on the default branch (P8, P9)

Merge the workflow changes in the preparation PR before publishing RC2. A workflow that exists only
on the RC branch is not a reliable release-event entrypoint. Confirm GitHub recognizes both workflow
files after the repo rename.

### T13 — Package-name availability is race-sensitive (P6)

The E404 result is evidence only for 2026-08-23. Recheck immediately before the prep PR and again
before RC1. If another owner has claimed `flintfire`, stop; do not publish under a surprise fallback
name.

### T14 — Authentication must be proven in the executing shell (P16)

An OAuth browser flow is not enough. `gh auth status`, `gh api user`, `npm whoami`, and the relevant
permissions must succeed from the same shell that will mutate GitHub/npm. Do not infer access from a
previous terminal or browser session.

### T15 — The old npm README cannot be edited in place (D10, P13)

The registry README belongs to the published 2.2.1 tarball. Do not create 2.2.2 solely to alter it.
The deprecation banner carries the canonical redirect, and the renamed GitHub repository README
carries the maintained project identity.

### T16 — `main` is procedurally, not technically, PR-only (P24)

The release guide says direct pushes to `main` are not allowed, but GitHub currently reports no
active branch protection and a disabled default-branch ruleset. A push-capable human or agent could
therefore bypass review accidentally. This playbook still requires preparation and release PRs;
verify the target branch before every push and never treat the absence of a server-side rejection as
authorization to push `main`. Enabling the dormant ruleset is a separate repository-governance
decision, not a hidden release prerequisite.

### T17 — A successful build can ship a missing or inverted theme asset (P27, P28, P30)

Astro copies public files without verifying head or content references, so the current build is green
while its unsuffixed favicon URL points to no file. A swapped pair is similarly silent: the SVG loads,
but navy detail disappears in dark mode or white detail disappears in light mode. Remove every
unsuffixed reference, wire both variants explicitly, and verify the built HTML plus rendered light/
dark states. Use `dark:sl-hidden` on the light page image and `light:sl-hidden` on the dark page image;
the class names describe the mode in which that element is hidden, not the asset it contains.

### T18 — Export-map keys are not consumer import specifiers (P2)

`package.json` `"exports"` keys are `.`, `./vector`, and `./express`. Consumer specifiers are
`flintfire`, `flintfire/vector`, and `flintfire/express`. Writing `from './vector'` or
`from './express'` in a README or migration step is a relative filesystem path, not a package
subpath, and fails in a consumer project.

### T19 — `npm trust` flags are not `gh` flags (P19)

npm 11 Trusted Publisher CLI requires `--file <workflow-filename>`. `gh run list` uses
`--workflow`. Passing `--workflow publish.yml` to `npm trust github` is invalid and will not
configure Trusted Publishing. Confirm `npm trust list flintfire --json` after the mutation.

---

## §5 Remaining execution-time bounds

- GitHub and npm authentication, admin/publish identity, npm 2FA mode, workflows, Pages, Actions
  permissions, Environments, rulesets/branch protection, repository metadata, existing Releases,
  and release immutability were verified and moved to P16 and P20–P26. Repeat identity checks at
  execution time because sessions and permissions can change.
- npm package settings for Trusted Publishing cannot be inspected until RC1 creates `flintfire`.
- Authentication proves the current npm account identity and 2FA posture, but the registry does not
  expose a separate dry-run permission check for creating an unscoped package. The RC1 publish is the
  first conclusive creation-permission test.
- `flintfire` availability can change after this plan was written.
- The full test/coverage/release gate was not run while writing this documentation-only plan. The
  implementation and every publish candidate owe the gates in §10.
- No registry publish, dist-tag mutation, GitHub rename, GitHub Release, Pages deployment, npm
  deprecation, branch/tag push, PR, or environment/settings change was executed while preparing this
  playbook.
- Baseline unit and integration suite counts were not measured. Record them during the prep PR;
  branding/configuration work should not reduce either count.
- The eight supplied SVGs and deliberate deletion of legacy `website/public/favicon.svg` are
  verified but remain uncommitted owner changes beside this uncommitted plan. The prep branch must
  preserve and commit all nine filesystem changes; a fresh clone cannot see them until then.

---

## §6 Target release specification

### 6.1 Canonical identities

| Surface | Required value |
| --- | --- |
| Brand | `FlintFire` |
| npm package | `flintfire` |
| Stable version | `3.0.0` |
| Prerelease versions | `3.0.0-rc.1`, then `3.0.0-rc.2` |
| Root import | `flintfire` |
| Vector import | `flintfire/vector` |
| Express import | `flintfire/express` |
| GitHub repo | `https://github.com/reggieofarrell/flintfire` |
| Issues | `https://github.com/reggieofarrell/flintfire/issues` |
| Docs | `https://reggieofarrell.github.io/flintfire/` |
| Migration guide | `https://reggieofarrell.github.io/flintfire/guides/migration-v2-to-v3/` |
| Old npm package | `@reggieofarrell/firestore-orm` (2.x retained, then deprecated) |
| npm RC dist-tag | `next` |
| npm stable dist-tag | `latest` |
| Git tags | `v3.0.0-rc.1`, `v3.0.0-rc.2`, `v3.0.0` |

Consumer import specifiers are `flintfire`, `flintfire/vector`, and `flintfire/express`. Those
are the strings that appear in `import` / `require`. They correspond to the `package.json`
`"exports"` keys `.`, `./vector`, and `./express`. Never tell consumers to import `./vector` or
`./express`; those keys are internal to the export map (T18).

### 6.2 Manifest contract

The preparation PR changes identity but initially leaves the version at 2.2.1 so the release tool
can generate the full v3 entry before RC tags exist:

```json
{
  "name": "flintfire",
  "version": "2.2.1",
  "description": "A type-safe, schema-aware Firestore data-access library for Node.js, built for the Firebase Admin SDK.",
  "repository": {
    "type": "git",
    "url": "https://github.com/reggieofarrell/flintfire"
  },
  "bugs": {
    "url": "https://github.com/reggieofarrell/flintfire/issues"
  },
  "homepage": "https://reggieofarrell.github.io/flintfire/",
  "publishConfig": {
    "access": "public"
  }
}
```

Do not alter the export map, peer ranges, Node floor, files allowlist, or public API as part of the
rename. Keep ORM/Firestore search keywords if they remain accurate discovery terms.

### 6.3 Publish workflow contract

`.github/workflows/publish.yml` must:

1. Trigger only on `release.published`.
2. Keep `id-token: write`, no `NPM_TOKEN`, Node from `.nvmrc`, JDK 21, full release verification,
   Admin 12/13/14 consumer checks, and Firestore 7.9/7.10 boundary checks.
3. Require `release.tag_name === "v" + package.json.version`.
4. Require a semver prerelease manifest when GitHub says prerelease, and a stable manifest when
   GitHub says stable.
5. Emit a validated publish tag: `next` for prerelease, `latest` for stable.
6. Execute `npm publish --tag <validated-tag>`.
7. Use GitHub Environment `npm` once it exists and is protected by the maintainer approval selected
   in phase 2.
8. Update every package/repository comment from the old identity to FlintFire.

The workflow must never derive a tag from untrusted arbitrary text and interpolate it into a shell
command without validation. A small checked-in Node script with unit tests is preferable to growing
an untested inline shell parser.

### 6.4 Changelog generator contract

The generator—not generated Markdown—must normalize malformed conventional-commit notes. The
implementation may use a custom conventional-changelog preset/transform, but it must preserve the
existing type-to-section mappings and new FlintFire URL formats.

Acceptance for:

```bash
npm run release:bump:dry -- --release-as 3.0.0
```

- Selects 3.0.0 and compares `v2.2.1...v3.0.0`.
- Includes the actual breaking changes and Added/Fixed/Changed/Documentation sections.
- Contains no `Co-Authored-By:` or `Co-authored-by:` text.
- Contains no nested `docs(website): archive v2 docs and cut Starlight site over to v3` entry under
  breaking changes.
- New release, commit, compare, and issue links use `reggieofarrell/flintfire`.
- Existing released changelog entries remain unchanged historical records.
- A focused automated test fails with the current malformed note and passes with the transform.

### 6.5 Deprecation contract

The exact old-package deprecation message is:

```text
Renamed to flintfire. Install flintfire@^3. Migration guide: https://reggieofarrell.github.io/flintfire/guides/migration-v2-to-v3/
```

Apply it to `@reggieofarrell/firestore-orm@2.x` only after §7 phase 7 is green. Do not unpublish,
change old dist-tags, or create an old-name v3.

### 6.6 Brand asset contract

Preserve these owner-supplied pairs and exact names under `website/public/`. The suffix names the
mode in which the asset is displayed:

| Role | Light-mode file | Dark-mode file | Release use |
| --- | --- | --- | --- |
| Browser favicon | `favicon-light.svg` | `favicon-dark.svg` | Paired `<link rel="icon">` entries selected with `prefers-color-scheme`; light is the no-media fallback. |
| Splash icon | `flint-fire-icon-light.svg` | `flint-fire-icon-dark.svg` | Both are present in `hero.image.html`; Starlight `data-theme` utility classes show exactly one. |
| Horizontal wordmark | `flint-fire-logo-horizontal-light.svg` | `flint-fire-logo-horizontal-dark.svg` | Published/downloadable brand asset; use only with an explicit theme-aware embedding. |
| Vertical wordmark | `flint-fire-logo-vertical-light.svg` | `flint-fire-logo-vertical-dark.svg` | Published/downloadable brand asset; use only with an explicit theme-aware embedding. |

There must be no `website/public/favicon.svg` or other unsuffixed brand alias. Configure Starlight's
single `favicon` option as `/favicon-light.svg` for a valid legacy/no-media fallback. Add
`website/src/components/ThemeFavicons.astro`, configure it as the Starlight `Head` override, render
`@astrojs/starlight/components/Head.astro` first, and then append light/dark SVG icon links whose
base-aware URLs are `${import.meta.env.BASE_URL}favicon-light.svg` and
`${import.meta.env.BASE_URL}favicon-dark.svg`. Give the appended links
`media="(prefers-color-scheme: light)"` and `media="(prefers-color-scheme: dark)"` respectively. Do
not replace the default Head implementation; delegating first preserves Starlight's title, canonical,
SEO, and other generated tags.

In `website/src/content/docs/index.md`, use `hero.image.html` containing both splash icon files. The
light image uses class `dark:sl-hidden`; the dark image uses `light:sl-hidden`. Give each its correct
intrinsic dimensions or a shared explicit aspect-ratio box and meaningful `alt="FlintFire"`. Use
base-aware `/flintfire/...` sources after the Pages relocation. Do not use a `prefers-color-scheme`
`<picture>` for the page hero: that follows the OS but ignores a visitor's explicit Starlight theme
selection.

Keep the Starlight navigation title as text in this release. The built-in paired `logo` option would
require importable source assets, while these owner-supplied public files are the canonical brand
set and Vite rejects importing them from `public/`. Do not duplicate them under `src/` merely to use
that option, and do not add a custom `SiteTitle` component solely for decoration. Horizontal and
vertical pairs still ship at stable public URLs for theme-aware external use. A README wordmark is
not required by this release; if proposed later, verify both GitHub and npm rendering separately.

The preparation gate must prove:

- `xmllint --noout website/public/*.svg` succeeds;
- no SVG contains script, `foreignObject`, JavaScript URL, or external image/font dependency;
- `docs:build` emits all eight assets and no unsuffixed brand asset;
- every built page has a valid base-prefixed light fallback favicon plus the two media-qualified
  `/flintfire/favicon-{light,dark}.svg` links;
- no built page refers to `/flintfire/favicon.svg` or another unsuffixed brand path;
- exactly one correctly matched splash image is visible in Starlight light and dark themes at desktop
  and mobile widths, including after manually changing the theme away from the OS preference;
- any horizontal/vertical wordmark embedding selects `-light` in light mode and `-dark` in dark mode.

### 6.7 Expected implementation size

This is a broad identity/docs/configuration sweep with no intended library runtime behavior change.
Expect changes in package manifests, both READMEs, active website docs, selected v2 archive URLs,
the eight supplied SVGs plus legacy favicon deletion, the theme-favicon Head component, the built-
asset checker, source JSDoc imports, release/development docs, workflows, scripts,
`.rulesync/` source plus generated config, ADR-0039, and changelog tooling/tests. Do not estimate by
raw file count: active docs alone contain hundreds of old path/import references.

---

## §7 Ordered execution playbook

### Phase 0 — Read-only preflight

Record results in `notes.md`. Do not mutate remote state yet.

#### 0.1 Prove local identity and baseline

```bash
cd "$FLINTFIRE_REPO_ROOT"
git status --short --branch
git fetch --prune --tags origin
git switch main
git status --short --branch
git log -1 --oneline
git rev-parse HEAD origin/main
node --version
npm --version
git rev-parse v2.x origin/v2.x 'v2.2.1^{commit}'
git merge-base --is-ancestor v2.2.1 v2.x
git rev-list --count v2.x..main
git tag --list 'v3*'
```

In a fresh clone where the plan/assets were committed, expect a clean tree. In the owner's current
worktree, the only permitted changes before the prep branch is created are this plan, deletion of
`website/public/favicon.svg`, and additions of:

- `website/public/favicon-light.svg` and `favicon-dark.svg`;
- `website/public/flint-fire-icon-light.svg` and `flint-fire-icon-dark.svg`;
- `website/public/flint-fire-logo-horizontal-light.svg` and
  `flint-fire-logo-horizontal-dark.svg`;
- `website/public/flint-fire-logo-vertical-light.svg` and `flint-fire-logo-vertical-dark.svg`.

Preserve all nine asset filesystem changes. `STOP` for any other change, when `HEAD != origin/main`,
if Node is not 24, npm is older than 11.5.1, v2 refs moved unexpectedly, or any v3 tag already exists
without an explained prior release attempt. Do not pull/rebase over uncommitted owner assets; create
the prep branch first after proving HEAD equals `origin/main`.

#### 0.2 Prove GitHub and npm identities

```bash
gh auth status
gh api user --jq .login
gh repo view reggieofarrell/firestore-orm --json nameWithOwner,visibility,defaultBranchRef,url,viewerPermission,viewerCanAdminister
npm whoami
npm profile get tfa --json
```

Expected GitHub login/owner: `reggieofarrell`. Confirm the npm identity is an account authorized to
create and manage `flintfire`. Do not paste the full npm profile into notes; record only the username,
2FA readiness, and pass/fail.

The 2026-08-23 verification observed GitHub `ADMIN`, npm user `reggieofarrell`, and npm 2FA mode
`auth-and-writes`. `STOP` if any differs at execution time; do not proceed with a half-authenticated
CLI or substitute an unverified browser session.

#### 0.3 Recheck package and release availability

```bash
npm view flintfire --json
npm view '@reggieofarrell/firestore-orm' name version versions dist-tags deprecated maintainers --json
gh repo view reggieofarrell/flintfire
gh release list --repo reggieofarrell/firestore-orm
gh pr list --repo reggieofarrell/firestore-orm --state open
```

Expected: `flintfire` E404; old latest 2.2.1 without deprecation; existing Releases `v2.0.0`,
`v2.2.0`, and `v2.2.1`; no v3 release; no conflicting PR. `STOP` if the new package is owned by
anyone else.

#### 0.4 Snapshot mutable GitHub settings

Re-run the authenticated probes used for P22–P26:

```bash
gh api repos/reggieofarrell/firestore-orm/pages
gh api repos/reggieofarrell/firestore-orm/actions/permissions
gh api repos/reggieofarrell/firestore-orm/actions/permissions/workflow
gh api repos/reggieofarrell/firestore-orm/actions/workflows
gh api repos/reggieofarrell/firestore-orm/environments
gh api 'repos/reggieofarrell/firestore-orm/rulesets?includes_parents=true'
gh api 'repos/reggieofarrell/firestore-orm/branches?per_page=100'
gh api repos/reggieofarrell/firestore-orm/branches/main/protection
gh api repos/reggieofarrell/firestore-orm/immutable-releases
gh api repos/reggieofarrell/firestore-orm
```

The branch-protection call is expected to return HTTP 404 because `main` is unprotected. Expected
snapshot: Pages `build_type=workflow`, no CNAME; only `github-pages` Environment; all three
workflows active; Actions enabled/all with read-only default token; disabled default-branch ruleset;
release immutability disabled; empty About description/homepage/topics. Record drift. This is the
comparison point after the repository rename.

### Phase 1 — Build and merge the FlintFire preparation PR

This phase changes repository content, not remote identity and not any registry package.

#### 1.1 Create the preparation branch

```bash
git switch -c release/flintfire-prep
```

If an agent creates the branch under Codex conventions, use `codex/flintfire-release-prep` instead.
Do not create two competing prep branches. Immediately rerun `git status --short`; the plan and all
nine owner-supplied asset filesystem changes must still be present on the new branch. `STOP` if
switching the branch dropped, rewrote, or hid any of those owner changes.

#### 1.2 Record the decision in ADR-0039

Create `docs/adr/0039-flintfire-package-and-repository-rename.md` from
`docs/adr/0000-template.md`, update `docs/adr/README.md`, and follow the `adr` skill. Status is
`Accepted (3.0.0, pending release)` until stable succeeds. Cover:

- why the brand does not include ORM/ODM taxonomy;
- why semver continues at 3.0.0;
- why the existing repo is renamed rather than replaced;
- one canonical npm v3 identity (`flintfire`);
- v2 retention/deprecation policy;
- new Pages URL and the lack of an old Pages redirect;
- RC1 bootstrap → RC2 OIDC proof → stable OIDC sequence;
- costs: import migration, temporary docs URL break, npm history split across two package names;
- rejected names/repo reset/0.1.0/dual-publish alternatives.

#### 1.3 Rename package and repository metadata, but keep version 2.2.1

Update `package.json`, `package-lock.json`, `NOTICE`, `.versionrc` configuration, website package
metadata/lockfile, and any package-content assertions. Use the values in §6.1–§6.2. Reconcile locks
without a dependency upgrade:

```bash
npm install --package-lock-only --ignore-scripts
npm --prefix website install --package-lock-only --ignore-scripts
npm run check:manifest
```

Review the lock diff. `STOP` if unrelated dependency resolutions change; the rename PR is not a
dependency-update vehicle.

Do not bump the version yet. The 3.0.0 generated changelog must be committed before any RC tag
exists (T5).

#### 1.4 Update user-facing package identity

Follow `readme-sync` and update both `README.md` and `npm-readme.md`:

- `# FlintFire` heading and npm badge/link for `flintfire`;
- the §6.2 data-access-library pitch;
- `npm install flintfire firebase-admin zod` and yarn/pnpm equivalents;
- imports from `flintfire`, `flintfire/vector`, and `flintfire/express`;
- new repository, issue, license, NOTICE, and docs URLs;
- v2→v3 migration note that explicitly says both package name and public contract change;
- retained upstream/fork attribution;
- Node/server-side Admin SDK scope (not the client Firestore SDK).

Update the active Starlight docs and source JSDoc import examples with the same facts. In
`website/src/content/docs/guides/migration-v2-to-v3.md`, keep old imports in clearly labelled v2
examples and use `flintfire` in v3 replacements. The first migration step must be:

```bash
npm uninstall @reggieofarrell/firestore-orm
npm install flintfire@^3 firebase-admin zod
```

Then tell consumers to change every package import specifier before addressing API-level breaking
changes:

- `@reggieofarrell/firestore-orm` → `flintfire`
- `@reggieofarrell/firestore-orm/vector` → `flintfire/vector`
- `@reggieofarrell/firestore-orm/express` → `flintfire/express`

Do not write `./vector` or `./express` in consumer examples. Those are `package.json` `"exports"`
keys, not import specifiers (T18).

#### 1.5 Relocate GitHub Pages without corrupting v2 history

Update:

- `website/astro.config.mjs`: base `/flintfire`, FlintFire title, new repo URL, and every explicit
  redirect target;
- `scripts/check-doc-links.mjs`: `SITE_BASE` and its examples/comments;
- all active docs root-absolute paths `/firestore-orm/...` → `/flintfire/...`;
- `website/VERSIONING.md`, README links, npm README links, and package homepage;
- `website/src/content/docs/2.0/**`: mechanically rewrite only site-path prefix
  `/firestore-orm/` → `/flintfire/` and live repo/docs URLs where present.

In the frozen v2 archive, preserve every `@reggieofarrell/firestore-orm` install/import and every v2
behavioral statement. Update `website/VERSIONING.md` to document this one-time relocation exception
to the archive freeze.

GitHub redirects cannot serve a site under the old Pages project path (T1). Do not add misleading
Astro redirects whose source would still require a request to `/firestore-orm/`.

Integrate the brand assets in the same website sweep:

- retain all eight supplied files at the exact `website/public/` paths in §6.6 and commit deletion
  of the obsolete unsuffixed `favicon.svg`;
- set Starlight's valid fallback favicon to `/favicon-light.svg`;
- add and configure the delegating `ThemeFavicons.astro` Head override specified in §6.6 so both
  media-qualified favicon variants follow the browser color scheme and appear after the fallback;
- add both splash icon variants to `hero.image.html` with base-aware `/flintfire/...` sources,
  correct `dark:sl-hidden` / `light:sl-hidden` classes, intrinsic geometry, and `alt="FlintFire"`;
- keep the Starlight header title as text and do not duplicate public wordmarks into `src/` merely
  to satisfy the built-in logo importer;
- treat horizontal and vertical pairs as published theme-aware brand assets; never embed one without
  selecting the matching mode;
- do not add a README logo as part of this release unless both GitHub and npm rendering are separately
  proven; package identity text and badges remain required regardless.

Add `scripts/check-built-doc-assets.mjs` and chain it after Astro in `website/package.json`'s `build`
script so local builds, the website CI job, release verification, and the Withastro Pages action all
run the same emitted-output guard. The checker must resolve paths from its own file (not the caller's
working directory), require the exact eight files from §6.6, reject any unsuffixed brand file or
reference, and inspect built `index.html` for both favicon media values plus both hero assets/classes.
First run it against the current P28 build and record the expected failure on the dangling
`/firestore-orm/favicon.svg`; after integration it must pass under `/flintfire/`. Also add an explicit
verification step after the Withastro build/upload step in `.github/workflows/deploy-docs.yml`. The
job must fail before the dependent `deploy` job if the checker fails; this explicit step avoids
depending on undocumented internals of the third-party action.

Do not modify the SVG geometry, paths, typography, or colors as part of integration. Run the §6.6
asset checks and visually inspect light/dark desktop and mobile renders before the prep PR merges.

#### 1.6 Update development tooling and generated agent configuration

Rename brand/repository/package references in current development docs, workflow comments, source
JSDoc, package probes, and test documentation. Rename internal compatibility-test variables:

- `FIRESTORE_ORM_ADMIN_VERSION` → `FLINTFIRE_ADMIN_VERSION`
- `FIRESTORE_ORM_FIRESTORE_VERSION` → `FLINTFIRE_FIRESTORE_VERSION`

Update `scripts/check-packed-consumer.mjs`, `.github/workflows/tests.yml`,
`.github/workflows/publish.yml`, and `.rulesync/` source references together. Preserve
`demo-firestoreorm-test` as the explicit internal-fixture exception.

Edit `.rulesync/` sources, never generated copies, then regenerate:

```bash
npm run rules:sync
npm run rules:check
```

Review generated diffs to ensure they reflect only the source rename and environment-variable
updates.

#### 1.7 Make publish automation prerelease-safe

Implement §6.3 in `.github/workflows/publish.yml`. Enable the `npm` Environment only after phase 2
creates/configures it; the prep PR may land with `environment: npm` if the environment will be
created immediately after the repo rename and before any release event.

Add focused automated coverage for release identity/dist-tag selection. At minimum test:

| GitHub release | Manifest | Expected |
| --- | --- | --- |
| prerelease | `3.0.0-rc.2` | accept, npm tag `next` |
| stable | `3.0.0` | accept, npm tag `latest` |
| prerelease | `3.0.0` | reject |
| stable | `3.0.0-rc.2` | reject |
| either | tag differs from `v${version}` | reject |
| malicious/unrecognized release input | any | reject before shell use |

Update `docs/development/releasing.md` with the FlintFire first-package sequence, exact trusted
publisher fields, Environment requirement, RC behavior, stable behavior, and recovery steps from
this playbook.

#### 1.8 Repair changelog generation before producing the release entry

Implement §6.4. Preserve conventional-changelog mappings and make the normalization deterministic
and test-covered. A safe design wraps the conventionalcommits preset and trims parsed breaking-note
text at an actual co-author trailer or squash-message delimiter before the base writer transform;
do not regex arbitrary final Markdown after generation.

Run and save the dry-run output:

```bash
npm run release:bump:dry -- --release-as 3.0.0
```

Manually review every breaking note against `git log v2.2.1..main`. `STOP` if the output still
contains the P14 contamination or omits a known breaking commit.

#### 1.9 Exhaustive rename audit

First enumerate everything, including hidden project configuration:

```bash
rg --hidden -n '(@reggieofarrell/firestore-orm|reggieofarrell/firestore-orm|reggieofarrell\.github\.io/firestore-orm|/firestore-orm/|FIRESTORE_ORM_|FireODM|fireodm)' \
  --glob '!.git/**' \
  --glob '!node_modules/**' \
  --glob '!website/node_modules/**'
```

Every remaining row must be classified in `notes.md`. Valid residuals are limited to:

- old release history in `CHANGELOG.md`;
- historical facts in accepted ADRs;
- v2 package imports/branding in `website/src/content/docs/2.0/**`;
- deliberately old-side examples in the v2→v3 migration guide;
- deprecation/migration instructions in release documentation and this plan;
- fork lineage in `NOTICE`;
- the explicitly retained emulator fixture id.

There must be no old package import in active quick starts, source JSDoc, current API guides, package
metadata, workflow identity, new changelog URLs, or generated current project instructions.

#### 1.10 Verify and merge the preparation PR

Run §10 in full, record suite counts, push, open a PR, and wait for every required CI job. Review the
packed tarball name and README. The PR commit sequence should use Conventional Commits, for example:

```text
feat!: rename the package and project to FlintFire
ci(release): publish prereleases under the next tag
fix(release): normalize generated breaking-change notes
docs: document the FlintFire release migration
```

The breaking rename commit ensures release tooling independently recognizes a major release.

**REMOTE MUTATION:** merge only after maintainer review and all required checks pass. Do not create a
v3 tag or GitHub Release yet.

### Phase 2 — Rename the GitHub repository and restore settings

Do this immediately after the prep PR merges and before creating RC1.

#### 2.1 Rename the existing repository

Reconfirm the new repo name is not occupied, then:

```bash
gh repo view reggieofarrell/flintfire
gh repo rename flintfire --repo reggieofarrell/firestore-orm --yes
```

The first command is expected to report repository-not-found. If it resolves, `STOP` and identify
the owner/state before running the rename.

**REMOTE MUTATION / HUMAN CHECKPOINT:** this renames the public repository. In the web UI the
equivalent is Settings → General → Repository name → `flintfire`.

Never create another repository named `reggieofarrell/firestore-orm`; doing so can break GitHub's
redirect.

#### 2.2 Update the local remote and prove the redirect

```bash
git remote set-url origin git@github.com:reggieofarrell/flintfire.git
git remote -v
git fetch --prune --tags origin
gh repo view reggieofarrell/flintfire --json nameWithOwner,visibility,defaultBranchRef,url
git ls-remote git@github.com:reggieofarrell/firestore-orm.git HEAD
git ls-remote git@github.com:reggieofarrell/flintfire.git HEAD
```

Both remote URLs should resolve to the same HEAD during the redirect period. Record it.

#### 2.3 Restore and verify GitHub settings

Compare against phase 0.4 and explicitly verify:

- default branch remains `main`;
- `v2.x` and all other pre-rename branches remain present;
- the `default branch protections` ruleset still exists with `enforcement=disabled`, and classic
  `main` protection still returns 404, unless the maintainer separately chose to enable protection;
- Actions remain enabled for all actions, with read-only default workflow-token permissions, and
  `publish.yml`, `deploy-docs.yml`, and `tests.yml` are all recognized as active;
- Pages remains `build_type=workflow`, with no CNAME unless a separate custom-domain decision was
  made;
- release immutability remains disabled and existing v2 Releases remain present with
  `immutable=false`; this playbook does not rely on immutability or silently enable it;
- repository About description uses the §6.2 pitch;
- homepage is `https://reggieofarrell.github.io/flintfire/`;
- set accurate topics including `flintfire`, `firestore`, `firebase-admin`, and `typescript` (the
  baseline topic list is empty).

Apply only the intended empty-to-FlintFire About metadata change, then repeat the phase 0.4 probes
against the renamed repository and save the comparison:

```bash
gh repo edit reggieofarrell/flintfire \
  --description 'A type-safe, schema-aware Firestore data-access library for Node.js, built for the Firebase Admin SDK.' \
  --homepage 'https://reggieofarrell.github.io/flintfire/' \
  --add-topic flintfire \
  --add-topic firestore \
  --add-topic firebase-admin \
  --add-topic typescript
gh api repos/reggieofarrell/flintfire/pages
gh api repos/reggieofarrell/flintfire/actions/permissions
gh api repos/reggieofarrell/flintfire/actions/permissions/workflow
gh api repos/reggieofarrell/flintfire/actions/workflows
gh api repos/reggieofarrell/flintfire/environments
gh api 'repos/reggieofarrell/flintfire/rulesets?includes_parents=true'
gh api 'repos/reggieofarrell/flintfire/branches?per_page=100'
gh api repos/reggieofarrell/flintfire/branches/main/protection
gh api repos/reggieofarrell/flintfire/immutable-releases
gh api repos/reggieofarrell/flintfire
gh release list --repo reggieofarrell/flintfire
```

**REMOTE MUTATION / HUMAN CHECKPOINT:** `gh repo edit` changes public About metadata. The classic
protection probe is still expected to return HTTP 404; treat it as a recorded result, not a failed
rename. `STOP` if any branch, workflow, Release, or unrelated setting disappeared.

Create GitHub Environment `npm`, require Reggie's approval, and allow only version tags. Because the
same maintainer normally creates the GitHub Release and approves its deployment, set
`prevent_self_review=false`; setting it to `true` would deadlock a sole-maintainer release. Use the
authenticated user id instead of copying a magic number:

```bash
export FLINTFIRE_OWNER_ID="$(gh api user --jq .id)"
jq -n --argjson reviewer_id "$FLINTFIRE_OWNER_ID" \
  '{wait_timer: 0, prevent_self_review: false, reviewers: [{type: "User", id: $reviewer_id}], deployment_branch_policy: {protected_branches: false, custom_branch_policies: true}}' \
  | gh api --method PUT \
      -H 'X-GitHub-Api-Version: 2026-03-10' \
      repos/reggieofarrell/flintfire/environments/npm \
      --input -
gh api --method POST \
  -H 'X-GitHub-Api-Version: 2026-03-10' \
  repos/reggieofarrell/flintfire/environments/npm/deployment-branch-policies \
  -f name='v*' -f type='tag'
gh api repos/reggieofarrell/flintfire/environments/npm
gh api repos/reggieofarrell/flintfire/environments/npm/deployment-branch-policies
```

Expected: one required User reviewer (`reggieofarrell`), self-review allowed, custom branch/tag
policies enabled, and exactly one `type=tag`, `name=v*` policy. **REMOTE MUTATION / HUMAN
CHECKPOINT:** review the PUT/POST target before running. Do not store an npm token or any secret in
the environment; Trusted Publishing uses the workflow's `id-token: write` permission.

The old Pages URL will not redirect. Do not manually deploy prerelease docs; the new stable URL will
come online from the stable release tag in phase 6.

### Phase 3 — Generate the full 3.0.0 release entry before any RC tag

#### 3.1 Start the release branch from renamed `main`

```bash
git switch main
git pull --ff-only
git status --short --branch
git tag --list 'v3*'
git switch -c release/3.0.0
```

Expected: clean tree and no v3 tag. `STOP` otherwise.

#### 3.2 Generate and commit the stable changelog/version first

```bash
npm run release:bump:dry -- --release-as 3.0.0
npm run release:bump -- --release-as 3.0.0
git status --short --branch
git show --stat --oneline HEAD
```

`commit-and-tag-version` should create `chore(release): 3.0.0`, update `package.json` and
`package-lock.json` to 3.0.0, and generate the complete v2.2.1→v3.0.0 `CHANGELOG.md` entry. It must
not tag. Reapply every §6.4 acceptance check to the committed output.

Do not regenerate the changelog after creating RC tags.

#### 3.3 Temporarily set RC1 manifest identity

```bash
npm version 3.0.0-rc.1 --no-git-tag-version --ignore-scripts
npm run check:manifest
git diff -- package.json package-lock.json CHANGELOG.md
git add package.json package-lock.json
git commit -m "chore(release): stage 3.0.0-rc.1"
```

Expected diff: manifest/lock version only; `CHANGELOG.md` remains the generated stable entry.

Run the complete release-candidate gate in §10, push the branch, and open a release PR as a draft:

```bash
git push -u origin release/3.0.0
gh pr create --repo reggieofarrell/flintfire --base main --head release/3.0.0 \
  --draft --title "chore(release): FlintFire 3.0.0" \
  --body "Stages the FlintFire RCs and final 3.0.0 manifest. Do not merge until RC2 proves OIDC."
```

**REMOTE MUTATION:** branch push and draft PR. Do not merge while the manifest is an RC.

### Phase 4 — Publish RC1 manually to bootstrap npm

#### 4.1 Final RC1 preflight

```bash
git status --short --branch
node -p "const p=require('./package.json'); [p.name,p.version,p.repository.url,p.homepage].join('\n')"
npm view flintfire --json
npm whoami
npm run release:verify
npm pack --dry-run
```

Expected identity: `flintfire`, `3.0.0-rc.1`, new repo, new docs; npm still E404; clean tree after
pack. If pack staging is interrupted:

```bash
node scripts/stage-npm-readme.mjs restore
```

#### 4.2 Create the reproducibility tag

```bash
export FLINTFIRE_RC1_SHA="$(git rev-parse HEAD)"
git tag -a v3.0.0-rc.1 "$FLINTFIRE_RC1_SHA" -m "FlintFire 3.0.0-rc.1"
git show v3.0.0-rc.1:package.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).version))"
git push origin v3.0.0-rc.1
```

Expected version output: `3.0.0-rc.1`.

**REMOTE MUTATION:** tag push. Do not publish a GitHub prerelease for RC1; that would trigger the
OIDC workflow and attempt to republish the same immutable version after the manual bootstrap.

#### 4.3 Bootstrap the npm package

```bash
npm publish --access public --tag next
```

**REMOTE MUTATION / HUMAN CHECKPOINT:** a human supplies npm 2FA/OTP when prompted. Do not put an OTP
on the command line or in notes.

If the command appears to fail, query the exact version before retrying:

```bash
npm view flintfire@3.0.0-rc.1 version dist.tarball dist.integrity --json
```

If the version exists, do not republish.

#### 4.4 Verify RC1 from the registry

```bash
npm view flintfire name version versions dist-tags repository homepage engines peerDependencies --json
npm view flintfire@3.0.0-rc.1 dist.integrity dist.shasum dist.tarball --json
npm pack flintfire@3.0.0-rc.1 --dry-run
```

Expected: only `next=3.0.0-rc.1`; no accidental `latest`; new README/metadata; correct peers and
subpath files.

Run a clean temporary consumer smoke test with Node 24. Install `express` when loading the optional
Express subpath:

```bash
export FLINTFIRE_SMOKE_DIR="$(mktemp -d)"
cd "$FLINTFIRE_SMOKE_DIR"
npm init --yes
npm install flintfire@3.0.0-rc.1 firebase-admin@14 zod@4 express@5
node --input-type=module -e "await import('flintfire'); await import('flintfire/vector'); await import('flintfire/express'); console.log('esm ok')"
node -e "require('flintfire'); require('flintfire/vector'); require('flintfire/express'); console.log('cjs ok')"
cd "$FLINTFIRE_REPO_ROOT"
```

Record the temporary path; cleanup is optional and must target that exact path, never a broad temp
directory.

#### 4.5 Configure npm Trusted Publishing

On npmjs.com → `flintfire` → Settings → Trusted Publisher, choose GitHub Actions and enter exactly:

| Field | Value |
| --- | --- |
| GitHub owner/user | `reggieofarrell` |
| Repository | `flintfire` |
| Workflow filename | `publish.yml` |
| Environment | `npm` |
| Allowed action | `npm publish` |

**HUMAN CHECKPOINT:** save the settings and capture a non-secret screenshot or textual confirmation
in `notes.md`. Do not disallow tokens until RC2 proves OIDC; retain only the minimum bootstrap access
until then.

An authenticated operator may use the npm 11 CLI instead of the web form. Map the website fields to
npm 11.16.0 flags — do **not** copy GitHub CLI or website labels onto `npm trust` (T19):

| Website field | npm 11 flag | Value |
| --- | --- | --- |
| GitHub owner + Repository | `--repository` | `reggieofarrell/flintfire` |
| Workflow filename | `--file` | `publish.yml` |
| Environment | `--environment` | `npm` |
| Allowed action `npm publish` | `--allow-publish` | (boolean flag) |

`npm trust github` has no `--workflow` flag. `--workflow` belongs to `gh run list` and will fail on
npm 11. `--file` is required and is the workflow filename only (`publish.yml`), not a path. Do not
pass `--allow-stage-publish`. `--repo` and `--env` are aliases of `--repository` and
`--environment`; this playbook uses the long forms. Run these commands on Node 24 / npm ≥ 11.5.1;
npm 10 has no `trust` command.

```bash
npm trust github flintfire \
  --repository reggieofarrell/flintfire \
  --file publish.yml \
  --environment npm \
  --allow-publish \
  --dry-run \
  --json
npm trust github flintfire \
  --repository reggieofarrell/flintfire \
  --file publish.yml \
  --environment npm \
  --allow-publish \
  --yes
npm trust list flintfire --json
```

**REMOTE MUTATION / HUMAN CHECKPOINT:** `npm trust github` changes package security settings and may
require interactive 2FA. The listed relationship must match all five table values before RC2.

### Phase 5 — Publish RC2 through OIDC

#### 5.1 Stage the RC2 manifest

```bash
git switch release/3.0.0
npm version 3.0.0-rc.2 --no-git-tag-version --ignore-scripts
npm run check:manifest
git diff -- package.json package-lock.json CHANGELOG.md
git add package.json package-lock.json
git commit -m "chore(release): stage 3.0.0-rc.2"
npm run release:verify
git push origin release/3.0.0
```

Expected diff: version only; unchanged generated 3.0.0 changelog; all gates green.

#### 5.2 Tag and publish the GitHub prerelease

Prepare concise RC notes from the generated 3.0.0 changelog plus an explicit prerelease warning in
an operator-controlled temporary file. Review it before publishing.

```bash
export FLINTFIRE_RC2_SHA="$(git rev-parse HEAD)"
git tag -a v3.0.0-rc.2 "$FLINTFIRE_RC2_SHA" -m "FlintFire 3.0.0-rc.2"
git push origin v3.0.0-rc.2
gh release create v3.0.0-rc.2 \
  --repo reggieofarrell/flintfire \
  --verify-tag \
  --prerelease \
  --latest=false \
  --title "FlintFire 3.0.0-rc.2" \
  --notes-file /tmp/flintfire-v3.0.0-rc.2-notes.md
```

**REMOTE MUTATION / HUMAN CHECKPOINT:** publishing the GitHub prerelease triggers the npm workflow;
approve the `npm` Environment after confirming the release tag and SHA shown in Actions.

#### 5.3 Observe, do not race, the publish workflow

```bash
gh run list --repo reggieofarrell/flintfire --workflow publish.yml --limit 5 \
  --json databaseId,displayTitle,headSha,status,conclusion,url
export FLINTFIRE_PUBLISH_RUN_ID="<databaseId whose headSha equals $FLINTFIRE_RC2_SHA>"
gh run watch "$FLINTFIRE_PUBLISH_RUN_ID" --repo reggieofarrell/flintfire --exit-status
```

Replace the angle-bracket placeholder after matching the SHA; never assume the newest run is the
intended run. Confirm logs show:

- tag `v3.0.0-rc.2` = manifest `3.0.0-rc.2`;
- prerelease accepted and npm tag resolved to `next`;
- all release and compatibility gates passed;
- authentication used OIDC, not `NPM_TOKEN`;
- publish completed once.

If it fails before npm accepts the version, fix Trusted Publisher/Environment/workflow settings and
rerun the failed workflow. If npm already has the version, do not rerun the publish step.

#### 5.4 Verify OIDC RC2

```bash
npm view flintfire@3.0.0-rc.2 version repository dist.integrity dist.attestations --json
npm view flintfire dist-tags --json
```

Expected: `next=3.0.0-rc.2`, no accidental stable `latest`, new repo, and provenance/attestation
visible in npm metadata or on the npm package page. Repeat the clean ESM/CJS/subpath consumer smoke
from phase 4 using `3.0.0-rc.2`, then run this inside that installed consumer:

```bash
npm audit signatures
```

The audit must verify FlintFire's provenance attestation. For forensic output, use
`npm audit signatures --json --include-attestations` and retain only non-secret verification
metadata in `notes.md`.

**HUMAN CHECKPOINT:** after OIDC is proven, set npm Publishing access to require 2FA and disallow
long-lived tokens if compatible with the maintainer's recovery policy. Revoke any one-time granular
bootstrap token that was used.

### Phase 6 — Finalize, merge, and publish stable 3.0.0

#### 6.1 Restore stable manifest without regenerating the changelog

```bash
git switch release/3.0.0
npm version 3.0.0 --no-git-tag-version --ignore-scripts
npm run check:manifest
git diff -- package.json package-lock.json CHANGELOG.md
git add package.json package-lock.json
git commit -m "chore(release): finalize 3.0.0"
```

Expected diff: version only. The previously generated v2.2.1→v3.0.0 changelog stays unchanged.

#### 6.2 Run the final local release gate and update the PR

Run every §10 command, the exhaustive rename audit, and the registry-independent package checks.
Then:

```bash
git push origin release/3.0.0
gh pr ready --repo reggieofarrell/flintfire
gh pr checks --repo reggieofarrell/flintfire --watch
```

Review the final PR diff as a release artifact:

- final manifest is `flintfire@3.0.0`;
- changelog is complete and clean;
- RC-only version diffs cancel in the final tree;
- no tag or release points at an unmerged commit for stable;
- preparation decisions and docs match §1;
- all required CI jobs are green.

**REMOTE MUTATION / HUMAN CHECKPOINT:** merge the PR. Record the exact merge SHA.

#### 6.3 Prove main and prepare release notes

```bash
git switch main
git pull --ff-only
git status --short --branch
export FLINTFIRE_V3_SHA="$(git rev-parse HEAD)"
node -p "require('./package.json').name + '@' + require('./package.json').version"
git tag --list v3.0.0
npm view flintfire@3.0.0 version
```

Expected: clean main at the recorded merge SHA, `flintfire@3.0.0`, no `v3.0.0` tag, and npm 3.0.0
not found.

Create `/tmp/flintfire-v3.0.0-notes.md` from the generated 3.0.0 changelog section. Add a short
rename banner and direct migration-guide URL; do not include the next older version heading. Review
the rendered Markdown.

#### 6.4 Create the stable tag and GitHub Release

```bash
git tag -a v3.0.0 "$FLINTFIRE_V3_SHA" -m "FlintFire 3.0.0"
git show v3.0.0:package.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s);console.log(p.name+'@'+p.version)})"
git push origin v3.0.0
gh release create v3.0.0 \
  --repo reggieofarrell/flintfire \
  --verify-tag \
  --latest \
  --title "FlintFire 3.0.0" \
  --notes-file /tmp/flintfire-v3.0.0-notes.md
```

Expected tag inspection: `flintfire@3.0.0`.

**REMOTE MUTATION / HUMAN CHECKPOINT:** the tag push is non-publishing; publishing the GitHub Release
triggers both npm publish and stable Pages deployment. Approve the `npm` Environment only after the
Actions run shows the expected tag/SHA.

#### 6.5 Watch both stable workflows

```bash
gh run list --repo reggieofarrell/flintfire --workflow publish.yml --limit 5 \
  --json databaseId,displayTitle,headSha,status,conclusion,url
gh run list --repo reggieofarrell/flintfire --workflow deploy-docs.yml --limit 5 \
  --json databaseId,displayTitle,headSha,status,conclusion,url
export FLINTFIRE_PUBLISH_RUN_ID="<publish databaseId whose headSha equals $FLINTFIRE_V3_SHA>"
export FLINTFIRE_DOCS_RUN_ID="<docs databaseId whose headSha equals $FLINTFIRE_V3_SHA>"
gh run watch "$FLINTFIRE_PUBLISH_RUN_ID" --repo reggieofarrell/flintfire --exit-status
gh run watch "$FLINTFIRE_DOCS_RUN_ID" --repo reggieofarrell/flintfire --exit-status
```

Replace both placeholders only after matching their SHAs. Do not treat one green workflow as
proof of the other. The npm run must resolve `latest`; the docs run must check out `v3.0.0` and
deploy the `/flintfire/` build.

### Phase 7 — Verify the stable release from outside the repository

All checks in this phase must pass before old-package deprecation.

#### 7.1 Verify GitHub identity

```bash
gh release view v3.0.0 --repo reggieofarrell/flintfire --json url,tagName,targetCommitish,isDraft,isPrerelease
git ls-remote --tags origin refs/tags/v3.0.0
git rev-list -n 1 v3.0.0
```

The tag's peeled commit must equal `$FLINTFIRE_V3_SHA`; release is published, stable, and latest.

#### 7.2 Verify npm metadata, dist-tags, and provenance

```bash
npm view flintfire@3.0.0 name version repository homepage engines peerDependencies exports dist --json
npm view flintfire dist-tags --json
npm pack flintfire@3.0.0 --dry-run
```

Expected:

- `latest=3.0.0`;
- `next` still points to RC2 until deliberately removed below;
- repository/homepage use FlintFire URLs;
- root, vector, and express export maps are present;
- packed README is the npm README and contains the new install/import instructions;
- npm package page shows provenance from `reggieofarrell/flintfire` / `publish.yml`.

If stable provenance is missing, `STOP`; do not deprecate the old package.

#### 7.3 Run a clean stable consumer smoke

Repeat phase 4's temp consumer with `flintfire@3.0.0`, Node 24, Admin 14, Zod 4, and Express 5.
Confirm ESM and CJS load the root, vector, and express entry points.

Also repeat with declared peer majors using isolated directories or the repository's packed-consumer
probe:

```bash
FLINTFIRE_ADMIN_VERSION='^12.0.0' npm run check:consumer
FLINTFIRE_ADMIN_VERSION='^13.0.0' npm run check:consumer
FLINTFIRE_ADMIN_VERSION='^14.0.0' npm run check:consumer
FLINTFIRE_ADMIN_VERSION='^12.0.0' FLINTFIRE_FIRESTORE_VERSION='7.9.0' npm run check:consumer
FLINTFIRE_ADMIN_VERSION='^12.0.0' FLINTFIRE_FIRESTORE_VERSION='7.10.0' npm run check:consumer
```

The repo probe packages the local stable tree; the temporary install proves the registry artifact.
Both are required evidence. Inside the registry-installed stable consumer, run
`npm audit signatures` and confirm FlintFire's provenance attestation verifies.

#### 7.4 Verify Pages and migration links

```bash
curl --fail --silent --show-error --location --output /dev/null https://reggieofarrell.github.io/flintfire/
curl --fail --silent --show-error --location --output /dev/null https://reggieofarrell.github.io/flintfire/getting-started/
curl --fail --silent --show-error --location --output /dev/null https://reggieofarrell.github.io/flintfire/guides/migration-v2-to-v3/
curl --fail --silent --show-error --location --output /dev/null https://reggieofarrell.github.io/flintfire/2.0/
for asset in \
  favicon-light.svg favicon-dark.svg \
  flint-fire-icon-light.svg flint-fire-icon-dark.svg \
  flint-fire-logo-horizontal-light.svg flint-fire-logo-horizontal-dark.svg \
  flint-fire-logo-vertical-light.svg flint-fire-logo-vertical-dark.svg; do
  curl --fail --silent --show-error --location --output /dev/null \
    "https://reggieofarrell.github.io/flintfire/$asset"
done
```

Open the pages in a browser and manually verify:

- assets/styles load under `/flintfire/`;
- site title and GitHub link say FlintFire;
- current install/import examples use `flintfire`;
- v2/v3 switcher works;
- v2 archive links stay under `/flintfire/2.0/` while v2 imports retain the old package name;
- migration guide starts with package uninstall/install/import changes;
- browser tab selects the light favicon under a light browser preference and the dark favicon under
  a dark preference, with no request for `/flintfire/favicon.svg`;
- the splash icon has useful alternative text and switches correctly when the Starlight theme picker
  is changed independently of the OS preference;
- exactly one splash variant is visible in each theme at desktop and mobile widths;
- any horizontal/vertical wordmark embedding selects the matching light/dark file.

#### 7.5 Clean prerelease dist-tag

After stable npm and docs verification:

```bash
npm dist-tag rm flintfire next
npm dist-tag ls flintfire
```

**REMOTE MUTATION:** expected remaining canonical tag is `latest: 3.0.0`. Removing `next` does not
delete either RC version.

#### 7.6 Recommended soak

Wait 24 hours while monitoring install reports, Actions, npm metadata, and docs. The maintainer may
explicitly waive the wait because npm deprecation is reversible, but may not waive the verification
checks above. Record the choice and timestamp.

### Phase 8 — Deprecate the old 2.x npm line

#### 8.1 Reconfirm replacement health and old state

```bash
npm view flintfire@3.0.0 name version dist-tags repository homepage --json
npm view '@reggieofarrell/firestore-orm' versions dist-tags deprecated --json
```

Expected: FlintFire stable and healthy; old 2.x still present and not yet deprecated.

#### 8.2 Preview and apply deprecation

```bash
npm deprecate --dry-run '@reggieofarrell/firestore-orm@2.x' 'Renamed to flintfire. Install flintfire@^3. Migration guide: https://reggieofarrell.github.io/flintfire/guides/migration-v2-to-v3/'
npm deprecate '@reggieofarrell/firestore-orm@2.x' 'Renamed to flintfire. Install flintfire@^3. Migration guide: https://reggieofarrell.github.io/flintfire/guides/migration-v2-to-v3/'
```

**REMOTE MUTATION / HUMAN CHECKPOINT:** review the dry-run package range and exact message before
executing the second command. The single quotes are important in zsh.

#### 8.3 Verify every old version and an install warning

```bash
npm view '@reggieofarrell/firestore-orm' versions dist-tags --json
npm view '@reggieofarrell/firestore-orm@2.0.0' deprecated
npm view '@reggieofarrell/firestore-orm@2.0.1' deprecated
npm view '@reggieofarrell/firestore-orm@2.1.0' deprecated
npm view '@reggieofarrell/firestore-orm@2.2.0' deprecated
npm view '@reggieofarrell/firestore-orm@2.2.1' deprecated
```

All five must print exactly the canonical message. In a fresh temp directory, install
`@reggieofarrell/firestore-orm@2.2.1` and confirm npm emits the deprecation warning. Do not commit the
temporary install.

If the message is wrong, rerun `npm deprecate` with the corrected text. Emergency reversal:

```bash
npm deprecate '@reggieofarrell/firestore-orm@2.x' ''
```

Use reversal only when the replacement is unavailable or the warning is materially incorrect.

### Phase 9 — Closeout

1. Update ADR-0039 status to `Accepted (released in 3.0.0)` and add the release/PR links.
2. Record the final package URL, release URL, workflow URLs, Pages deployment URL, stable SHA,
   registry integrity, provenance result, dist-tags, and deprecation output in `notes.md`.
3. Confirm `v2.x`, all v2 tags, and old npm versions still exist unchanged.
4. Confirm there is no `@reggieofarrell/firestore-orm@3`.
5. File separate issues for any non-blocking custom-domain, announcement, additional brand-variant,
   or other follow-up work; the supplied release assets themselves are not deferred.
6. Have an independent reviewer walk §4 traps against the actual result.
7. After release/deprecation review is complete, remove this temporary plan directory in a cleanup
   PR; ADR-0039 and `docs/development/releasing.md` are the durable records.
8. End with a clean `main` worktree and no unpushed release commit or tag.

---

## §8 Test and verification specification

### 8.1 Preparation-PR automated coverage

| Id | Test / check | Observable failure | Guards |
| --- | --- | --- | --- |
| **R-1** | Release identity helper accepts prerelease + RC manifest and yields `next`. | Prerelease workflow cannot select a safe tag. | T3, T4 |
| **R-2** | Helper accepts stable + stable manifest and yields `latest`. | Stable cannot become canonical. | T3, T4 |
| **R-3** | Helper rejects GitHub/manifest prerelease disagreement. | Wrong tree can publish under wrong tag. | T3, T4 |
| **R-4** | Helper rejects release tag != `v${version}`. | Release identity can drift. | T4 |
| **R-5** | Changelog fixture removes trailers/nested squash text but retains the breaking note. | Malformed release notes ship or real notes disappear. | T6 |
| **R-6** | `release:bump:dry --release-as 3.0.0` passes §6.4 review. | Range/links/notes are wrong. | T5, T6 |
| **R-7** | `check:manifest` proves manifest/lock name and version agreement. | Pack identity differs from source identity. | T4 |
| **R-8** | `check:package` proves tarball allowlist and npm README staging. | Wrong README/name or internal files ship. | T8 |
| **R-9** | `check:consumer` loads ESM/CJS and all declared subpaths. | Rename breaks module resolution. | T4, T8 |
| **R-10** | `check:docs` and `docs:build` pass after base relocation. | Active/v2 links or assets use the old base. | T1, T10 |
| **R-11** | `rules:check` passes. | Generated config drift remains. | T9 |
| **R-12** | Exhaustive `rg` residual audit is classified. | Partial rename silently survives. | T10 |
| **R-13** | Eight-SVG structural/security checks, built-head assertions, and light/dark desktop/mobile render review pass. | A malformed/unsafe asset ships, an unsuffixed favicon silently 404s, both/neither hero variants display, or a mode pair is inverted. | T17 |
| **R-14** | Active docs/READMEs/JSDoc use `flintfire`, `flintfire/vector`, and `flintfire/express`; negative grep finds no consumer `from './vector'` / `from './express'`. | Consumers are told to import a relative path or a non-existent subpath. | T18 |
| **R-15** | After RC1, `npm trust github … --dry-run --json` then `npm trust list flintfire --json` show `--file publish.yml`, repository `reggieofarrell/flintfire`, environment `npm`, and allow-publish. | Trusted Publishing is not bound to the renamed repo/workflow, or `--workflow` was used and the CLI failed. | T19 |

Every newly added unit test must be demonstrated failing against the unfixed prep branch state
before being accepted. Release/config tests belong to the unit suite and its unit coverage gate.
Runtime library behavior is not intended to change; existing unit/integration suite counts may
increase but must not decrease.

### 8.2 Remote release evidence

| Id | Evidence | Required result |
| --- | --- | --- |
| **O-1** | RC1 exact registry view and clean consumer | `next=rc.1`; root/vector/express load |
| **O-2** | RC2 Actions logs | OIDC, Environment approval, `next`, full gate, one publish |
| **O-3** | RC2 npm provenance and consumer | Attestation points to renamed repo/workflow |
| **O-4** | Stable Actions logs | OIDC, `latest`, full gate, one publish |
| **O-5** | Stable tag/release SHA | Exact merged `main` SHA |
| **O-6** | Stable registry consumer | ESM+CJS root/vector/express load from npm |
| **O-7** | Stable npm metadata/provenance | New repo/homepage, correct peers/exports, attestation |
| **O-8** | Pages smoke | Current, migration, and v2 archive routes work under `/flintfire/` |
| **O-9** | Old-package views/install | Every 2.x version emits the canonical deprecation message |
| **O-10** | Preservation audit | v2 branch/tags/versions unchanged; no old-name v3 |
| **O-11** | Deployed brand smoke | All eight assets return 200; media-aware favicons and picker-aware hero select the matching mode; no unsuffixed brand request occurs |

---

## §9 Documentation and ADR bookkeeping

### 9.1 New ADR

Create `docs/adr/0039-flintfire-package-and-repository-rename.md` and add it to
`docs/adr/README.md`. Do not rewrite accepted ADRs 0001–0038 merely to replace old repository or
package strings; their historical facts remain true, and GitHub repository links redirect.

### 9.2 Dual READMEs

Per `readme-sync`, both READMEs owe the shared package name, pitch, install, peers, quick start,
subpaths, docs, support, and migration facts. Preserve their audience-specific sections and the
`<!-- npm-readme -->` marker.

### 9.3 Website

Update all active pages because nearly every guide has old imports or base paths. Mechanically
relocate v2 archive URLs but preserve its old package identity. Update `website/VERSIONING.md` with
the one-time archive relocation exception and release-trigger behavior. Commit all eight supplied
SVGs plus deletion of the legacy favicon, keep the text site title, add the delegating theme-favicon
Head component, and use both icon variants in the splash hero under §6.6. Browser-check favicon
media selection and splash theme-picker selection in light and dark modes at desktop and mobile
sizes; a successful Astro build alone does not detect a missing unsuffixed favicon or an inverted
pair.

### 9.4 Contributor/release docs

Update `docs/development/releasing.md` to be a durable general release guide for FlintFire after this
one-time plan is removed. Update `docs/development/testing.md` only where project identity or renamed
compatibility variables occur. Do not copy this entire one-time sequence into ordinary contributor
docs.

### 9.5 Release notes and changelog

The 3.0.0 changelog is generated before RC tags and remains unchanged while manifests move through
the RC versions. GitHub Release notes are reviewed from that generated section and add the package
rename/migration link. Do not hand-edit released changelog history.

---

## §10 Gates, review, and commits

### 10.1 Full project gate for the preparation and final release PRs

Run all fourteen legs and report actual output:

```bash
npm run test:types && npm run lint && npm run check:format && npm run test:unit && npm run test:integration:emulator && npm run test:unit:coverage && npm run test:coverage:gate:unit && npm run test:integration:coverage && npm run test:coverage:gate:integration && npm run build && npm run check:package && npm run check:consumer && npm run check:docs && npm run docs:build
```

Then run the release superset:

```bash
npm run release:verify
```

`release:verify` adds `rules:check`, manifest/lock agreement, and runtime audit. It does not replace
the explicit fourteen-leg record required by the project.

Run the brand-asset structural/security checks and record the browser review separately:

```bash
xmllint --noout \
  website/public/favicon-light.svg \
  website/public/favicon-dark.svg \
  website/public/flint-fire-icon-light.svg \
  website/public/flint-fire-icon-dark.svg \
  website/public/flint-fire-logo-horizontal-light.svg \
  website/public/flint-fire-logo-horizontal-dark.svg \
  website/public/flint-fire-logo-vertical-light.svg \
  website/public/flint-fire-logo-vertical-dark.svg
if rg -n -i '<script|<foreignObject|javascript:|<(image|use)\b|@font-face|url\(|(href|xlink:href)="(https?:|//|data:)' \
  website/public/*-light.svg website/public/*-dark.svg; then
  echo 'STOP: review executable or external SVG content' >&2
  exit 1
fi
for asset in \
  favicon-light.svg favicon-dark.svg \
  flint-fire-icon-light.svg flint-fire-icon-dark.svg \
  flint-fire-logo-horizontal-light.svg flint-fire-logo-horizontal-dark.svg \
  flint-fire-logo-vertical-light.svg flint-fire-logo-vertical-dark.svg; do
  test -s "website/dist/$asset" || {
    echo "STOP: missing built asset $asset" >&2
    exit 1
  }
done
test ! -e website/dist/favicon.svg
rg -n 'favicon-light\.svg|favicon-dark\.svg|prefers-color-scheme: (light|dark)' website/dist/index.html
rg -n 'flint-fire-icon-light\.svg|flint-fire-icon-dark\.svg|dark:sl-hidden|light:sl-hidden' website/dist/index.html
if rg -n '/flintfire/(favicon|flint-fire-(icon|logo-(horizontal|vertical)))\.svg' website/dist; then
  echo 'STOP: unsuffixed built brand reference' >&2
  exit 1
fi
```

The guarded `rg` command must produce no executable/external dependency finding; harmless namespace
or DTD URLs must be reviewed and classified rather than treated as executable content. The built-
site probes must find all eight assets, both favicon media modes, both hero variants, and no
unsuffixed brand reference. Then complete the manual light/dark desktop/mobile checks from §6.6;
static HTML assertions cannot prove the browser or Starlight theme selection visibly chose the right
variant.

### 10.2 Compatibility legs

```bash
FLINTFIRE_ADMIN_VERSION='^12.0.0' npm run check:consumer
FLINTFIRE_ADMIN_VERSION='^13.0.0' npm run check:consumer
FLINTFIRE_ADMIN_VERSION='^14.0.0' npm run check:consumer
FLINTFIRE_ADMIN_VERSION='^12.0.0' FLINTFIRE_FIRESTORE_VERSION='7.9.0' npm run check:consumer
FLINTFIRE_ADMIN_VERSION='^12.0.0' FLINTFIRE_FIRESTORE_VERSION='7.10.0' npm run check:consumer
```

Run after the variable rename lands. CI publish must run the same declared-range checks.

### 10.3 Commit guidance

Use Conventional Commits. The preparation rename is breaking and belongs in the generated 3.0.0
entry. Release-tool commits and the explicit RC/final manifest commits are specified in §7. Do not
hand-edit `CHANGELOG.md`, bypass commit hooks, or push a release branch with a failing gate.

### 10.4 Refute-first review

Before each publish ask, with evidence:

- Could this command publish the wrong package, version, commit, or dist-tag?
- Could a failed-looking run already have published?
- Did a bulk rename change a v2 import that must stay old?
- Did consumer examples use `flintfire/vector` and `flintfire/express`, or did they leak
  `./vector` / `./express` export keys?
- Did Trusted Publisher CLI use `--file publish.yml`, or the `gh` flag `--workflow`?
- Did an old Pages base survive in active content or a v2 link?
- Did any `-light` / `-dark` pair get inverted, did an unsuffixed brand reference survive, or did
  any supplied asset disappear during the branch/rename sweep?
- Does the npm tarball show `npm-readme.md`, not the GitHub contributor README?
- Is provenance bound to `reggieofarrell/flintfire` and `publish.yml`?
- Is deprecation happening only after the replacement is independently installable?
- What exact recovery is available if the next remote mutation succeeds only partially?

Do not proceed until the answers are concrete.

---

## §11 Definition of done

| # | Item |
| --- | --- |
| 1 | Existing GitHub repo is `reggieofarrell/flintfire`; history/issues/tags/branches preserved. |
| 2 | `v2.x`, v2 tags, and all old npm 2.x versions remain available and unchanged. |
| 3 | Prep PR records ADR-0039 and completes the exhaustive identity/docs/tooling sweep. |
| 4 | Active docs/READMEs/source examples use `flintfire`; v2 archive keeps old package imports. |
| 5 | New Pages base is `/flintfire/`; current, migration, and v2 routes pass browser/curl smoke. |
| 6 | All eight supplied SVGs and legacy-favicon deletion are committed; built pages contain valid paired favicon links and paired hero markup with no unsuffixed reference; browser/picker checks select the matching variant in light/dark desktop/mobile views. |
| 7 | Changelog generator produces a clean, complete v2.2.1→v3.0.0 entry before RC tags. |
| 8 | Publish workflow maps prerelease→`next`, stable→`latest`, validates identity, and is tested. |
| 9 | RC1 created `flintfire` manually under `next` and passed registry consumer smoke. |
| 10 | RC2 published through OIDC under `next`, with correct provenance and no `latest`. |
| 11 | Stable tag/release points to exact merged `main` SHA with manifest `flintfire@3.0.0`. |
| 12 | Stable npm publish used OIDC, has provenance, and owns `latest=3.0.0`. |
| 13 | Registry-installed stable root/vector/express entry points load in ESM and CJS. |
| 14 | Admin 12/13/14 and Firestore 7.9/7.10 compatibility legs pass. |
| 15 | `next` dist-tag removed after stable verification; RC versions remain available. |
| 16 | Every old 2.x version has exactly the canonical deprecation message. |
| 17 | No old-name v3 was published and no npm version was unpublished. |
| 18 | Full fourteen-leg gate and `release:verify` passed with actual recorded output. |
| 19 | GitHub/npm/workflow/Pages URLs, SHAs, integrity, provenance, and deprecation evidence are in `notes.md`. |
| 20 | ADR-0039 is updated to released status and durable release docs are correct. |
| 21 | Independent refute-first review closed every §4 trap; main is clean; no unpushed release tag. |
| 22 | Plan directory removed only after completed-release review, in a separate cleanup PR. |

---

## §12 Pre-handoff verification record

This table records what the planner actually ran. Remote mutations and post-change gates are
intentionally left to the executor and are bounded in §5.

| Check | Command / method | Result |
| --- | --- | --- |
| Baseline/status | `git status --short --branch`; `git log -1 --oneline`; `git rev-parse` | Baseline `main...origin/main` at `dc625b6`; current permitted changes are this plan plus deletion of the legacy favicon and eight paired SVG additions listed in phase 0.1 |
| Package identity | inspected `package.json` / lock | Old name 2.2.1 and old URLs confirmed |
| v2 preservation refs | `git rev-parse`; ancestor probe | All refs at `1226e9e...`; ancestor true |
| v3 distance/tags | `git rev-list --count`; `git tag --list` | 106 commits; no v3 tag |
| npm old package | `npm view` | 2.0.0–2.2.1; latest 2.2.1; no deprecation; authenticated user is its sole listed maintainer |
| npm new package | `npm view flintfire` | E404 on 2026-08-23 |
| npm identity / 2FA | `npm whoami`; `npm profile get tfa --json` | `reggieofarrell`; `auth-and-writes`; no profile secrets copied into the plan |
| GitHub CLI auth | `gh auth status`; `gh api user`; `git remote -v` | Active `reggieofarrell` keyring session; HTTPS CLI git protocol; `gist`, `read:org`, `repo`, and `workflow` scopes; clone origin remains SSH |
| GitHub public repo / authority | repository REST/GraphQL and `gh repo view` | Existing public old-name repo; `main` default; viewer permission `ADMIN`; viewer can administer |
| GitHub target name | `gh repo view reggieofarrell/flintfire` | Repository not found; target available on 2026-08-23 |
| Branches / protection | branches, protection, and rulesets APIs | Five branches preserved and all `protected=false`; classic `main` protection 404; default-branch ruleset exists but is disabled |
| Existing Releases | Releases API / `gh release list` | Stable `v2.0.0`, `v2.2.0`, and latest `v2.2.1`; no v3; each reports `immutable=false` |
| Release immutability | immutable-releases API | Disabled and not enforced by owner |
| Pages / Environments | Pages and Environments APIs | Workflow-built Pages at old `/firestore-orm/` URL, no CNAME; only `github-pages`; no `npm` Environment |
| Actions / workflows | Actions permissions and workflows APIs | Actions enabled for all actions; default token read-only; publish/docs/tests workflows active |
| Repository metadata | repository REST/GraphQL | Description, homepage, and topics empty; merge and squash enabled; rebase disabled; merged branches auto-delete |
| Publish/docs workflow source | source inspection plus workflow API | Current stable-only behavior and bare publish verified; workflows recognized as active |
| Identity surface | hidden `rg` sweep with v2 archive separated | Active/generated/historical sites enumerated |
| Docs archive | archive-specific `rg` | Old package imports and old base links both present; relocation distinction required |
| Changelog dry run | `npm run release:bump:dry -- --release-as 3.0.0` | Version/range correct; malformed notes reproduced (P14) |
| CLI command syntax | `gh repo rename --help`; `gh release create --help`; `gh workflow run --help`; `npm trust github --help`; `npm trust list --help`; npm command help | Flags in §7 confirmed by installed CLIs; npm 11.16.0 requires `--file`, `--repository`, `--environment`, `--allow-publish`; `npm trust github` has no `--workflow` |
| Consumer vs export-map specifiers | inspected `package.json` `"exports"` against §6.1 / phase 1.4 / RC smoke imports | Canonical consumer specifiers are `flintfire`, `flintfire/vector`, `flintfire/express`; export keys remain `.`, `./vector`, `./express` |
| Brand SVG structure / safety | `xmllint --noout`; `file`; script/foreign-object/URL/dependency grep | All eight are valid, self-contained SVGs; no executable or external embedded content found |
| Brand rendered inspection | `rsvg-convert`, paired contact sheet, and visual inspection | All four light variants are legible on a light surface and all four dark variants are legible on navy; pair roles/naming confirmed |
| Current docs build with assets | `npm run docs:build`; emitted-file and built-HTML inspection | Build passed and copied all eight SVGs, but emitted `/firestore-orm/favicon.svg`; the missing legacy file proves the silent-404 trap in P28 |
| Environment protection design | official GitHub Environments and branch-policies REST docs; local `jq`/shell syntax checks | Required reviewer with self-review allowed plus `type=tag`, `name=v*` custom policy is supported; no Environment was created during planning |
| Plan command syntax | extracted every fenced `bash` block and piped the combined script to `bash -n` | Passed after the authenticated-verification and asset updates |
| Plan formatting / whitespace | Prettier write/check, trailing-whitespace probe, `git diff --check` for tracked changes | Passed; plan is formatted and no tracked whitespace error remains |
| Documentation links | `npm run check:docs` | Passed; 187 documentation files scanned |
| Public TypeScript blocks | none added by this operational plan | No compile check applicable |
| Full gate | not run for plan-only Markdown creation | Executor owes §10; explicitly bounded in §5 |
| State-changing commands | reviewed against CLI help/docs, not executed | Required: no release state was mutated while planning |
| Remaining external bounds | re-read §§2–9 | Only post-RC Trusted Publisher settings, mutable name/permission checks, publish/deploy outcomes, and post-release evidence remain; each has a hard checkpoint |
| Trap inverse walk | §4 against §7–§8 | Every trap has a prevention step and observable verification |

### Authoritative references

- [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers/)
- [npm deprecating package versions](https://docs.npmjs.com/deprecating-and-undeprecating-packages-or-package-versions/)
- [GitHub repository rename behavior](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository)
- [GitHub deployment environments](https://docs.github.com/en/rest/deployments/environments)
- [GitHub deployment branch and tag policies](https://docs.github.com/en/rest/deployments/branch-policies)
- `docs/development/releasing.md`
- `website/VERSIONING.md`
- `.github/workflows/publish.yml`
- `.github/workflows/deploy-docs.yml`
