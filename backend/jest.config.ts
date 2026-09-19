import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/tests/jest.setup.js'],

  // Coverage is measured on every CI run (`npm run test:coverage`). What to measure is stated here
  // rather than left to the default, which counts every file the suite happened to import: a
  // controller nothing imports would then be invisible instead of reported as uncovered, and
  // invisibility is the failure this measurement exists to prevent.
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!src/tests/**',
    '!src/**/__tests__/**',
    // Typing-only modules: they emit no runtime code, so a line count for them is noise.
    '!src/types/**',
    '!src/**/*.d.ts',
    // The seed data tables are literals with no branches to exercise; counting them would lower
    // every percentage without saying anything about the code. The guard around them is measured.
    '!src/seed/data/**',
  ],
  coverageDirectory: 'coverage',
  // `json-summary` is what `scripts/check-coverage-thresholds.mjs` reads; `lcov` and `text` are for
  // a human looking at the same run.
  coverageReporters: ['text', 'json-summary', 'lcov'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          module: 'esnext',
          moduleResolution: 'bundler',
        },
      },
    ],
  },
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
  moduleNameMapper: {
    // Correct pattern - strips .js so Jest finds the .ts source file
    '^(./|../)(.*)\\.js$': '$1$2',
  },
};

export default config;
