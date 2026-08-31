#!/usr/bin/env node

/**
 * Runs the real SonarQube analyzers over files changed on the current branch.
 *
 * eslint-plugin-sonarjs supplies quick editor and lint feedback, but it cannot
 * reproduce every rule or language analyzer configured on the server. This
 * script closes that gap before a push by analyzing changed TypeScript,
 * JavaScript, and stylesheet files on a short-lived SonarQube branch.
 *
 * Usage:
 *   npm run sonar:precheck             # new issues compared with origin/main
 *   npm run sonar:precheck -- --all    # every issue in the changed files
 *   npm run sonar:precheck -- develop  # compare with another Git base
 *
 * Exit codes are part of the pre-push contract:
 *   0: the changed files are clean, or no analyzable files changed
 *   1: issues were found, authentication failed, or analysis failed
 *   2: analysis could not start because a prerequisite is unavailable
 *
 * The hook may continue on exit 2 so an offline developer does not learn to
 * bypass every hook with --no-verify. Once prerequisites are present, analysis
 * errors and findings are real failures and block the push.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { findExecutable, resolveExecutable } from './lib/resolve-executable.mjs';
import { resolveRepositorySonarHost } from './lib/sonar-host.mjs';
import { resolveLocalSonarToken } from './lib/sonar-token.mjs';

const gitExecutable = resolveExecutable('git');

/** Extensions supported by the JavaScript/TypeScript and CSS analyzers. */
const analyzableExtension = /\.(?:ts|tsx|js|jsx|mjs|cjs|css|scss|less)$/;

/**
 * Mirrors this repository's sonar.test.inclusions closely enough for a precheck.
 * Production `src/` and `scripts/` stay on the sources side; tests and type-tests
 * go on the tests side so complexity/coverage metrics stay honest.
 */
const testPath =
  /(?:^|\/)tests\/|(?:^|\/)__tests__\/|\.test\.[jt]sx?$|\.spec\.[jt]sx?$|\.type-test\.ts$|\.test\.mjs$/;

/** Paths the committed sonar.exclusions already keep out of analysis. */
const skippedPath = /(?:^|\/)(?:node_modules|dist|coverage|\.git|website|benchmarks)\//;

/** A path that deliberately cannot match when one scanner side is empty. */
const noMatch = '**/__sonar_precheck_no_match__';

/**
 * Stops with a blocking failure after prerequisites were satisfied.
 *
 * @param {string} message Human-readable failure shown on stderr.
 * @returns {never}
 */
function fail(message) {
  console.error(`[sonar-precheck] ${message}`);
  process.exit(1);
}

/**
 * Stops with the distinct non-blocking "could not run" status.
 *
 * @param {string} message Human-readable skip reason shown on stderr.
 * @returns {never}
 */
function unavailable(message) {
  console.error(`[sonar-precheck] SKIPPED — ${message}`);
  process.exit(2);
}

/**
 * Reads one simple key=value entry from sonar-project.properties.
 *
 * @param {string} key Property name such as `sonar.projectKey`.
 * @returns {string | undefined} Trimmed value, or undefined when missing.
 */
function fromProperties(key) {
  if (!existsSync('sonar-project.properties')) return undefined;

  const line = readFileSync('sonar-project.properties', 'utf8')
    .split('\n')
    .find(candidate => candidate.trim().startsWith(`${key}=`));

  return line?.split('=').slice(1).join('=').trim() || undefined;
}

/**
 * Reads the user token written to the macOS keychain by `sonar auth login`.
 *
 * Husky uses POSIX sh and GUI Git clients often do not inherit a shell's
 * SONAR_TOKEN. More importantly, this entry is keyed by the pinned host and is
 * therefore preferred over an ambiguous inherited token on macOS. Other
 * platforms use SONAR_TOKEN. A timeout prevents a locked keychain or
 * permissions prompt from hanging a push indefinitely.
 *
 * @param {string} hostUrl Configured SonarQube host.
 * @returns {string | undefined} Token string, or undefined when unavailable.
 */
function keychainUserToken(hostUrl) {
  if (process.platform !== 'darwin') return undefined;

  let account;
  try {
    account = new URL(hostUrl).host;
  } catch {
    return undefined;
  }

  const securityExecutable = findExecutable('security');
  if (!securityExecutable) return undefined;

  const result = spawnSync(
    securityExecutable,
    ['find-generic-password', '-s', 'sonarqube-cli', '-a', account, '-w'],
    { encoding: 'utf8', timeout: 5_000 },
  );

  if (result.status !== 0 || result.error) return undefined;
  return result.stdout.trim() || undefined;
}

let hostResolution;
try {
  hostResolution = resolveRepositorySonarHost(
    fromProperties('sonar.host.url'),
    process.env.SONAR_HOST_URL,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const { host, ignoredEnvironmentHost } = hostResolution;
if (ignoredEnvironmentHost) {
  console.log(
    `[sonar-precheck] ignoring SONAR_HOST_URL=${ignoredEnvironmentHost} — sonar-project.properties pins ${host}.`,
  );
}

const sonarScannerExecutable = findExecutable('sonar-scanner');
if (
  !sonarScannerExecutable ||
  spawnSync(sonarScannerExecutable, ['--version'], { stdio: 'ignore' }).status !== 0
) {
  unavailable('sonar-scanner is not on PATH. See docs/development/sonarqube.md.');
}

const tokenResolution = resolveLocalSonarToken(
  process.platform,
  process.env.SONAR_TOKEN,
  keychainUserToken(host),
);
const { token } = tokenResolution;
if (tokenResolution.ignoredEnvironmentToken) {
  console.log(
    `[sonar-precheck] ignoring SONAR_TOKEN because a host-scoped macOS keychain token exists for ${host}.`,
  );
}

if (!token) {
  if (process.platform === 'darwin') {
    unavailable(
      `no host-scoped macOS keychain token was found for ${host}. ` +
        'Check `sonar auth status`, then follow the secure multi-server keychain setup in docs/development/sonarqube.md. ' +
        'SONAR_TOKEN remains a fallback when no matching keychain entry exists.',
    );
  }

  unavailable(
    `SONAR_TOKEN is not set for ${host}. This platform has no supported local credential-store adapter; ` +
      'provide a SonarQube user token through the environment without placing it in shell history.',
  );
}

const tokenSource =
  tokenResolution.source === 'macos-keychain'
    ? 'the host-scoped macOS keychain token'
    : 'SONAR_TOKEN';
const rejectedTokenAdvice =
  tokenResolution.source === 'macos-keychain'
    ? 'Update that host-specific entry using the secure keychain command in docs/development/sonarqube.md.'
    : 'Ensure it is a user token for this server and not a globally exported token for another SonarQube host.';

const projectKey = fromProperties('sonar.projectKey');
if (!projectKey) fail('sonar.projectKey is missing from sonar-project.properties.');

const showAll = process.argv.includes('--all');
const base = process.argv.slice(2).find(argument => !argument.startsWith('--')) ?? 'origin/main';
const referenceBranch = base.replace(/^origin\//, '');

let changedFiles;
try {
  changedFiles = execFileSync(gitExecutable, ['diff', '--name-only', `${base}...HEAD`], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
} catch {
  unavailable(`could not diff against "${base}". Fetch it first or pass another base ref.`);
}

const files = changedFiles.filter(
  file => analyzableExtension.test(file) && existsSync(file) && !skippedPath.test(`/${file}/`),
);
if (files.length === 0) {
  console.log(`[sonar-precheck] no analyzable changes vs ${base} — nothing to scan.`);
  process.exit(0);
}

const sources = files.filter(file => !testPath.test(file));
const tests = files.filter(file => testPath.test(file));
const branch = `precheck-${process.pid}`;
const apiBase = host.replace(/\/$/, '');
const tokenCredential = `${token}:`;
const authHeader = `Basic ${Buffer.from(tokenCredential).toString('base64')}`;

/**
 * Calls the SonarQube Web API with an upper bound on every request.
 *
 * @param {string} path Absolute Web API path including the leading slash.
 * @param {string} [method='GET'] HTTP method.
 * @param {number} [timeoutMs=30_000] Abort after this many milliseconds.
 * @returns {Promise<Response>} Fetch response (not yet checked for HTTP errors).
 */
function api(path, method = 'GET', timeoutMs = 30_000) {
  return fetch(`${apiBase}${path}`, {
    method,
    headers: { Authorization: authHeader },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/**
 * Removes the temporary analysis branch without masking the real result.
 *
 * @returns {Promise<void>}
 */
async function deleteBranch() {
  try {
    const deletePath =
      `/api/project_branches/delete?project=${encodeURIComponent(projectKey)}` +
      `&branch=${encodeURIComponent(branch)}`;
    await api(deletePath, 'POST');
  } catch {
    // Cleanup is best-effort. An orphaned precheck branch is not a failed scan.
  }
}

try {
  const probe = await api('/api/authentication/validate', 'GET', 5_000);
  if (!probe.ok) {
    fail(
      `${apiBase} answered HTTP ${probe.status} while validating ${tokenSource}. ${rejectedTokenAdvice}`,
    );
  }

  if ((await probe.json()).valid === false) {
    fail(`${tokenSource} was rejected by ${apiBase}. ${rejectedTokenAdvice}`);
  }
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  unavailable(
    `${apiBase} is unreachable (${reason}). ` + 'CI still enforces the full quality gate.',
  );
}

console.log(`[sonar-precheck] scanning ${files.length} changed file(s) vs ${base} on ${branch}…`);
const startedAt = Date.now();
const scan = spawnSync(
  sonarScannerExecutable,
  [
    `-Dsonar.branch.name=${branch}`,
    `-Dsonar.newCode.referenceBranch=${referenceBranch}`,
    `-Dsonar.inclusions=${sources.join(',') || noMatch}`,
    `-Dsonar.test.inclusions=${tests.join(',') || noMatch}`,
    `-Dsonar.host.url=${host}`,
  ],
  {
    encoding: 'utf8',
    // Keep Scanner's environment aligned with the explicit `-D` property so
    // it cannot reinterpret a conflicting inherited host at a lower layer.
    env: { ...process.env, SONAR_HOST_URL: host, SONAR_TOKEN: token },
  },
);

// With quality-gate waiting enabled, scanner exit 3 still means analysis was
// processed successfully. A temporary branch may lack coverage, so query its
// issues and decide based on those rather than its overall quality gate.
const qualityGateFailed = 3;
if (scan.status !== 0 && scan.status !== qualityGateFailed) {
  await deleteBranch();
  console.error(scan.stdout?.split('\n').slice(-25).join('\n') ?? '');
  fail(`the scanner failed with exit ${scan.status}; see its final output above.`);
}

let issues = [];
try {
  const newCodeFilter = showAll ? '' : '&inNewCodePeriod=true';
  const response = await api(
    `/api/issues/search?componentKeys=${encodeURIComponent(projectKey)}&branch=${encodeURIComponent(branch)}&resolved=false${newCodeFilter}&ps=200`,
  );

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  issues = (await response.json()).issues ?? [];
} catch (error) {
  await deleteBranch();
  fail(
    'analysis succeeded, but its issues could not be read back: ' +
      (error instanceof Error ? error.message : String(error)),
  );
}

await deleteBranch();

const elapsedSeconds = Math.round((Date.now() - startedAt) / 1_000);
const scope = showAll ? 'in the changed files' : `introduced compared with ${referenceBranch}`;

if (issues.length === 0) {
  console.log(
    `[sonar-precheck] clean — no issues ${scope}; ${files.length} file(s), ${elapsedSeconds}s.`,
  );
  process.exit(0);
}

console.error(`\n[sonar-precheck] ${issues.length} issue(s) ${scope}:\n`);
for (const issue of issues) {
  const file = issue.component.split(':').slice(1).join(':');
  console.error(`  ${file}:${issue.line ?? '?'} [${issue.severity}] ${issue.rule}`);
  console.error(`    ${issue.message}`);
}

console.error('\nFix these server-reported issues before pushing.\n');
process.exit(1);
