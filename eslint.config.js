import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/client/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.ts'],
    ignores: ['apps/client/**'],
    languageOptions: { globals: globals.node },
  },
  {
    // Playwright callbacks run inside the browser page.
    files: ['tools/e2e-*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
