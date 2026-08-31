#!/usr/bin/env node
/* eslint-env node */
/**
 * Deprecated-zod-idiom checker for flintfire.
 *
 * Fails (exit 1) when teaching material uses a `z.string().<format>()` idiom that zod 4 marks
 * `@deprecated` (see `zod/v4/classic/schemas.d.cts`, the `ZodString` interface). The `zod` peer
 * range is `^4.0.0`, so the top-level forms (`z.email()`, `z.iso.datetime()`, …) are the only
 * idioms current docs should teach. These still *work* today, so nothing else catches them:
 * `check:docs` validates links and anchors, and no gate compiles README snippets at all.
 *
 * Why a grep and not a compiler: the deprecated methods type-check fine, so a snippet-compiling
 * harness would pass on exactly the drift this guards against. When zod eventually *removes* them,
 * the npm README's Quick Start goes from stale to broken with no gate in between.
 *
 * Scanned:
 *   - every Markdown doc (`*.md` / `*.mdc` / `*.mdx`) outside the excluded trees below
 *   - `src/**\/*.ts` — JSDoc examples are teaching material too; they surface on IDE hover
 *
 * Not scanned, deliberately:
 *   - `website/src/content/docs/<major>.<minor>/**` — frozen version archives. The 2.x docs
 *     declare a `zod` peer range of `^3.25.0 || ^4.0.0`, so `z.string().email()` is the *correct*
 *     cross-compatible idiom there; "fixing" it would misdocument the shipped version.
 *   - `CHANGELOG.md` — generated from Conventional Commits; a historical record.
 *   - `src/tests/**`, `src/benchmarks/**` — fixtures, not teaching material. Churning them would
 *     move test data around for no consumer benefit.
 *
 * Escape hatch: a line carrying `zod-idioms-allow` in a comment (`<!-- zod-idioms-allow -->` in
 * Markdown, `// zod-idioms-allow` in TypeScript), on the offending line or the one before it, is
 * skipped — for prose that must quote the old idiom (e.g. a migration guide's "before" snippet).
 *
 * Usage: node scripts/check-zod-idioms.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Deprecated `ZodString` method → the zod 4 top-level replacement it points at. */
const REPLACEMENTS = {
  email: 'z.email()',
  url: 'z.url()',
  jwt: 'z.jwt()',
  emoji: 'z.emoji()',
  guid: 'z.guid()',
  uuid: 'z.uuid()',
  uuidv4: 'z.uuid()',
  uuidv6: 'z.uuid()',
  uuidv7: 'z.uuid()',
  nanoid: 'z.nanoid()',
  cuid: 'z.cuid2()',
  cuid2: 'z.cuid2()',
  ulid: 'z.ulid()',
  base64: 'z.base64()',
  base64url: 'z.base64url()',
  xid: 'z.xid()',
  ksuid: 'z.ksuid()',
  ipv4: 'z.ipv4()',
  ipv6: 'z.ipv6()',
  cidrv4: 'z.cidrv4()',
  cidrv6: 'z.cidrv6()',
  e164: 'z.e164()',
  datetime: 'z.iso.datetime()',
  date: 'z.iso.date()',
  time: 'z.iso.time()',
  duration: 'z.iso.duration()',
};

// `.string()` followed by a chain of simple calls, ending in a deprecated format method.
// The intermediate `[^()]*` keeps this to non-nested arguments, which is every real-world case
// (`z.string().min(1, 'Name is required').email()`) and avoids false positives on nested calls.
// String.raw avoids double-escaping backslashes in the RegExp source (javascript:S7780).
const IDIOM_RE = new RegExp(
  String.raw`\.string\(\s*\)((?:\s*\.\w+\([^()]*\))*?)\s*\.(${Object.keys(REPLACEMENTS).join('|')})\s*\(`,
  'g',
);

const ALLOW_MARKER = 'zod-idioms-allow';

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.astro',
  'tmp',
  'benchmarks', // src/benchmarks — perf fixtures
]);

/** Frozen Starlight version archives, e.g. `website/src/content/docs/2.0/…`. */
const VERSION_ARCHIVE = /website[/\\]src[/\\]content[/\\]docs[/\\]\d+\.\d+[/\\]/;

const rel = file => file.slice(repoRoot.length + 1);

function isExcluded(file) {
  const r = rel(file);
  if (VERSION_ARCHIVE.test(r)) return true;
  if (r === 'CHANGELOG.md') return true;
  if (r.startsWith(join('src', 'tests'))) return true;
  return false;
}

const SCANNED_EXT = /\.(mdx?|mdc)$/;

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    if (entry.isSymbolicLink()) continue; // real target is scanned via its canonical path
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(full, out);
      continue;
    }
    const isDoc = SCANNED_EXT.test(entry.name);
    const isSrcTs = entry.name.endsWith('.ts') && rel(full).startsWith(`src${sep}`);
    if ((isDoc || isSrcTs) && !isExcluded(full)) out.push(full);
  }
  return out;
}

const problems = [];
const files = collect(repoRoot);

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    const allowed =
      line.includes(ALLOW_MARKER) || (index > 0 && lines[index - 1].includes(ALLOW_MARKER));
    if (allowed) return;
    IDIOM_RE.lastIndex = 0;
    let match;
    while ((match = IDIOM_RE.exec(line))) {
      const method = match[2];
      problems.push({
        file,
        line: index + 1,
        found: `z.string()${match[1].trim()}.${method}()`,
        replacement: REPLACEMENTS[method],
      });
    }
  });
}

if (problems.length > 0) {
  console.error(`\n✗ ${problems.length} deprecated zod idiom(s) in teaching material:\n`);
  for (const p of problems) {
    console.error(`  ${rel(p.file)}:${p.line}  ${p.found}  →  use ${p.replacement}`);
  }
  console.error(
    `\nThe zod peer range is ^4.0.0; these methods are @deprecated and will eventually be removed.` +
      `\nIf a line must quote the old idiom (a migration "before" snippet), mark it ${ALLOW_MARKER}.\n`,
  );
  process.exit(1);
}

console.log(`✓ zod idioms OK (${files.length} files scanned)`);
