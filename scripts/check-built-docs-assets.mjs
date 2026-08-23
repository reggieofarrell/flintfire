#!/usr/bin/env node
/**
 * Post-Astro guard for FlintFire brand assets in the built docs site.
 *
 * Why this exists: Astro copies `website/public/` into `website/dist/` without checking that
 * `<head>` or splash markup still points at those files. A deleted unsuffixed `favicon.svg` can
 * therefore leave a green `astro build` that 404s in the browser (P28). This script is the
 * emitted-output check that `astro build` itself does not perform.
 *
 * Path resolution is from *this file*, not `process.cwd()`, so the same command works from the
 * repo root, `website/`, and GitHub Actions. Required files are the eight owner-supplied
 * `-light`/`-dark` pairs from the v3 release brand contract. Any unsuffixed brand file or
 * reference is a failure.
 *
 * Usage: `node scripts/check-built-docs-assets.mjs` after `astro build` has written `website/dist`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const distDir = join(repoRoot, 'website', 'dist');

/** Exact eight files the brand contract requires in the emitted site. */
const REQUIRED_ASSETS = [
  'favicon-light.svg',
  'favicon-dark.svg',
  'flint-fire-icon-light.svg',
  'flint-fire-icon-dark.svg',
  'flint-fire-logo-horizontal-light.svg',
  'flint-fire-logo-horizontal-dark.svg',
  'flint-fire-logo-vertical-light.svg',
  'flint-fire-logo-vertical-dark.svg',
];

/**
 * Unsuffixed names that must not appear as emitted files or as URL references. The suffix is what
 * selects light vs dark; an unsuffixed alias would make the pair contract ambiguous.
 */
const FORBIDDEN_UNSUFFIXED = [
  'favicon.svg',
  'flint-fire-icon.svg',
  'flint-fire-logo-horizontal.svg',
  'flint-fire-logo-vertical.svg',
];

const errors = [];

function fail(message) {
  errors.push(message);
}

if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
  console.error(`check-built-docs-assets: missing dist directory: ${distDir}`);
  process.exit(1);
}

for (const file of REQUIRED_ASSETS) {
  const full = join(distDir, file);
  if (!existsSync(full) || !statSync(full).isFile()) {
    fail(`missing required emitted asset: ${file}`);
  }
}

/** Recursively list files under dist so an unsuffixed copy cannot hide in a nested folder. */
function walkFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

const emitted = walkFiles(distDir);
for (const full of emitted) {
  const rel = relative(distDir, full).replaceAll('\\', '/');
  const base = rel.split('/').pop();
  if (FORBIDDEN_UNSUFFIXED.includes(base)) {
    fail(`unsuffixed brand file was emitted: ${rel}`);
  }
}

const indexHtmlPath = join(distDir, 'index.html');
if (!existsSync(indexHtmlPath)) {
  fail('missing built index.html');
} else {
  const html = readFileSync(indexHtmlPath, 'utf8');

  // Starlight's fallback favicon option plus the Head override must both survive the build.
  // BASE_URL is `/flintfire/` after the Pages relocation; before integration the old
  // `/firestore-orm/` prefix (or a dangling unsuffixed favicon) is the expected failure.
  // Require the *joined* Pages path, not merely the filename. A missing slash
  // between BASE_URL and the file (`/flintfirefavicon-light.svg`) would still
  // match a filename-only probe and ship a 404.
  const hasLightFavicon = /\/flintfire\/favicon-light\.svg/.test(html);
  const hasDarkFavicon = /\/flintfire\/favicon-dark\.svg/.test(html);
  const hasLightMedia = /prefers-color-scheme:\s*light/.test(html);
  const hasDarkMedia = /prefers-color-scheme:\s*dark/.test(html);

  if (!hasLightFavicon) fail('index.html does not reference favicon-light.svg');
  if (!hasDarkFavicon) fail('index.html does not reference favicon-dark.svg');
  if (!hasLightMedia) fail('index.html is missing prefers-color-scheme: light on a favicon link');
  if (!hasDarkMedia) fail('index.html is missing prefers-color-scheme: dark on a favicon link');

  const hasLightIcon = /flint-fire-icon-light\.svg/.test(html);
  const hasDarkIcon = /flint-fire-icon-dark\.svg/.test(html);
  // Starlight theme utilities: hide the light asset in dark mode and the dark asset in light mode.
  const hasDarkHidden = /dark:sl-hidden/.test(html);
  const hasLightHidden = /light:sl-hidden/.test(html);

  if (!hasLightIcon) fail('index.html does not reference flint-fire-icon-light.svg');
  if (!hasDarkIcon) fail('index.html does not reference flint-fire-icon-dark.svg');
  if (!hasDarkHidden) fail('index.html is missing dark:sl-hidden on a splash image');
  if (!hasLightHidden) fail('index.html is missing light:sl-hidden on a splash image');

  for (const name of FORBIDDEN_UNSUFFIXED) {
    if (html.includes(name) || html.includes(`/${name}`)) {
      fail(`index.html references unsuffixed brand path: ${name}`);
    }
  }
}

if (errors.length > 0) {
  console.error('check-built-docs-assets: FAILED');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log('check-built-docs-assets: ok (eight paired assets, no unsuffixed brand refs)');
