#!/usr/bin/env node
/* eslint-env node */
/**
 * Hook-script executable-bit checker for flintfire.
 *
 * Every generated agent-hook config invokes `scripts/agent-hooks/scan-edited-file.mjs` by BARE
 * PATH (no `node`/`bash`/etc. in front of it) — that only works because the file's git-tracked
 * executable bit is set; its `#!/usr/bin/env node` shebang alone is not enough. The bit is easy to
 * lose silently (a fresh `Write` of the file, `core.fileMode=false`, some CI checkout actions), and
 * a normal `git diff` never surfaces it — a mode-only change renders as an empty diff. This fails
 * (exit 1) when any bare-path hook command's target is not executable on disk.
 *
 * Do NOT "fix" a failure here by prefixing the command with `node` instead of restoring the bit —
 * rulesync auto-rewrites a *bare* relative command to `"$CLAUDE_PROJECT_DIR"/...` for the
 * `claudecode` target specifically, and only when the command has no interpreter in front of it;
 * an interpreter prefix silently suppresses that rewrite and breaks the hook when its cwd isn't the
 * project root (`MODULE_NOT_FOUND`). See `.rulesync/hooks.jsonc` for the full contract.
 *
 * Reads the GENERATED hook configs, not `.rulesync/hooks.jsonc` — `rules:check` already guarantees
 * they match the source, and the generated files are what a shell actually invokes.
 *
 * Usage: node scripts/check-hook-permissions.mjs
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// Generated from `.rulesync/hooks.jsonc` — kept in sync by `rules:check`. Add a path here if a new
// coding-agent target starts generating its own hook config.
export const HOOK_CONFIG_FILES = [
  '.claude/settings.json',
  '.cursor/hooks.json',
  '.codex/hooks.json',
];

const INTERPRETERS = new Set(['node', 'bash', 'sh', 'zsh', 'python', 'python3', 'npx', 'npm']);
const SCRIPT_EXTENSION = /\.(mjs|cjs|js|sh|py)$/;

/**
 * Recursively collects every string value assigned to a `command` key, regardless of the
 * surrounding shape — each coding agent nests its hook config differently.
 */
export function collectCommands(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectCommands(item, out);
  } else if (value && typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      if (key === 'command' && typeof val === 'string') {
        out.push(val);
      } else {
        collectCommands(val, out);
      }
    }
  }
  return out;
}

/**
 * Returns the repo-relative script path a hook `command` invokes BY BARE PATH, or `null` when the
 * command is interpreter-prefixed (its target's executable bit does not matter) or is not a
 * recognizable script-path invocation at all.
 */
export function resolveBarePathTarget(command) {
  if (typeof command !== 'string') return null;

  // rulesync prefixes the claudecode target with the project-root variable; normalize it back to
  // the same bare relative-path shape the other targets use before inspecting it.
  const normalized = command.replace(/^"?\$CLAUDE_PROJECT_DIR"?\//, '').trim();
  const [firstToken] = normalized.split(/\s+/);
  if (!firstToken) return null;

  const unquoted = firstToken.replace(/^["']|["']$/g, '');
  const interpreter = unquoted.split('/').pop();
  if (INTERPRETERS.has(interpreter)) return null;
  if (!SCRIPT_EXTENSION.test(unquoted)) return null;

  return unquoted.replace(/^\.\//, '');
}

function loadHookConfig(root, relPath) {
  const absPath = join(root, relPath);
  if (!existsSync(absPath)) return null;
  return JSON.parse(readFileSync(absPath, 'utf8'));
}

/**
 * @param {string[]} configFiles repo-relative paths to generated hook config files
 * @param {string} root repo root the paths are resolved against (override in tests only)
 * @returns {string[]} violation messages; empty when every bare-path hook target is executable.
 */
export function findHookPermissionViolations(configFiles = HOOK_CONFIG_FILES, root = repoRoot) {
  const violations = [];

  for (const relConfigPath of configFiles) {
    const config = loadHookConfig(root, relConfigPath);
    if (config === null) continue;

    for (const command of collectCommands(config)) {
      const target = resolveBarePathTarget(command);
      if (!target) continue;

      const absTarget = join(root, target);
      if (!existsSync(absTarget)) {
        violations.push(`${relConfigPath}: "${target}" is invoked by bare path but does not exist`);
        continue;
      }

      const isExecutable = (statSync(absTarget).mode & 0o111) !== 0;
      if (!isExecutable) {
        violations.push(
          `${relConfigPath}: "${target}" is invoked directly by path (no interpreter) but is not ` +
            `executable. Run: chmod +x ${target}`,
        );
      }
    }
  }

  return violations;
}

function main() {
  const violations = findHookPermissionViolations();

  if (violations.length > 0) {
    console.error(`\n✗ Hook permission check failed:\n`);
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    console.error(
      '\nA shebang is not enough for a bare-path hook command — the target also needs its ' +
        'executable bit set. Do not work around this by adding a `node` prefix in ' +
        '`.rulesync/hooks.jsonc`; see that file for why.\n',
    );
    process.exit(1);
  }

  console.log(`✓ Hook permission check passed (${HOOK_CONFIG_FILES.length} configs scanned)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
