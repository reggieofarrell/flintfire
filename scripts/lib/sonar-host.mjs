/**
 * Owns the repository-local SonarQube host-selection policy shared by precheck
 * analysis and server-profile synchronization. The committed properties file
 * is the only authority: a developer's inherited `SONAR_HOST_URL` may belong
 * to another project and must never redirect source or API traffic.
 */

/**
 * Normalizes a configured host for reliable comparison and downstream use.
 * Trailing slashes do not identify a different SonarQube server, so removing
 * them prevents an equivalent environment value from producing a false alarm.
 *
 * @param {string | undefined} value Candidate SonarQube host value.
 * @returns {string | undefined} Normalized non-blank host.
 */
function normalizeSonarHost(value) {
  return value?.trim().replace(/\/+$/, '') || undefined;
}

/**
 * @typedef {object} SonarHostResolution
 * @property {string} host Authoritative host from sonar-project.properties.
 * @property {string | undefined} ignoredEnvironmentHost Conflicting inherited host.
 */

/**
 * Resolves the repository's SonarQube host without allowing environment
 * fallback or override. Missing committed identity is a blocking configuration
 * error because selecting a server is local deterministic policy, not an
 * external prerequisite that may safely use the precheck's unavailable status.
 *
 * @param {string | undefined} configuredHost Committed sonar.host.url value.
 * @param {string | undefined} environmentHost Inherited SONAR_HOST_URL value.
 * @returns {SonarHostResolution} Authoritative host and optional disagreement.
 * @throws {Error} When the repository does not pin a non-blank host.
 */
export function resolveRepositorySonarHost(configuredHost, environmentHost) {
  const host = normalizeSonarHost(configuredHost);
  if (!host) {
    throw new Error(
      'sonar-project.properties must define a non-blank sonar.host.url; inherited SONAR_HOST_URL values are never used for repository-local tooling.',
    );
  }

  const inheritedHost = normalizeSonarHost(environmentHost);
  return {
    host,
    ignoredEnvironmentHost: inheritedHost && inheritedHost !== host ? inheritedHost : undefined,
  };
}
