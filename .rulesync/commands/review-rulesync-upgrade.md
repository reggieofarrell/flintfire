---
targets:
  - '*'
---

# Review rulesync Upgrade

Review a rulesync CLI bump by comparing newly generated agent-config files against
`main` and against the `.rulesync/` source, and emit a `merge` / `hold` / `block`
verdict.

**Follow the `rulesync-upgrade-review` skill** — it owns the load-bearing layout
invariants (AGENTS.md inlining, CLAUDE.md not double-loading, target order), the
hunk classification, and the stdout template. This command is the entry point; the
skill is the standard.

## Use this command when

A `chore/deps-rulesync-*` PR is open, the `rulesync-upgrade` GitHub Action ran, or
someone installed a newer `rulesync` and regenerated. Not for authoring or editing
rules — edit `.rulesync/` and run `npm run rules:sync`. Not for reviewing library
implementations (`write-review`).

## Steps

1. **Identify versions.** Lockfile on `origin/main` vs `node_modules/rulesync` (or
   `FROM_VERSION` / `TO_VERSION` if CI supplied them).
2. **Confirm `.rulesync/` is untouched** relative to `origin/main`. Any source
   edit on a bump PR is a `block`.
3. **Diff generated paths against `origin/main`** (skill lists the exact paths).
   Empty diff → `merge` immediately.
4. **Read the rulesync release notes**, then verify every claim against the diff.
5. **Run the invariant table** in the skill. Cite `file:line` or hunks.
6. **Classify hunks** as cosmetic / expected-churn / behavioral-risk.
7. **Emit the review template on stdout.** Verdict line lowercase and parseable.
   Do not edit the tree; do not post the GitHub comment yourself (CI does that).
