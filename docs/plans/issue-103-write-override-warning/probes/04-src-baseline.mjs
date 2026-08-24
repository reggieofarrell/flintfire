/**
 * Probe 04 — `process.env` / `console.warn` baseline in `src/` (non-test).
 *
 * Proves the library currently has zero `process.env` reads and zero `console.warn` calls in
 * production source, so introducing an ungated warn is a deliberate first.
 *
 * Run:
 *   node docs/plans/issue-103-write-override-warning/probes/04-src-baseline.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'tests' || ent.name === 'benchmarks') continue;
      walk(p, out);
    } else if (ent.name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

const files = walk('src');
let envHits = [];
let warnHits = [];
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (/process\.env/.test(line)) envHits.push(`${f}:${i + 1}:${line.trim()}`);
    // Match real calls, not JSDoc `console.error(...)` examples in comments — crude: strip // and *
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//')) return;
    if (/console\.warn\s*\(/.test(line)) warnHits.push(`${f}:${i + 1}:${trimmed}`);
  });
}

console.log('src ts files (excl tests/benchmarks)', files.length);
console.log('process.env hits', envHits.length, envHits);
console.log('console.warn hits', warnHits.length, warnHits);

if (envHits.length !== 0 || warnHits.length !== 0) {
  console.error('FAIL — baseline drifted; re-verify §3 / §5');
  process.exit(1);
}
console.log('OK');
