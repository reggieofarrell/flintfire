import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRepositorySonarHost } from './lib/sonar-host.mjs';
import { resolveLocalSonarToken } from './lib/sonar-token.mjs';
import { parseAuthenticatedSonarHost } from './sonar-rules/sync.mjs';

test('uses the repository Sonar host and reports a conflicting environment host', () => {
  assert.deepEqual(
    resolveRepositorySonarHost('https://sonar.casadega.dev', 'https://sonarqube.blackflag.design'),
    {
      host: 'https://sonar.casadega.dev',
      ignoredEnvironmentHost: 'https://sonarqube.blackflag.design',
    },
  );
});

test('treats blank and equivalent environment values as non-overrides', () => {
  assert.deepEqual(resolveRepositorySonarHost('https://sonar.casadega.dev/', ''), {
    host: 'https://sonar.casadega.dev',
    ignoredEnvironmentHost: undefined,
  });
  assert.deepEqual(
    resolveRepositorySonarHost('https://sonar.casadega.dev', 'https://sonar.casadega.dev/'),
    {
      host: 'https://sonar.casadega.dev',
      ignoredEnvironmentHost: undefined,
    },
  );
  assert.deepEqual(resolveRepositorySonarHost('https://sonar.casadega.dev', undefined), {
    host: 'https://sonar.casadega.dev',
    ignoredEnvironmentHost: undefined,
  });
});

test('blocks when sonar-project.properties does not pin a host', () => {
  assert.throws(
    () => resolveRepositorySonarHost(undefined, 'https://sonar.example.test'),
    /must define a non-blank sonar\.host\.url/,
  );
  assert.throws(
    () => resolveRepositorySonarHost('  ', undefined),
    /must define a non-blank sonar\.host\.url/,
  );
});

test('prefers the host-scoped macOS keychain token over an inherited token', () => {
  assert.deepEqual(resolveLocalSonarToken('darwin', 'other-server-token', 'pinned-token'), {
    token: 'pinned-token',
    source: 'macos-keychain',
    ignoredEnvironmentToken: true,
  });
  assert.deepEqual(resolveLocalSonarToken('darwin', 'pinned-token', 'pinned-token'), {
    token: 'pinned-token',
    source: 'macos-keychain',
    ignoredEnvironmentToken: false,
  });
});

test('falls back to SONAR_TOKEN when no macOS keychain token exists', () => {
  assert.deepEqual(resolveLocalSonarToken('darwin', ' environment-token ', undefined), {
    token: 'environment-token',
    source: 'environment',
    ignoredEnvironmentToken: false,
  });
});

test('uses only SONAR_TOKEN on platforms without a supported credential adapter', () => {
  assert.deepEqual(resolveLocalSonarToken('linux', 'environment-token', 'unused-token'), {
    token: 'environment-token',
    source: 'environment',
    ignoredEnvironmentToken: false,
  });
  assert.deepEqual(resolveLocalSonarToken('win32', '', undefined), {
    token: undefined,
    source: undefined,
    ignoredEnvironmentToken: false,
  });
});

test('extracts the active host from SonarQube CLI status output', () => {
  assert.equal(
    parseAuthenticatedSonarHost(
      'Verifying token...\n\u001B[32m[✓ Connected]\u001B[0m\nServer  https://sonar.casadega.dev\nSource  OS Keychain\n',
    ),
    'https://sonar.casadega.dev',
  );
});
