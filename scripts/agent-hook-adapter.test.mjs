/**
 * Exercise the executable consumer adapter through real child processes and the installed CLI.
 * Literal formatting expectations come from this repository's Prettier configuration. Running
 * outside the checkout proves the adapter owns its root, while untouched files distinguish edit
 * paths from read-only payloads and strings contained in an edit's old/new content.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const adapter = resolve(import.meta.dirname, 'agent-hooks/scan-edited-file.mjs');

/**
 * Forward one native host payload to the actual adapter from an unrelated working directory.
 *
 * @param {object|string} input Native edit/read event, or deliberately malformed JSON.
 * @param {string} [entry] Adapter entry point, overridable for the missing-installation fixture.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} Complete process evidence.
 */
function runHook(input, entry = adapter) {
  return spawnSync(process.execPath, [entry], {
    cwd: tmpdir(),
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
  });
}

test('forwards malformed JSON as explicit advisory unavailability', () => {
  const result = runHook('{broken');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'Post-edit feedback: unavailable (advisory).\n');
});

test('does not treat a read-only event as an edit', () => {
  const result = runHook({ tool_name: 'Read', tool_input: { file_path: 'package.json' } });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'Post-edit feedback: no-files (advisory).\n');
});

test('formats the explicit edit from another directory without selecting content paths', () => {
  const directory = mkdtempSync(resolve(import.meta.dirname, '.agent-hook-fixture-'));
  const edited = join(directory, 'edited.mjs');
  const unrelated = join(directory, 'unrelated.mjs');
  const unformatted = "export const value={message:'example'};\n";
  try {
    writeFileSync(edited, unformatted);
    writeFileSync(unrelated, unformatted);
    const result = runHook({
      tool_name: 'Write',
      tool_input: { file_path: edited, content: unrelated },
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'Post-edit feedback: completed (advisory).\n');
    assert.equal(readFileSync(edited, 'utf8'), "export const value = { message: 'example' };\n");
    assert.equal(readFileSync(unrelated, 'utf8'), unformatted);
  } finally {
    // Each test removes the temporary files it owns, including after an assertion fails.
    rmSync(directory, { recursive: true, force: true });
  }
});

test('reports an absent local installation without blocking the host', () => {
  const directory = mkdtempSync(join(tmpdir(), 'flintfire-hook-uninstalled-'));
  const entry = join(directory, 'scripts/agent-hooks/scan-edited-file.mjs');
  try {
    // Copying only the adapter outside the checkout gives package resolution a genuine missing
    // installation, rather than mocking the runtime boundary this test is intended to exercise.
    mkdirSync(join(directory, 'scripts/agent-hooks'), { recursive: true });
    writeFileSync(entry, readFileSync(adapter));
    const result = runHook({ files: ['package.json'] }, entry);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(
      result.stderr,
      'Post-edit feedback unavailable; restore the locked local tooling installation.\n',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
