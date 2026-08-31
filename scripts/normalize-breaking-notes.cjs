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
 * Cut points (first match wins, always at a line start so a legitimate breaking
 * paragraph that mentions "docs(website)" in a sentence is left intact):
 * - `Co-authored-by:` / `Co-Authored-By:` (any common casing)
 * - a line of five or more hyphens (GitHub's squash `---------` separator)
 * - a nested conventional-commit bullet (`* feat(foo): ...`, `* docs(website): ...`)
 *
 * @param {string} text Parsed breaking-note body from conventional-commits
 * @returns {string} The same text with squash/co-author tails removed, trimmed
 */
function normalizeBreakingNoteText(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return text;
  }

  // Split into three simpler patterns so javascript:S5843 stays under the complexity
  // budget. Multiline so `^`/`$` match each line. The nested-commit arm requires a
  // conventional type token after `* ` so a markdown bullet that is part of the
  // breaking prose (`* removed the curry form`) is not treated as a second commit.
  const cutPatterns = [
    /(?:^|\n)Co-authored-by:/im,
    /(?:^|\n)\s*-{5,}\s*$/im,
    /(?:^|\n)\*\s+[a-z]+(?:\([^)]+\))?!?:/im,
  ];

  let earliest = -1;
  for (const pattern of cutPatterns) {
    const match = pattern.exec(text);
    if (match && (earliest < 0 || match.index < earliest)) {
      earliest = match.index;
    }
  }

  if (earliest < 0) {
    return text.trim();
  }
  return text.slice(0, earliest).trim();
}

module.exports = { normalizeBreakingNoteText };
