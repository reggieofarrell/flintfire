#!/usr/bin/env node
/**
 * Keep RuleSync's executable, project-root-aware entry point while delegating behavior to the
 * released shared CLI. The CLI owns payload selection, formatting order, confinement and advisory
 * diagnostics; this adapter forwards stdin unchanged and works from another directory.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The script location, rather than an agent's current directory, defines repository ownership. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

try {
  // The package's public entry and sibling CLI belong to this consumer's installed release.
  // Invoking Node directly avoids shell shims and downloads during an edit.
  const cli = resolve(
    dirname(fileURLToPath(import.meta.resolve('@casadega-development/ts-repo-tooling'))),
    'cli.js',
  );
  const result = spawnSync(process.execPath, [cli, 'hook', 'agent-edit', '--cwd', root], {
    cwd: root,
    stdio: 'inherit',
    timeout: 45_000,
  });
  if (result.error || result.status !== 0)
    console.error('Post-edit feedback unavailable; restore the locked local tooling installation.');
} catch {
  console.error('Post-edit feedback unavailable; restore the locked local tooling installation.');
}

// Full Git and CI checks enforce quality; this immediate feedback remains advisory.
process.exitCode = 0;
