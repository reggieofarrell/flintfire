'use strict';

/**
 * commit-and-tag-version preset for FlintFire.
 *
 * Wraps `conventional-changelog-conventionalcommits` so type-to-section mappings
 * and URL formats stay identical to the previous `.versionrc.json`, while parsed
 * breaking-note text is trimmed at co-author / squash delimiters *before* the
 * base writer transform (P14). Do not regex the generated Markdown after the fact:
 * the next `release:bump` would restore the contamination.
 *
 * Loaded via `.versionrc.cjs` as `{ name: require.resolve(this file), types, ... }`.
 * The absolute `name` is required: a relative preset string is prefixed with
 * `conventional-changelog-` by conventional-changelog-preset-loader and would
 * fail to resolve.
 *
 * @param {object} config Preset object from `.versionrc.cjs` (`name` plus types/URL formats)
 * @returns {Promise<object>} conventional-changelog preset shape
 */
const conventionalcommits = require('conventional-changelog-conventionalcommits');
const { normalizeBreakingNoteText } = require('./normalize-breaking-notes.cjs');

module.exports = async function createFlintfireChangelogPreset(config = {}) {
  // `name` is only the loader key; forwarding it into conventionalcommits would
  // be ignored at best and confusing at worst.
  const { name: _name, ...presetConfig } = config;
  const preset = await conventionalcommits(presetConfig);
  const innerTransform = preset.writerOpts.transform;

  preset.writerOpts.transform = (commit, context) => {
    if (commit && Array.isArray(commit.notes)) {
      for (const note of commit.notes) {
        if (note && typeof note.text === 'string') {
          note.text = normalizeBreakingNoteText(note.text);
        }
      }
    }
    return innerTransform(commit, context);
  };

  return preset;
};
