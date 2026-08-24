#!/usr/bin/env node
/**
 * Helpers for the rulesync-upgrade workflow's cooldown-aware bump.
 *
 * `.npmrc` `min-release-age` makes `npm install rulesync@*` fail with ETARGET
 * when *every* version matching the current range is still too new — which is
 * the normal case right after we land a bump (the lockfile is on a version
 * inside the window). The workflow must skip in that situation, not fail, and
 * must never downgrade to an older eligible release.
 *
 * Usage:
 *   npm view rulesync time --json | node scripts/rulesync-newest-eligible.mjs eligible --days 2
 *     Prints the newest x.y.z published at least `--days` ago, or nothing.
 *
 *   node scripts/rulesync-newest-eligible.mjs gte 16.15.0 16.14.0
 *     Exit 0 if the first semver is greater than or equal to the second.
 */

import { readFileSync } from 'node:fs';

/**
 * Parse a `major.minor.patch` string into a numeric triple. Rulesync does not
 * ship prerelease tags on the versions we consume; anything with `-` is ignored
 * by the caller before it gets here.
 *
 * @param {string} version
 * @returns {[number, number, number]}
 */
function parseRelease(version) {
  const parts = version.split('.').map(part => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some(n => Number.isNaN(n))) {
    throw new Error(`expected major.minor.patch, got ${version}`);
  }
  return /** @type {[number, number, number]} */ (parts);
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {number} negative if left < right, 0 if equal, positive if left > right
 */
function compareRelease(left, right) {
  const a = parseRelease(left);
  const b = parseRelease(right);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}

/**
 * Pick the newest non-prerelease version whose publish timestamp is on or before
 * `cutoff`. `npm view <pkg> time` includes `created` / `modified` keys that are
 * not versions — skip those.
 *
 * @param {Record<string, string>} times
 * @param {Date} cutoff
 * @returns {string | null}
 */
function newestEligible(times, cutoff) {
  /** @type {string | null} */
  let best = null;
  for (const [key, iso] of Object.entries(times)) {
    if (key === 'created' || key === 'modified') {
      continue;
    }
    // Skip prereleases (`1.2.3-rc.1`) — the upgrade workflow tracks stables.
    if (key.includes('-')) {
      continue;
    }
    const published = Date.parse(iso);
    if (Number.isNaN(published) || published > cutoff.getTime()) {
      continue;
    }
    if (best === null || compareRelease(key, best) > 0) {
      best = key;
    }
  }
  return best;
}

const [mode, ...rest] = process.argv.slice(2);

if (mode === 'gte') {
  const [left, right] = rest;
  if (!left || !right) {
    console.error('usage: rulesync-newest-eligible.mjs gte <left> <right>');
    process.exit(2);
  }
  process.exit(compareRelease(left, right) >= 0 ? 0 : 1);
}

if (mode === 'eligible') {
  const daysFlag = rest.indexOf('--days');
  const daysRaw = daysFlag >= 0 ? rest[daysFlag + 1] : undefined;
  const days = Number(daysRaw);
  if (!Number.isFinite(days) || days < 0) {
    console.error('usage: rulesync-newest-eligible.mjs eligible --days <n>');
    process.exit(2);
  }
  const times = JSON.parse(readFileSync(0, 'utf8'));
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const version = newestEligible(times, cutoff);
  if (version) {
    process.stdout.write(version);
  }
  process.exit(0);
}

console.error('usage: rulesync-newest-eligible.mjs eligible --days <n> | gte <a> <b>');
process.exit(2);
