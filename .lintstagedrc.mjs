import { lstatSync } from 'node:fs';

/**
 * Prettier (and ESLint) error when a symlink is passed explicitly on the CLI.
 *
 * The repo currently commits no symlinks: the `.claude/` command/skill mirrors are gone (rulesync
 * generates real files into `.claude/`), and `CLAUDE.md` is generated rather than symlinked to
 * `AGENTS.md`. This filter is kept as a guard so that reintroducing a committed symlink cannot
 * silently break lint-staged for every other file in the same commit.
 */
const realFiles = files => files.filter(file => !lstatSync(file).isSymbolicLink());

export default {
  '*.{ts,js}': files => {
    const list = realFiles(files);
    if (list.length === 0) return [];
    const joined = list.join(' ');
    return [`eslint --fix ${joined}`, `prettier --write ${joined}`];
  },
  '*.{json,md,yml,yaml}': files => {
    const list = realFiles(files);
    if (list.length === 0) return [];
    return [`prettier --write --ignore-unknown ${list.join(' ')}`];
  },
};
