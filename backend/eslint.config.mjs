import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-plugin-prettier';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default [
  // Global ignores (replaces .eslintignore)
  {
    ignores: [
      'node_modules',
      'dist',
      'coverage',
      'migrations',
      'replace_logger.cjs',
      'src/tests/jest.setup.js',
    ],
  },

  // eslint:recommended
  js.configs.recommended,

  // @typescript-eslint/recommended (flat config)
  ...tsPlugin.configs['flat/recommended'],

  // Custom rules and parser configuration (TypeScript files only)
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        tsconfigRootDir: __dirname,
        project: './tsconfig.json',
      },
    },
    plugins: {
      prettier,
    },
    rules: {
      // Prettier integration
      'prettier/prettier': 'error',
      'arrow-body-style': 'off',
      'prefer-arrow-callback': 'off',
      // TypeScript custom rules
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-constant-condition': 'off',
    },
  },

  // Override: operations scripts
  //
  // These are Node CLI entry points run with `node scripts/<name>.mjs`, not modules the
  // server imports, so they print to stdout and read process.env. `js.configs.recommended`
  // has no Node globals, which is why they are declared here rather than by ignoring the
  // directory: a script that runs against a deployed database is worth linting.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },

  // Override: test files
  {
    files: ['**/*.test.ts', '**/*.spec.ts', 'src/tests/**/*.ts', 'src/**/__tests__/**/*.ts'],
    rules: {
      'no-useless-catch': 'off',
      // Prettier formats computed property access on new lines, which
      // conflicts with no-unexpected-multiline.
      'no-unexpected-multiline': 'off',
    },
  },

  // Override: demo utility files
  {
    files: ['src/utils/demo*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];
