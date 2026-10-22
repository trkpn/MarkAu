import js from '@eslint/js';
import globals from 'globals';

/**
 * Flat ESLint config.
 *
 * The project is a browser application without a framework, so the rules
 * focus on catching real mistakes (undefined variables, unused bindings,
 * accidental globals) rather than style — Prettier handles formatting.
 */
export default [
  {
    ignores: ['dist/**', 'node_modules/**', '.zcode/**']
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.serviceworker
      }
    },
    rules: {
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
      ],
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error'
    }
  },
  {
    files: ['**/*.test.js'],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  },
  {
    files: ['vite.config.js', 'vitest.config.js', 'eslint.config.js'],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  },
  {
    // The proxy runs on the server: the same code serves the dev server and
    // the Cloudflare function.
    files: ['server/**/*.js', 'functions/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.serviceworker
      }
    }
  }
];
