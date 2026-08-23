'use strict';

/**
 * commit-and-tag-version configuration for FlintFire.
 *
 * This is a `.cjs` file (not JSON) so `preset.name` can be an absolute
 * `require.resolve` path. conventional-changelog-preset-loader prefixes
 * non-absolute preset names with `conventional-changelog-`, so a relative
 * `./scripts/changelog-preset.cjs` would fail to load.
 *
 * `types` and URL formats are passed both at the top level (commit-and-tag-version
 * still reads them for bump/commit URL rendering) and inside `preset` so the
 * wrapped conventionalcommits writer sees the same mappings.
 */
const types = [
  { type: 'feat', section: 'Added' },
  { type: 'fix', section: 'Fixed' },
  { type: 'perf', section: 'Changed' },
  { type: 'refactor', section: 'Changed' },
  { type: 'revert', section: 'Changed' },
  { type: 'docs', section: 'Documentation' },
  { type: 'chore', hidden: true },
  { type: 'style', hidden: true },
  { type: 'test', hidden: true },
  { type: 'build', hidden: true },
  { type: 'ci', hidden: true },
];

const commitUrlFormat = 'https://github.com/reggieofarrell/flintfire/commit/{{hash}}';
const compareUrlFormat =
  'https://github.com/reggieofarrell/flintfire/compare/{{previousTag}}...{{currentTag}}';
const issueUrlFormat = 'https://github.com/reggieofarrell/flintfire/issues/{{id}}';

module.exports = {
  header:
    '# Changelog\n\nAll notable changes to this project are documented in this file.\n\nThe format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project\nadheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).\n',
  types,
  commitUrlFormat,
  compareUrlFormat,
  issueUrlFormat,
  scripts: {
    postchangelog: 'prettier --write CHANGELOG.md',
  },
  preset: {
    name: require.resolve('./scripts/changelog-preset.cjs'),
    types,
    commitUrlFormat,
    compareUrlFormat,
    issueUrlFormat,
  },
};
