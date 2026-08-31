/**
 * Centralizes local SonarQube credential precedence without exposing token
 * values to logs. A macOS keychain entry is keyed by the repository's pinned
 * host, while an inherited `SONAR_TOKEN` carries no host identity; therefore,
 * the host-scoped credential is the safer first choice when both exist.
 */

/**
 * @typedef {'environment' | 'macos-keychain'} SonarTokenSource
 */

/**
 * @typedef {object} SonarTokenResolution
 * @property {string | undefined} token Selected local user token.
 * @property {SonarTokenSource | undefined} source Selected credential source.
 * @property {boolean} ignoredEnvironmentToken Whether a different inherited token was ignored.
 */

/**
 * Normalizes a token read from an environment variable or credential store.
 * Tokens cannot meaningfully begin or end with whitespace, and treating a
 * blank value as absent prevents empty environment templates from winning.
 *
 * @param {string | undefined} value Candidate credential.
 * @returns {string | undefined} Normalized non-blank credential.
 */
function normalizeToken(value) {
  return value?.trim() || undefined;
}

/**
 * Selects a local SonarQube user token according to platform capabilities.
 * macOS prefers the host-scoped keychain entry, falling back to the environment
 * only when that entry is absent. Other platforms currently have no verified
 * credential-store adapter in this repository, so they use `SONAR_TOKEN` only.
 *
 * @param {NodeJS.Platform} platform Current Node.js platform.
 * @param {string | undefined} environmentToken Inherited SONAR_TOKEN value.
 * @param {string | undefined} keychainToken Token looked up for the pinned host.
 * @returns {SonarTokenResolution} Selected credential and safe diagnostic metadata.
 */
export function resolveLocalSonarToken(platform, environmentToken, keychainToken) {
  const normalizedEnvironmentToken = normalizeToken(environmentToken);
  const normalizedKeychainToken = normalizeToken(keychainToken);

  if (platform === 'darwin' && normalizedKeychainToken) {
    return {
      token: normalizedKeychainToken,
      source: 'macos-keychain',
      ignoredEnvironmentToken: Boolean(
        normalizedEnvironmentToken && normalizedEnvironmentToken !== normalizedKeychainToken,
      ),
    };
  }

  if (normalizedEnvironmentToken) {
    return {
      token: normalizedEnvironmentToken,
      source: 'environment',
      ignoredEnvironmentToken: false,
    };
  }

  return {
    token: undefined,
    source: undefined,
    ignoredEnvironmentToken: false,
  };
}
