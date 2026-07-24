import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      'packages/database/src/generated/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  eslint.configs.recommended,
  {
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ['**/*.config.{js,cjs,mjs,ts}', '**/vite.config.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  prettier,
);
