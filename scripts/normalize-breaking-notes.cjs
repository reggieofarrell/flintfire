'use strict';

/**
 * Strip squash-merge contamination from a conventional-commits breaking-note body.
 *
 * Why this exists: GitHub squash-and-merge concatenates the winning commit's
 * `BREAKING CHANGE` footer with `Co-authored-by` trailers and nested
 * `* type(scope): subject` bullets from other commits in the squash. conventional-changelog
 * treats the entire remainder of the footer as `note.text`, so the generated changelog
 * would otherwise publish co-author emails and unrelated nested subjects under
 * BREAKING CHANGES (P14 / commit 524b983).
 *
 * The generator — not a post-pass on CHANGELOG.md — must trim this. Regenerating
 * from git would restore any hand-deleted junk.
 *
 * Cut points (first matching line wins, always at a line start so a legitimate breaking
 * paragraph that mentions "docs(website)" in a sentence is left intact):
 * - `Co-authored-by:` / `Co-Authored-By:` (any common casing)
 * - a line of five or more hyphens (GitHub's squash `---------` separator)
 * - a nested conventional-commit bullet (`* feat(foo): ...`, `* docs(website): ...`)
 *
 * Implemented as a line scan (not a single multi-branch regex) so Sonar ReDoS hotspots
 * on nested `\s*` / quantifier patterns stay clear.
 *
 * @param {string} text Parsed breaking-note body from conventional-commits
 * @returns {string} The same text with squash/co-author tails removed, trimmed
 */
function normalizeBreakingNoteText(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return text;
  }

  const lines = text.split('\n');
  const kept = [];
  for (const line of lines) {
    // Co-author trailer — stop before it.
    if (/^Co-authored-by:/i.test(line)) break;

    // GitHub squash separator: optional surrounding whitespace, then only hyphens (≥5).
    // Trim first so we never nest `\s*` with `-{5,}` (ReDoS hotspot).
    const trimmed = line.trim();
    if (trimmed.length >= 5 && /^-+$/.test(trimmed)) break;

    // Nested conventional-commit bullet. Scope `(...)` is scanned without nested quantifiers
    // that backtrack against each other; a prose bullet like `* removed the curry form`
    // lacks the `type:` shape and is kept.
    if (/^\*\s+[a-z]+(\([^)]*\))?!?:/.test(line)) break;

    kept.push(line);
  }

  return kept.join('\n').trim();
}

module.exports = { normalizeBreakingNoteText };
