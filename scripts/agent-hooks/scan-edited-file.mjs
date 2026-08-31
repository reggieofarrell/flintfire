#!/usr/bin/env node

/**
 * Gives coding agents immediate SonarJS feedback after they edit a source file.
 *
 * Cursor, Claude, and Codex provide different hook payload shapes. Rather than
 * coupling this script to unstable schemas, it recursively examines every
 * string in the JSON payload and keeps only existing lintable files confined
 * to this repository. Findings are capped so one edit cannot flood an agent's
 * context. A finding exits unsuccessfully so an agent cannot treat an active
 * locally reproducible Sonar rule as an optional warning.
 *
 * Paths that the main ESLint config ignores (tests, scripts, website, plans)
 * are skipped here as well, so the hook cannot fail on files `npm run lint`
 * never analyzes.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const lintableExtension = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const skippedPath =
  /(?:^|\/)(?:node_modules|dist|coverage|\.git|website|scripts|benchmarks|tests|docs\/plans)\//;
const skippedFile = /\.(?:test|spec|type-test)\.[jt]sx?$/;
const maximumFindings = 25;

/**
 * Reads the hook event payload from stdin.
 *
 * @returns {Promise<string>} Raw JSON text, or an empty string on a TTY.
 */
async function readStandardInput() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Recursively collects every string in a JSON-compatible value.
 *
 * @param {unknown} value Payload fragment.
 * @param {Set<string>} [strings] Accumulator.
 * @returns {Set<string>} All nested strings.
 */
function collectStrings(value, strings = new Set()) {
  if (typeof value === 'string') strings.add(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, strings);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, strings);
  }
  return strings;
}

/**
 * Keeps only existing, in-repo, lintable files that the main ESLint config
 * would actually analyze (production `src/` TypeScript).
 *
 * @param {Set<string>} strings Candidate paths extracted from the payload.
 * @param {string} repositoryRoot Absolute repository root.
 * @returns {string[]} Repository-relative paths.
 */
function lintableFiles(strings, repositoryRoot) {
  const files = new Set();

  for (const candidate of strings) {
    if (!lintableExtension.test(candidate) || candidate.includes('\n')) continue;

    const absolutePath = isAbsolute(candidate) ? candidate : resolve(repositoryRoot, candidate);
    const repositoryPath = relative(repositoryRoot, absolutePath);
    if (repositoryPath.startsWith('..') || isAbsolute(repositoryPath)) continue;
    if (skippedPath.test(`/${repositoryPath}/`)) continue;
    if (skippedFile.test(repositoryPath)) continue;

    try {
      if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) continue;
    } catch {
      continue;
    }

    files.add(repositoryPath);
  }

  return [...files];
}

/**
 * Optional debug logger for hook authors. Must never change the lint result.
 *
 * @param {string} message Line to append when AGENT_HOOK_LOG is set.
 */
function debug(message) {
  const target = process.env.AGENT_HOOK_LOG;
  if (!target) return;

  try {
    appendFileSync(target, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Optional debug logging must never hide or manufacture a lint result.
  }
}

const rawPayload = await readStandardInput();
let payload;
try {
  payload = JSON.parse(rawPayload);
} catch {
  process.exit(0);
}

const repositoryRoot = process.cwd();
const files = lintableFiles(collectStrings(payload), repositoryRoot);
debug(`event=${payload.hook_event_name ?? payload.event ?? '?'} files=${files.join(',')}`);
if (files.length === 0) process.exit(0);

const eslintExecutable = resolve(repositoryRoot, 'node_modules/.bin/eslint');
if (!existsSync(eslintExecutable)) process.exit(0);

let report;
try {
  report = JSON.parse(
    execFileSync(
      eslintExecutable,
      [
        '--config',
        'eslint.sonar-hook.config.mjs',
        '--no-warn-ignored',
        '--format',
        'json',
        ...files,
      ],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        maxBuffer: 32 * 1_024 * 1_024,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ),
  );
} catch (error) {
  try {
    report = JSON.parse(error?.stdout?.toString?.() ?? '');
  } catch {
    process.exit(0);
  }
}

const findings = report.flatMap(file =>
  file.messages
    .filter(message => message.ruleId?.startsWith('sonarjs/'))
    .map(message => ({
      file: relative(repositoryRoot, file.filePath),
      line: message.line,
      message: message.message,
      rule: message.ruleId,
    })),
);
if (findings.length === 0) process.exit(0);

const shown = findings.slice(0, maximumFindings);
const lines = [
  `SonarJS found ${findings.length} issue(s) in the file(s) just edited.`,
  'Fix these now unless the user has explicitly chosen otherwise.',
  '',
  ...shown.map(finding => `  ${finding.file}:${finding.line} ${finding.message} [${finding.rule}]`),
];
if (findings.length > shown.length) {
  lines.push(`  ...and ${findings.length - shown.length} more.`);
}
lines.push('', 'The full lint and server precheck cover additional type-aware rules.');

process.stderr.write(`${lines.join('\n')}\n`);
process.exit(Number(process.env.AGENT_HOOK_FINDING_EXIT ?? 2));
