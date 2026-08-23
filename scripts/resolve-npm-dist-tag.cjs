#!/usr/bin/env node
'use strict';

/**
 * Map a GitHub Release identity onto a safe npm dist-tag.
 *
 * Why this is a script, not inline shell: `github.event.release.tag_name` is
 * untrusted text. A Node validator can reject anything that is not a strict
 * `v` + semver match against `package.json.version` and can only emit the
 * literals `next` or `latest`, so the workflow never interpolates attacker-
 * controlled text into `npm publish --tag`.
 *
 * CommonJS so Jest's unit suite (ts-jest CJS output) can load it without an
 * ESM loader, and so `node scripts/resolve-npm-dist-tag.cjs` works in
 * publish.yml the same way.
 *
 * Contract (PLAN §6.3):
 * - GitHub prerelease + semver prerelease manifest → `next`
 * - GitHub stable + stable manifest → `latest`
 * - Mixed prerelease/stable identity, tag ≠ `v${version}`, or malformed input → reject
 */
const { appendFileSync, readFileSync } = require('node:fs');
const { dirname, resolve } = require('node:path');

/**
 * Strict `v` + semver 2.0.0. Build metadata is allowed but ignored for the
 * prerelease check. Rejects spaces, shell metacharacters, and leading zeros.
 */
const STRICT_V_SEMVER =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

/**
 * Characters that must never appear in a tag we later interpolate, even if the
 * semver regex already rejects most of them. Defense in depth against a regex
 * miss.
 */
const UNSAFE_TAG_CHARS = /[\s;|&$`\\'"<>(){}[\]]/;

/**
 * Parse GitHub Actions' stringification of a boolean (`"true"` / `"false"`).
 * Anything else (empty, `TRUE`, `1`, injected newlines) is rejected so a
 * confused event payload cannot silently take the stable path.
 *
 * @param {unknown} raw
 * @returns {boolean}
 */
function parseGitHubBoolean(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(
    `IS_PRERELEASE must be the GitHub boolean string "true" or "false", got ${JSON.stringify(raw)}`,
  );
}

/**
 * Decide the npm dist-tag for a GitHub Release, or throw.
 *
 * @param {{ tagName: unknown, isPrereleaseRaw: unknown, packageVersion: unknown }} input
 * @returns {'next' | 'latest'}
 */
function resolveNpmDistTag({ tagName, isPrereleaseRaw, packageVersion }) {
  if (typeof tagName !== 'string' || tagName.length === 0 || tagName.length > 128) {
    throw new Error('Release tag is missing or unreasonably long');
  }
  if (UNSAFE_TAG_CHARS.test(tagName)) {
    throw new Error(`Release tag contains unsafe characters: ${JSON.stringify(tagName)}`);
  }

  const match = STRICT_V_SEMVER.exec(tagName);
  if (!match) {
    throw new Error(
      `Release tag ${JSON.stringify(tagName)} is not a strict vMAJOR.MINOR.PATCH semver tag`,
    );
  }

  if (typeof packageVersion !== 'string' || packageVersion.length === 0) {
    throw new Error('package.json version is missing');
  }

  const versionFromTag = tagName.slice(1);
  if (versionFromTag !== packageVersion) {
    throw new Error(
      `Release tag ${JSON.stringify(tagName)} does not match package.json version "v${packageVersion}"`,
    );
  }

  const isPrerelease = parseGitHubBoolean(isPrereleaseRaw);
  // Group 4 is the semver prerelease identifier (`rc.1` in `3.0.0-rc.1`).
  const hasPrereleaseId = typeof match[4] === 'string' && match[4].length > 0;

  if (isPrerelease && !hasPrereleaseId) {
    throw new Error(
      `GitHub marked ${tagName} as a prerelease but package.json version ${packageVersion} is stable`,
    );
  }
  if (!isPrerelease && hasPrereleaseId) {
    throw new Error(
      `GitHub marked ${tagName} as stable but package.json version ${packageVersion} is a prerelease`,
    );
  }

  return isPrerelease ? 'next' : 'latest';
}

/**
 * CLI entry used by `.github/workflows/publish.yml`.
 *
 * @param {{ env?: NodeJS.ProcessEnv, stdout?: NodeJS.WriteStream, packageJsonPath?: string }} [opts]
 * @returns {'next' | 'latest'}
 */
function runCli({
  env = process.env,
  stdout = process.stdout,
  packageJsonPath = resolve(__dirname, '..', 'package.json'),
} = {}) {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const distTag = resolveNpmDistTag({
    tagName: env.RELEASE_TAG,
    isPrereleaseRaw: env.IS_PRERELEASE,
    packageVersion: pkg.version,
  });

  stdout.write(`dist-tag=${distTag}\n`);
  if (typeof env.GITHUB_OUTPUT === 'string' && env.GITHUB_OUTPUT.length > 0) {
    appendFileSync(env.GITHUB_OUTPUT, `dist-tag=${distTag}\n`);
  }
  return distTag;
}

module.exports = { parseGitHubBoolean, resolveNpmDistTag, runCli };

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`::error::${message}\n`);
    process.exit(1);
  }
}
