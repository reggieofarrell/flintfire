/**
 * Resolve repository tooling without trusting the caller's PATH search order.
 *
 * Child-process calls that use a bare executable name can be redirected by a
 * writable directory placed earlier on PATH. This module instead searches a
 * short, explicit list: workspace binaries, the active Node installation,
 * standard package-manager locations, and SonarQube CLI's documented per-user
 * installation directory. Callers fail clearly when a required tool is absent.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../..');

/**
 * Return deterministic candidate paths without reading PATH.
 *
 * @param {string} name Bare executable name (letters, digits, underscore, hyphen).
 * @returns {string[]} Absolute candidate paths in search order.
 */
export function getExecutableCandidates(name) {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid executable name: ${name}`);
  }

  const suffixes = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  const directories = [
    resolve(repositoryRoot, 'node_modules/.bin'),
    dirname(process.execPath),
    resolve(homedir(), '.local/share/sonarqube-cli/bin'),
    resolve(homedir(), '.local/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ];

  return directories.flatMap(directory =>
    suffixes.map(suffix => resolve(directory, `${name}${suffix}`)),
  );
}

/**
 * Resolve an optional tool from the explicit candidate list.
 *
 * @param {string} name Bare executable name.
 * @returns {string | undefined} First existing candidate, or undefined.
 */
export function findExecutable(name) {
  return getExecutableCandidates(name).find(candidate => existsSync(candidate));
}

/**
 * Resolve a required tool from the explicit candidate list.
 *
 * @param {string} name Bare executable name.
 * @returns {string} Absolute path to the executable.
 * @throws {Error} When no trusted location contains the tool.
 */
export function resolveExecutable(name) {
  const executable = findExecutable(name);
  if (!executable) {
    throw new Error(`${name} was not found in the repository's trusted executable locations.`);
  }
  return executable;
}
