# ADR-0039: Rename the package and GitHub repository to FlintFire

- **Status:** Accepted (released in 3.0.0)
- **Date:** 2026-08-23
- **Deciders:** Reggie O'Farrell
- **Related:** ADR-0001 (fork and 2.0.0 re-architecture), ADR-0006 (Starlight site and major-version
  archives), [`docs/plans/flintfire-v3-release/PLAN.md`](../plans/flintfire-v3-release/PLAN.md),
  `CHANGELOG.md` (generated 3.0.0 entry),
  [PR #94](https://github.com/reggieofarrell/flintfire/pull/94) (prep),
  [PR #95](https://github.com/reggieofarrell/flintfire/pull/95) (release),
  [GitHub Release v3.0.0](https://github.com/reggieofarrell/flintfire/releases/tag/v3.0.0),
  [npm flintfire@3.0.0](https://www.npmjs.com/package/flintfire/v/3.0.0)

## Context

The library has been published as `@reggieofarrell/firestore-orm` from
`github.com/reggieofarrell/firestore-orm`. That scoped name and repository slug encode an ORM/ODM
taxonomy the project no longer wants as its public identity, and they split discoverability across a
scoped npm name that is hard to type and a GitHub Pages URL that will not follow a repository
rename.

The v3 public contract is already a breaking change relative to 2.x. Folding the package rename into
that same major keeps consumers on one migration, preserves semver continuity from the published 2.x
line, and avoids inventing a second canonical npm identity.

Constraints that shaped the decision:

- npm package names are unique and immutable once published; a new unscoped name cannot reuse the
  old tarball history.
- Unpublishing 2.x would break lockfiles. Deprecation after the replacement is installable is the
  supported redirect.
- GitHub repository renames keep issues, stars, PRs, tags, and source URLs; GitHub Pages project
  URLs do not redirect.
- npm Trusted Publishing (OIDC) can only be configured on a package that already exists, so the
  first FlintFire version must be a manual bootstrap publish.
- The owner-supplied brand assets are four explicit `-light` / `-dark` pairs. Starlight's built-in
  `favicon` option accepts only one path, and Vite refuses to import files from `public/`.

## Decision

We will brand the project **FlintFire** and publish v3 only as unscoped `flintfire@3.0.0` from the
renamed repository `reggieofarrell/flintfire`.

Sub-decisions:

1. **Brand without ORM/ODM taxonomy.** The public pitch is a type-safe, schema-aware Firestore
   data-access library for Node.js and the Firebase Admin SDK. Class names such as
   `FirestoreRepository` stay; this release renames the package and site, not the API vocabulary.
   ORM-related npm keywords stay for search.
2. **Semver continues at 3.0.0.** Restarting at `0.1.0` would erase continuity with the already
   published 2.x fork and understate a mature breaking release.
3. **Rename the existing GitHub repository** rather than creating a new one, so history, issues,
   stars, PRs, and tags remain. After the rename, Pages live at
   `https://reggieofarrell.github.io/flintfire/`. The old `/firestore-orm/` Pages URL will 404; that
   is accepted for this release (a custom domain is follow-up work, not a release dependency).
4. **One canonical npm v3 identity.** Do not publish `@reggieofarrell/firestore-orm@3`. Dual
   publishing would split provenance and support.
5. **Retain and then deprecate 2.x.** Keep `@reggieofarrell/firestore-orm@2.x`, the `v2.x` branch,
   and all v2 tags. After stable FlintFire is verified, deprecate the old 2.x range with the
   canonical message pointing at `flintfire@^3` and the migration guide. Do not unpublish.
6. **Release sequence.** Manually publish `3.0.0-rc.1` with `--tag next` to create the npm package;
   configure Trusted Publishing against `reggieofarrell/flintfire` and workflow file `publish.yml`;
   prove OIDC with `3.0.0-rc.2`; publish stable `3.0.0` through OIDC onto `latest`. Prereleases
   never update production docs.
7. **Consumer import specifiers** are `flintfire`, `flintfire/vector`, and `flintfire/express`.
   Those correspond to `package.json` `"exports"` keys `.`, `./vector`, and `./express`. Never tell
   consumers to import `./vector` or `./express`.
8. **Brand assets.** Ship the eight owner-supplied SVGs as four light/dark pairs under
   `website/public/`. There is no unsuffixed favicon fallback file. Starlight's single `favicon`
   option points at `/favicon-light.svg`; a Head override appends media-qualified light/dark icon
   links. Splash icons follow the visitor's Starlight theme, not only `prefers-color-scheme`.

## Consequences

**Easier**

- The public name is short, unscoped, and not tied to ORM/ODM taxonomy.
- GitHub history stays in one repository; old clone URLs redirect.
- v3 consumers have one package name, one docs URL, and one migration guide.

**Harder**

- Every install and import must change (`@reggieofarrell/firestore-orm` → `flintfire`, plus
  `/vector` and `/express` subpaths).
- npm history splits across two package names; the old 2.x tarball README cannot be edited in place.
- GitHub Pages does not redirect `/firestore-orm/` → `/flintfire/`. There will be a short docs gap
  between repository rename and the first stable docs deploy. Frozen v2 archive pages keep
  historical package imports and only have their site-path prefix relocated.
- The first FlintFire version cannot use OIDC; RC1 is a manual `--tag next` publish with 2FA.

Future maintainers must not publish an old-name v3, must not unpublish 2.x, and must not regenerate
the 3.0.0 changelog after RC tags exist.

## Alternatives considered

- **Keep the scoped name.** Rejected: the brand decision (D1) is to leave ORM taxonomy out of the
  package identity; a scoped name is also harder to discover and type.
- **Create a new GitHub repository.** Rejected: it would split issues, stars, PRs, and tags without
  a consumer benefit. GitHub already redirects repository traffic after a rename.
- **Restart at 0.1.0.** Rejected: it erases useful continuity with published 2.x and understates a
  mature breaking release.
- **Dual-publish `@reggieofarrell/firestore-orm@3` and `flintfire@3`.** Rejected: two canonical
  identities make provenance, deprecation, and support ambiguous.
- **Publish a documentation-only 2.2.2** solely to replace the registry README. Rejected: it creates
  another installable release and an extra publishing path. The deprecation banner is the
  old-package redirect.
- **Rename public class names** (`FirestoreRepository` → something FlintFire-specific). Rejected:
  that adds unrelated API migration on top of an already large major.

## Release (2026-08-23)

Shipped as `flintfire@3.0.0` from `reggieofarrell/flintfire` at merge SHA
`1f070ea951bc3bdee218b6aa17c4e5e5fca168aa` (annotated tag `v3.0.0`). Prep landed in PR #94; the
release PR was #95. npm `latest` is `3.0.0` with Trusted Publishing provenance.
`@reggieofarrell/firestore-orm@2.x` is deprecated in place (all five 2.x versions); no old-name v3
was published. Execution evidence:
[`docs/plans/flintfire-v3-release/notes.md`](../plans/flintfire-v3-release/notes.md) until that
directory is removed in a later cleanup PR.

## References

- [`docs/plans/flintfire-v3-release/PLAN.md`](../plans/flintfire-v3-release/PLAN.md) —
  owner-approved decisions D1–D13 and the release playbook
- [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers/)
- [GitHub repository rename behavior](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository)
