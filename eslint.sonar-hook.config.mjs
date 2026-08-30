/**
 * Low-latency SonarJS-only ESLint configuration for coding-agent post-edit
 * hooks. It deliberately excludes type-aware rules; the normal lint and
 * pre-push gates retain the complete locally implemented profile.
 *
 * Ignores match the main ESLint config so the hook cannot fail on tests,
 * scripts, website sources, or other paths `npm run lint` never analyzes.
 */

import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { sonarRules } from './scripts/sonar-rules/load.mjs';

export default [
  {
    ignores: [
      '**/coverage/**',
      '**/dist/**',
      'node_modules/**',
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/*.type-test.ts',
      '**/benchmarks/**',
      'src/tests/**',
      'scripts/**',
      'website/**',
      'docs/plans/**',
      'tmp/**',
    ],
  },
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node },
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: sonarjs.configs.recommended.plugins,
    settings: sonarjs.configs.recommended.settings,
    rules: Object.fromEntries(sonarRules.fast.map(rule => [`sonarjs/${rule}`, 'error'])),
  },
];
