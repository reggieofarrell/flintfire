import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
// import-x is the ESLint 10–compatible fork of eslint-plugin-import; same
// no-extraneous-dependencies rule the Starlight plan called for.
import importX from 'eslint-plugin-import-x';
import sonarjs from 'eslint-plugin-sonarjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sonarRules } from './scripts/sonar-rules/load.mjs';

/**
 * Enforce every active server rule that eslint-plugin-sonarjs implements. The
 * server remains authoritative for rules and analyzers unavailable locally,
 * while the locally reproducible intersection is a hard gate from day one.
 */
const sonarEnforcedRules = Object.fromEntries(
  sonarRules.all.map(rule => [`sonarjs/${rule}`, 'error']),
);

const rootDir = dirname(fileURLToPath(import.meta.url));
// Nested docs site only — do NOT also list the repo root here. Passing both
// would merge allowed deps from parent + child and defeat the boundary.
const websiteDir = join(rootDir, 'website');

export default [
  // Ignore build output, dependencies, coverage, tests, and benchmarks
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/benchmarks/**',
      'scripts/**',
      // Root CJS changelog config: same Node `module`/`require` globals as scripts/**
      // (ignored above). ESLint's default env is ESM/browser and flags those as undef.
      '.versionrc.cjs',
      // Astro/Starlight UI: no Astro parser is wired into this ESLint config, so the
      // default JS parser dies on frontmatter. Component correctness is checked by
      // `astro check` / the docs build, not eslint.
      '**/*.astro',
      // Scratch notes/plans/probes/reviews (gitignored) — must not fail lint the way a
      // relative-looking link in tmp/ used to fail check:docs (issue #34 review O2).
      'tmp/**',
      // Agent-hook ESLint config is loaded by a dedicated command, not `eslint .`.
      'eslint.sonar-hook.config.mjs',
      // Committed implementation plans (docs/plans/<issue>/) and their probes. Probes are
      // throwaway evidence scripts, not library code: `.mjs` runners trip `no-undef` on Node
      // globals (the same reason `scripts/**` is ignored above) and `.ts` probes deliberately
      // contain type errors. Branch-scoped and deleted before merge — see docs/plans/README.md.
      'docs/plans/**',
      // Starlight / Astro generated + installed trees
      'website/dist/**',
      'website/.astro/**',
      'website/node_modules/**',
    ],
  },
  // Recommended JavaScript rules
  js.configs.recommended,
  // Recommended TypeScript rules (no type-aware/strict)
  ...tseslint.configs.recommended,
  // Allow explicit any; allow _-prefixed names to be unused (e.g. _ignoredId)
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  // website/ may only import packages declared in website/package.json.
  // Parent (library) deps must be re-declared there to pass lint.
  {
    files: ['website/**/*.{js,mjs,cjs,ts,tsx,astro}'],
    plugins: { 'import-x': importX },
    rules: {
      'import-x/no-extraneous-dependencies': [
        'error',
        {
          packageDir: [websiteDir],
          // Astro/Starlight config + content tooling legitimately use
          // packages that may be listed as dependencies or devDependencies.
          devDependencies: ['website/*.{js,mjs,cjs,ts}', 'website/**/*.config.{js,mjs,cjs,ts}'],
        },
      ],
    },
  },
  // Locally implementable SonarJS profile on production library source only.
  // Tests, scripts, and the website stay ignored (same as the rest of ESLint).
  // Type-aware plugin rules need a program; do not enable typescript-eslint's
  // type-checked configs globally just to satisfy this block.
  {
    files: ['src/**/*.ts'],
    ignores: [
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/*.type-test.ts',
      'src/tests/**',
      'src/benchmarks/**',
    ],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: rootDir,
      },
    },
    plugins: sonarjs.configs.recommended.plugins,
    settings: sonarjs.configs.recommended.settings,
    rules: sonarEnforcedRules,
  },
  // Disable rules that conflict with Prettier (must be last)
  prettierConfig,
];
