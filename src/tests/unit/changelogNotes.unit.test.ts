/**
 * Strategy: the changelog generator must trim squash-nested commit subjects and
 * co-author trailers out of parsed BREAKING CHANGE notes (P14 / commit 524b983).
 * A post-pass on CHANGELOG.md would come back on the next generate.
 *
 * Guards: the current malformed 524b983 note fails the "clean" assertions until
 * `normalizeBreakingNoteText` runs; after the transform, the real breaking prose
 * remains and the nested `docs(website)` subject / Co-authored-by trailer do not.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';

const loadCjs = createRequire(join(process.cwd(), 'package.json'));
const { normalizeBreakingNoteText } = loadCjs(
  join(process.cwd(), 'scripts/normalize-breaking-notes.cjs'),
) as {
  normalizeBreakingNoteText: (text: string) => string;
};

/**
 * Breaking-note text as conventional-changelog parses it from squash commit
 * 524b983: a real BREAKING CHANGE footer, then GitHub's co-author trailer,
 * separator, and a nested conventional-commit bullet from the same squash.
 */
const MALFORMED_524B983_NOTE = [
  'withSchema and subcollection no longer accept a curried call or',
  'positional converter/opts arguments, and no longer take an explicit read-type',
  'generic. Pass the read schema as a value and move converter/sentinelPolicy into',
  'the options object; supply a writeSchema overlay for cast-free combinator writes.',
  'subcollection now requires a schema - construct an unvalidated subcollection via',
  'new FirestoreRepository(db, fullPath).',
  '',
  'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>',
  '',
  '---------',
  '',
  '* docs(website): archive v2 docs and cut Starlight site over to v3',
].join('\n');

describe('normalizeBreakingNoteText', () => {
  it('should fail the clean-note assertions against the current malformed 524b983 body', () => {
    // These are the P14 contamination checks. They must fail on the raw note so
    // the transform is not a no-op that tests still "pass".
    expect(MALFORMED_524B983_NOTE).toMatch(/Co-Authored-By:/i);
    expect(MALFORMED_524B983_NOTE).toContain(
      'docs(website): archive v2 docs and cut Starlight site over to v3',
    );
  });

  it('should keep the real breaking prose and drop co-author / nested-commit tails', () => {
    const normalized = normalizeBreakingNoteText(MALFORMED_524B983_NOTE);

    expect(normalized).toContain('withSchema and subcollection no longer accept a curried call');
    expect(normalized).toContain('new FirestoreRepository(db, fullPath).');
    expect(normalized).not.toMatch(/Co-authored-by:/i);
    expect(normalized).not.toMatch(/Co-Authored-By:/);
    expect(normalized).not.toContain(
      'docs(website): archive v2 docs and cut Starlight site over to v3',
    );
    expect(normalized).not.toContain('---------');
  });

  it('should not trim a breaking paragraph that merely mentions a conventional subject', () => {
    const prose =
      'Callers must stop importing the old path. The previous docs(website): archive note is historical.';
    expect(normalizeBreakingNoteText(prose)).toBe(prose);
  });
});
