#!/usr/bin/env node

/**
 * Synchronizes eslint-plugin-sonarjs with the SonarQube server quality profile.
 *
 * The plugin implements only a subset of SonarQube's JavaScript/TypeScript
 * analyzer, and its recommended preset is not the same thing as this project's
 * server profile. This script queries the active `ts` and `js` profiles,
 * intersects their RSPEC identifiers with plugin rules, and commits two lists:
 *
 * - `all`: complete locally implementable profile for normal ESLint runs
 * - `fast`: rules that do not require TypeScript type information, suitable for
 *   low-latency coding-agent post-edit feedback
 *
 * Authentication is delegated to the SonarQube CLI connection created by
 * `sonar auth login --server https://sonar.casadega.dev`. The repository never
 * reads, prints, or depends on the CLI's private credential-storage format.
 *
 * When credentials exist before the Sonar project is provisioned, the script
 * uses each language's server-default profile. A later project-specific sync
 * records a different scope even if the rule lists happen to match, making the
 * transition visible in review. `--bootstrap` remains the offline fallback.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sonarjs from 'eslint-plugin-sonarjs';
import { resolveExecutable } from '../lib/resolve-executable.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const outputPath = resolve(import.meta.dirname, 'rules.json');
const propertiesPath = resolve(repositoryRoot, 'sonar-project.properties');
const languages = ['ts', 'js'];

/**
 * Resolves the SonarQube CLI only when a live API call is about to run.
 *
 * Importing this module for unit tests of `resolveSonarHost` /
 * `parseAuthenticatedSonarHost` must not require the CLI to be installed;
 * CI runs those tests without Scanner or CLI on PATH.
 *
 * @returns {string} Absolute path to the `sonar` executable.
 */
function sonarCli() {
  return resolveExecutable('sonar');
}

/**
 * Reads one simple key=value entry from sonar-project.properties.
 *
 * @param {string} name Property key, for example `sonar.host.url`.
 * @returns {string | undefined} Trimmed value, or undefined when missing.
 */
function property(name) {
  const line = readFileSync(propertiesPath, 'utf8')
    .split('\n')
    .find(candidate => candidate.trim().startsWith(`${name}=`));
  return line?.split('=').slice(1).join('=').trim() || undefined;
}

/**
 * Prefer the repository's committed host over an inherited shell value. A
 * developer commonly works across projects backed by different SonarQube
 * servers, so a global SONAR_HOST_URL must not silently redirect profile sync.
 * The environment remains a fallback for consumers that remove the property.
 *
 * @param {string | undefined} configuredHost Value from sonar-project.properties.
 * @param {string | undefined} environmentHost Value from SONAR_HOST_URL.
 * @returns {string | undefined} Host URL to use for this sync.
 */
export function resolveSonarHost(configuredHost, environmentHost) {
  return configuredHost?.trim() || environmentHost?.trim() || undefined;
}

/**
 * Extract the active server from the human-readable CLI status response.
 *
 * @param {string} output Combined stdout from `sonar auth status`.
 * @returns {string | undefined} Authenticated host URL.
 */
export function parseAuthenticatedSonarHost(output) {
  const serverLine = output.split(/\r?\n/).find(line => line.trimStart().startsWith('Server'));
  return serverLine?.trim().split(/\s+/)[1];
}

/**
 * Asks the authenticated CLI which server it is talking to.
 *
 * @returns {string | undefined} Host URL from `sonar auth status`.
 */
function authenticatedSonarHost() {
  const output = execFileSync(sonarCli(), ['auth', 'status'], {
    encoding: 'utf8',
    maxBuffer: 4 * 1_024 * 1_024,
  });
  return parseAuthenticatedSonarHost(output);
}

/**
 * Call the Web API through the CLI so it owns all credential handling.
 *
 * @param {string} path Absolute Web API path including the leading slash.
 * @returns {unknown} Parsed JSON body.
 */
function sonarApi(path) {
  return JSON.parse(
    execFileSync(sonarCli(), ['api', 'get', path], {
      encoding: 'utf8',
      maxBuffer: 64 * 1_024 * 1_024,
    }),
  );
}

/**
 * Maps a plugin rule to its RSPEC identifier from the docs URL.
 *
 * @param {{ meta?: { docs?: { url?: string } } }} rule eslint-plugin-sonarjs rule.
 * @returns {string | undefined} Identifier such as `S1234`.
 */
function pluginRuleId(rule) {
  return /rspec\/(S\d+)\//.exec(rule.meta?.docs?.url ?? '')?.[1];
}

/**
 * Locale-independent string sort so generated JSON is stable across machines.
 *
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
function byCodeUnit(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Rule names enabled in the plugin's recommended preset (offline bootstrap).
 *
 * @returns {string[]} Unqualified sonarjs rule names.
 */
function enabledRecommendedRuleNames() {
  return Object.entries(sonarjs.configs.recommended.rules)
    .filter(
      ([, value]) =>
        value !== 'off' &&
        value !== 0 &&
        !(Array.isArray(value) && (value[0] === 'off' || value[0] === 0)),
    )
    .map(([qualifiedName]) => qualifiedName.replace(/^sonarjs\//, ''));
}

/**
 * Loads language profiles for the project, or each language's server default.
 *
 * @param {string} projectKey Committed `sonar.projectKey`.
 * @param {boolean} projectExists Whether the server already has this project.
 * @returns {object[]} Quality-profile records from the Web API.
 */
function getQualityProfiles(projectKey, projectExists) {
  const profiles = [];
  if (projectExists) {
    const result = sonarApi(
      `/api/qualityprofiles/search?project=${encodeURIComponent(projectKey)}`,
    );
    profiles.push(...(result.profiles ?? []));
  } else {
    console.warn(
      `[sonar-rules] ${projectKey} is not provisioned; using server-default language profiles.`,
    );
    for (const language of languages) {
      const result = sonarApi(
        `/api/qualityprofiles/search?language=${encodeURIComponent(language)}`,
      );
      const profile = (result.profiles ?? []).find(
        candidate => candidate.language === language && candidate.isDefault === true,
      );
      if (profile) profiles.push(profile);
    }
  }

  return profiles;
}

/**
 * Finds the profile for one language in a previously loaded list.
 *
 * @param {object[]} profiles Profiles returned by `getQualityProfiles`.
 * @param {string} language Sonar language key (`ts` or `js`).
 * @param {string} profileScope Human-readable scope for error messages.
 * @returns {object} Matching profile.
 */
function getLanguageProfile(profiles, language, profileScope) {
  const profile = profiles.find(candidate => candidate.language === language);
  if (!profile) {
    throw new Error(`No ${profileScope} ${language} quality profile was found.`);
  }
  return profile;
}

/**
 * Collects every active rule ID from one quality profile, paging the API.
 *
 * @param {{ key: string }} profile Quality profile with a server key.
 * @param {Set<string>} active Accumulator of RSPEC identifiers.
 */
function collectProfileRuleIds(profile, active) {
  let profileRuleCount = 0;
  for (let page = 1; ; page += 1) {
    const result = sonarApi(
      `/api/rules/search?activation=true&qprofile=${encodeURIComponent(profile.key)}&ps=500&p=${page}&f=lang`,
    );
    const batch = result.rules ?? [];
    for (const rule of batch) {
      const [, ruleId] = rule.key.split(':');
      if (ruleId) active.add(ruleId);
    }
    profileRuleCount += batch.length;
    if (batch.length === 0 || profileRuleCount >= (result.total ?? 0)) return;
  }
}

/**
 * Resolves the active JS/TS rule IDs for this repository's Sonar project.
 *
 * @param {string} projectKey Committed `sonar.projectKey`.
 * @returns {{ activeRuleIds: Set<string>, profileScope: string }}
 */
function serverRuleIds(projectKey) {
  const projectSearch = sonarApi(`/api/projects/search?projects=${encodeURIComponent(projectKey)}`);
  const projectExists = (projectSearch.components ?? []).some(
    component => component.key === projectKey,
  );
  const profileScope = projectExists ? 'project' : 'server-default';
  const profiles = getQualityProfiles(projectKey, projectExists);
  const active = new Set();

  for (const language of languages) {
    collectProfileRuleIds(getLanguageProfile(profiles, language, profileScope), active);
  }

  return {
    activeRuleIds: active,
    profileScope: projectExists ? `project:${projectKey}` : profileScope,
  };
}

/**
 * Intersects plugin rules with either the server profile or the recommended preset.
 *
 * @param {Set<string>} activeRuleIds RSPEC IDs enabled on the server.
 * @param {boolean} bootstrap When true, ignore the server and use recommended.
 * @returns {{ all: string[], fast: string[] }} Sorted unqualified rule names.
 */
function buildRuleSets(activeRuleIds, bootstrap) {
  const all = [];
  const fast = [];
  const bootstrapNames = new Set(enabledRecommendedRuleNames());

  for (const [name, rule] of Object.entries(sonarjs.rules)) {
    const enabled = bootstrap ? bootstrapNames.has(name) : activeRuleIds.has(pluginRuleId(rule));
    if (!enabled) continue;

    all.push(name);
    if (!rule.meta?.docs?.requiresTypeChecking) fast.push(name);
  }

  all.sort(byCodeUnit);
  fast.sort(byCodeUnit);
  return { all, fast };
}

/**
 * CLI entry: `--bootstrap` for offline recommended rules, `--check` to assert
 * the committed file matches a fresh generation.
 */
async function run() {
  const arguments_ = new Set(process.argv.slice(2));
  arguments_.delete('--');
  const bootstrap = arguments_.delete('--bootstrap');
  const check = arguments_.delete('--check');
  if (arguments_.size > 0) {
    throw new Error(`Unknown option(s): ${[...arguments_].join(', ')}`);
  }

  const host = resolveSonarHost(property('sonar.host.url'), process.env.SONAR_HOST_URL);
  const projectKey = property('sonar.projectKey');
  if (!host || !projectKey) throw new Error('Sonar host and project key are required.');

  let activeRuleIds = new Set();
  let profileScope = 'offline-bootstrap';
  if (!bootstrap) {
    const authenticatedHost = authenticatedSonarHost();
    if (!authenticatedHost) {
      throw new Error(
        `Unable to determine the authenticated server. Run \`sonar auth login --server ${host}\`.`,
      );
    }
    if (authenticatedHost.replace(/\/$/, '') !== host.replace(/\/$/, '')) {
      throw new Error(
        `SonarQube CLI is authenticated to ${authenticatedHost}, but this repository requires ${host}.`,
      );
    }
    ({ activeRuleIds, profileScope } = serverRuleIds(projectKey));
  }

  const ruleSets = buildRuleSets(activeRuleIds, bootstrap);
  const payload = `${JSON.stringify(
    {
      $comment: 'Generated by scripts/sonar-rules/sync.mjs; do not edit manually.',
      source: bootstrap ? 'eslint-plugin-sonarjs-recommended-bootstrap' : host,
      profileScope,
      serverActiveRules: bootstrap ? null : activeRuleIds.size,
      ...ruleSets,
    },
    null,
    2,
  )}\n`;

  if (check) {
    const current = readFileSync(outputPath, 'utf8');
    if (current !== payload) {
      throw new Error('Generated SonarJS rules have drifted; run `npm run sonar:rules`.');
    }
    console.log(`[sonar-rules] current (${ruleSets.all.length} rules).`);
    return;
  }

  writeFileSync(outputPath, payload);
  const sourceDescription = bootstrap ? 'bootstrap profile' : `${host} ${profileScope}`;
  console.log(
    `[sonar-rules] wrote ${ruleSets.all.length} rules (${ruleSets.fast.length} fast) from ${sourceDescription}.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    await run();
  } catch (error) {
    console.error(`[sonar-rules] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
