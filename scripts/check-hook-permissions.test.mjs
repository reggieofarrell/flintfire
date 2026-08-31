import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  collectCommands,
  findHookPermissionViolations,
  resolveBarePathTarget,
} from './check-hook-permissions.mjs';

test('resolves the rulesync $CLAUDE_PROJECT_DIR-prefixed claudecode command to a bare path', () => {
  assert.equal(
    resolveBarePathTarget('"$CLAUDE_PROJECT_DIR"/scripts/agent-hooks/scan-edited-file.mjs'),
    'scripts/agent-hooks/scan-edited-file.mjs',
  );
});

test('resolves a plain relative bare-path command', () => {
  assert.equal(
    resolveBarePathTarget('./scripts/agent-hooks/scan-edited-file.mjs'),
    'scripts/agent-hooks/scan-edited-file.mjs',
  );
});

test('returns null for an interpreter-prefixed command — the bit does not matter there', () => {
  assert.equal(resolveBarePathTarget('node scripts/check-doc-links.mjs'), null);
  assert.equal(resolveBarePathTarget('bash scripts/check-node-version.sh'), null);
});

test('returns null for a command with no recognizable script path', () => {
  assert.equal(resolveBarePathTarget('npm run check:docs'), null);
  assert.equal(resolveBarePathTarget(''), null);
  assert.equal(resolveBarePathTarget(undefined), null);
});

test('collectCommands finds every "command" string regardless of nesting shape', () => {
  const claudeShape = {
    hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'a.mjs' }] }] },
  };
  const cursorShape = { hooks: { afterFileEdit: [{ command: 'b.mjs' }] } };
  const codexShape = { hooks: { PostToolUse: [{ hooks: [{ command: 'c.mjs' }] }] } };

  assert.deepEqual(collectCommands(claudeShape), ['a.mjs']);
  assert.deepEqual(collectCommands(cursorShape), ['b.mjs']);
  assert.deepEqual(collectCommands(codexShape), ['c.mjs']);
});

test("findHookPermissionViolations passes against this repo's real generated hook configs", () => {
  // Regression guard for the bug this check exists to catch: scripts/agent-hooks/scan-edited-file.mjs
  // was committed without its executable bit set and stayed that way, undetected, since PR #121.
  assert.deepEqual(findHookPermissionViolations(), []);
});

test('findHookPermissionViolations skips a config file that does not exist', () => {
  assert.deepEqual(findHookPermissionViolations(['does-not-exist.json']), []);
});

/**
 * Builds a disposable fixture repo so the violation branches below can be exercised without
 * touching this repo's own files or leaving a permanently-broken fixture script committed.
 */
function makeFixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'check-hook-permissions-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  return root;
}

test('findHookPermissionViolations reports a bare-path target that is not executable', () => {
  const root = makeFixtureRoot();
  try {
    const scriptPath = join(root, 'scripts', 'hook.mjs');
    writeFileSync(scriptPath, '#!/usr/bin/env node\n', { mode: 0o644 });
    writeFileSync(
      join(root, 'config.json'),
      JSON.stringify({ hooks: { afterFileEdit: [{ command: './scripts/hook.mjs' }] } }),
    );

    const violations = findHookPermissionViolations(['config.json'], root);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /scripts\/hook\.mjs.*not executable/);
    assert.match(violations[0], /chmod \+x scripts\/hook\.mjs/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findHookPermissionViolations reports a bare-path target that does not exist on disk', () => {
  const root = makeFixtureRoot();
  try {
    writeFileSync(
      join(root, 'config.json'),
      JSON.stringify({ hooks: { afterFileEdit: [{ command: './scripts/missing.mjs' }] } }),
    );

    const violations = findHookPermissionViolations(['config.json'], root);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /scripts\/missing\.mjs.*does not exist/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findHookPermissionViolations passes when the bare-path target is executable', () => {
  const root = makeFixtureRoot();
  try {
    const scriptPath = join(root, 'scripts', 'hook.mjs');
    writeFileSync(scriptPath, '#!/usr/bin/env node\n', { mode: 0o755 });
    writeFileSync(
      join(root, 'config.json'),
      JSON.stringify({ hooks: { afterFileEdit: [{ command: './scripts/hook.mjs' }] } }),
    );

    assert.deepEqual(findHookPermissionViolations(['config.json'], root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findHookPermissionViolations ignores an interpreter-prefixed command even when the target is not executable', () => {
  const root = makeFixtureRoot();
  try {
    const scriptPath = join(root, 'scripts', 'hook.mjs');
    writeFileSync(scriptPath, '#!/usr/bin/env node\n', { mode: 0o644 });
    writeFileSync(
      join(root, 'config.json'),
      JSON.stringify({ hooks: { afterFileEdit: [{ command: 'node ./scripts/hook.mjs' }] } }),
    );

    assert.deepEqual(findHookPermissionViolations(['config.json'], root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
