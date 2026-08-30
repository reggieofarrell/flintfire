import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAuthenticatedSonarHost, resolveSonarHost } from './sonar-rules/sync.mjs';

test('prefers the repository Sonar host over an inherited environment host', () => {
  assert.equal(
    resolveSonarHost('https://sonar.casadega.dev', 'https://sonarqube.blackflag.design'),
    'https://sonar.casadega.dev',
  );
});

test('uses the environment host only when the repository does not configure one', () => {
  assert.equal(
    resolveSonarHost(undefined, 'https://sonar.example.test'),
    'https://sonar.example.test',
  );
  assert.equal(resolveSonarHost(undefined, undefined), undefined);
});

test('extracts the active host from SonarQube CLI status output', () => {
  assert.equal(
    parseAuthenticatedSonarHost(
      'Verifying token...\n\u001B[32m[✓ Connected]\u001B[0m\nServer  https://sonar.casadega.dev\nSource  OS Keychain\n',
    ),
    'https://sonar.casadega.dev',
  );
});
