# Agent config (rulesync)

Agent **rules, commands, and skills** are authored once under `.rulesync/` and generated to every
tool with [rulesync](https://github.com/dyoshikawa/rulesync). Edit `.rulesync/`, never the generated
files. `npm run rules:sync` writes them; `npm run rules:check` (`rulesync generate --check`) fails
on drift and runs in the pre-push hook, PR CI, and `release:verify`.

The CLI version is a **devDependency** pinned in `package-lock.json`. CI installs with `npm ci`, so
a caret range in `package.json` does **not** float to new releases. Root and `website/.npmrc` set
`min-release-age=2` (npm 11.10+): new resolves skip versions published in the last two days. Do not
install an exact too-new version to bypass that — see the root `.npmrc` comments.

## Generation contract

`rulesync.jsonc` `targets` are `["cursor", "claudecode", "agentsmd", "codexcli"]`. **Order is
load-bearing:** `agentsmd` and `codexcli` both write `AGENTS.md`, and the last one wins. With
`codexcli` last, scoped rule bodies are **inlined** into `AGENTS.md` (what Cursor and Codex actually
load). Putting `agentsmd` last emits a pointer table instead. Nothing in `rules:check` warns you.

Other invariants the upgrade review encodes:

- Root overview is generated to `AGENTS.md` and `CLAUDE.md`. `cursor` is omitted on that rule so
  Cursor does not double-load it (it already reads `AGENTS.md`).
- `CLAUDE.md` is a real file containing the root overview only. Claude Code also reads
  `.claude/rules/`; inlining scoped rules there would double-load.
- Commands: Cursor + Claude only. Skills (including extra files next to `SKILL.md`): Cursor, Claude,
  and `.agents/skills/`.

## Keeping the CLI current

rulesync ships often (multiple minors per week is normal). A scheduled workflow
(`.github/workflows/rulesync-upgrade.yml`) runs daily at 14:00 UTC:

1. **Bump (deterministic).** Installs `rulesync@*` so `.npmrc` `min-release-age=2` can pick the
   newest version that is at least two days old (an exact `@latest` errors if that dist-tag is too
   new). If that version is already in the lockfile, the job no-ops. Otherwise it regenerates with
   `rules:sync` + `rules:check` and opens `chore/deps-rulesync-<version>`. If generated files are
   byte-identical to `main`, it comments `Verdict: merge` and skips the agent. The CLI therefore
   lags npm `latest` by up to two days — same supply-chain window as every other dependency.
2. **Review (Cursor Agent CLI, Grok 4.5).** If generated files changed,
   `agent --mode ask --model grok-4.5` follows `.rulesync/skills/rulesync-upgrade-review` and prints
   a filled `review-template.md`. The workflow posts that as a PR comment. `merge` passes the check;
   `hold` and `block` fail it on purpose. The Fast Grok variant is not used.

The agent cannot push, merge, or comment. CLI permissions for that job live in
`.github/cursor/rulesync-upgrade.cli.json` and are copied onto the runner only (not into project
`.cursor/cli.json`, which would constrain local `agent` sessions).

Do not auto-merge these PRs. Do not switch `rules:sync` to `npx rulesync@latest` — local and CI
would generate different trees.

### Repository secret

The review job needs `CURSOR_API_KEY` (Cursor dashboard → Integrations, or a team service-account
key). The bump job does not. If generated files change and the secret is missing, the PR still opens
and the review check fails closed.

```bash
gh secret set CURSOR_API_KEY --repo reggieofarrell/flintfire
```

### Manual runs

- **Actions → Rulesync upgrade → Run workflow** — same as the schedule.
- **Run workflow** with `review_pr` set to an existing PR number — skip the bump and re-run only the
  Grok 4.5 review (after tweaking the skill, or if the agent step flaked).

Local equivalent, on a checkout of the upgrade branch:

```bash
git fetch origin main
# Then invoke the review-rulesync-upgrade command / rulesync-upgrade-review skill.
```
