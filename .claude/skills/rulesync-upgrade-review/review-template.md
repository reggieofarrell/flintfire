# rulesync upgrade review

<!--
  Filled in by the Cursor Agent CLI (Grok 4.5) on a rulesync bump PR.
  The GitHub Action posts this markdown as a PR comment. Do not omit the
  Verdict line — CI parses it.
-->

**From:** `<old-version>`
**To:** `<new-version>`
**Release notes:** https://github.com/dyoshikawa/rulesync/releases/tag/v`<new-version>`
**Generated files vs `main`:** `unchanged` | `changed`
**Verdict:** `merge` | `hold` | `block`

## File inventory

- Added:
- Removed:
- Renamed / moved:
- Unexpected paths (not under `.cursor/`, `.claude/`, `.agents/`, `AGENTS.md`, `CLAUDE.md`):

## Invariants

| Check | Result (`pass` / `fail` / `n/a`) | Evidence (`file:line` or diff hunk) |
| --- | --- | --- |
| `.rulesync/` source is untouched | | |
| `AGENTS.md` still **inlines** every scoped rule body (not a TOON / pointer table) | | |
| `CLAUDE.md` is the root overview only, a real file, not a symlink | | |
| No root overview emitted under `.cursor/rules/` | | |
| Commands exist for Cursor + Claude only (none under `.agents/`) | | |
| Skills (including extra files next to `SKILL.md`) exist on Cursor, Claude, and `.agents/skills/` | | |
| `rulesync-generated` globs still cover the generated paths | | |
| `rulesync.jsonc` `targets` order is still `cursor`, `claudecode`, `agentsmd`, `codexcli` | | |

## Hunk classification

One bullet per generated-file hunk (or grouped identical churn). Each bullet is exactly one of:

- **cosmetic** — whitespace, heading punctuation, generated banners
- **expected-churn** — generator formatting that preserves meaning and the invariants above
- **behavioral-risk** — load set, inline-vs-pointer, target set, new/dropped files, frontmatter/glob changes

## Notes

What a human must decide, if anything. Empty when Verdict is `merge`.
