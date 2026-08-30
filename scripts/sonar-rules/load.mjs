/**
 * Loads the committed SonarJS rule intersection without making lint depend on
 * network availability. A corrupt generated file is a hard configuration
 * failure; only a genuinely missing file degrades to an empty rule set.
 */

import { readFileSync } from 'node:fs';

const rulesUrl = new URL('./rules.json', import.meta.url);

/**
 * Reads `rules.json` next to this module.
 *
 * @returns {{all: string[], fast: string[], source: string}} Locally enforced
 *   rule names and the profile they came from.
 */
function load() {
  try {
    const parsed = JSON.parse(readFileSync(rulesUrl, 'utf8'));
    return {
      all: parsed.all ?? [],
      fast: parsed.fast ?? [],
      source: parsed.source ?? 'unknown',
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    console.warn(
      '[sonarjs] Generated rules are missing; run `npm run sonar:rules -- --bootstrap` ' +
        'or authenticate and run `npm run sonar:rules`.',
    );
    return { all: [], fast: [], source: 'missing' };
  }
}

export const sonarRules = load();
