/**
 * Strategy: pin npm dist-tag selection to GitHub Release identity so a prerelease
 * can never publish as `latest`, a stable release cannot publish as `next`, and
 * untrusted tag text can never reach `npm publish --tag`.
 *
 * Guards: the four identity combinations in PLAN §6.3, tag/manifest mismatch,
 * and malicious/unrecognized release input.
 *
 * Loaded via createRequire because the helper is CommonJS (Jest's ts-jest output
 * for this suite is CJS and cannot import .mjs without an ESM loader).
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';

const loadCjs = createRequire(join(process.cwd(), 'package.json'));
const { resolveNpmDistTag, parseGitHubBoolean } = loadCjs(
  join(process.cwd(), 'scripts/resolve-npm-dist-tag.cjs'),
) as {
  resolveNpmDistTag: (input: {
    tagName: unknown;
    isPrereleaseRaw: unknown;
    packageVersion: unknown;
  }) => 'next' | 'latest';
  parseGitHubBoolean: (raw: unknown) => boolean;
};

describe('resolveNpmDistTag', () => {
  it('should map a GitHub prerelease with a semver-prerelease manifest to next', () => {
    expect(
      resolveNpmDistTag({
        tagName: 'v3.0.0-rc.2',
        isPrereleaseRaw: 'true',
        packageVersion: '3.0.0-rc.2',
      }),
    ).toBe('next');
  });

  it('should map a GitHub stable release with a stable manifest to latest', () => {
    expect(
      resolveNpmDistTag({
        tagName: 'v3.0.0',
        isPrereleaseRaw: 'false',
        packageVersion: '3.0.0',
      }),
    ).toBe('latest');
  });

  it('should reject a GitHub prerelease when the manifest is stable', () => {
    expect(() =>
      resolveNpmDistTag({
        tagName: 'v3.0.0',
        isPrereleaseRaw: 'true',
        packageVersion: '3.0.0',
      }),
    ).toThrow(/prerelease but package\.json version 3\.0\.0 is stable/);
  });

  it('should reject a GitHub stable release when the manifest is a prerelease', () => {
    expect(() =>
      resolveNpmDistTag({
        tagName: 'v3.0.0-rc.2',
        isPrereleaseRaw: 'false',
        packageVersion: '3.0.0-rc.2',
      }),
    ).toThrow(/stable but package\.json version 3\.0\.0-rc\.2 is a prerelease/);
  });

  it('should reject a tag that does not equal v + package.json version', () => {
    expect(() =>
      resolveNpmDistTag({
        tagName: 'v3.0.0',
        isPrereleaseRaw: 'false',
        packageVersion: '3.0.0-rc.1',
      }),
    ).toThrow(/does not match package\.json version/);
  });

  it('should reject shell-metacharacter tags before any publish interpolation', () => {
    expect(() =>
      resolveNpmDistTag({
        tagName: 'v3.0.0; rm -rf /',
        isPrereleaseRaw: 'false',
        packageVersion: '3.0.0',
      }),
    ).toThrow(/unsafe characters/);
  });

  it('should reject tags with whitespace or command substitution', () => {
    expect(() =>
      resolveNpmDistTag({
        tagName: 'v3.0.0$(whoami)',
        isPrereleaseRaw: 'false',
        packageVersion: '3.0.0',
      }),
    ).toThrow(/unsafe characters/);
  });

  it('should reject unrecognized IS_PRERELEASE values rather than coercing them', () => {
    expect(() => parseGitHubBoolean('TRUE')).toThrow(/true" or "false"/);
    expect(() => parseGitHubBoolean('1')).toThrow(/true" or "false"/);
    expect(() => parseGitHubBoolean('true\nmalicious')).toThrow(/true" or "false"/);
    expect(() => parseGitHubBoolean('')).toThrow(/true" or "false"/);
  });

  it('should reject a missing or empty tag', () => {
    expect(() =>
      resolveNpmDistTag({
        tagName: '',
        isPrereleaseRaw: 'false',
        packageVersion: '3.0.0',
      }),
    ).toThrow(/missing or unreasonably long/);
  });
});
