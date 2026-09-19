/* eslint-disable @typescript-eslint/no-require-imports */
const nextJest = require("next/jest");

const createJestConfig = nextJest({
  dir: "./",
});

const customJestConfig = {
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testEnvironment: "jest-environment-jsdom",

  // Coverage is measured on every CI run (`npm run test:coverage`). What is measured is stated
  // rather than inferred: the default is "the files the suite imported", which would report a
  // component with no test as absent instead of as uncovered — the one thing this is for.
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.test.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/**/__mocks__/**",
    // Type declarations and the generated i18n catalogue: no statements to execute.
    "!src/types/**",
  ],
  coverageDirectory: "coverage",
  // `json-summary` is what the CI summary step reads; `text` and `lcov` are for a human looking at
  // the same run.
  coverageReporters: ["text", "json-summary", "lcov"],

  // The floors are not here: they live in `coverage-thresholds.json` and are enforced by
  // `scripts/check-coverage-thresholds.mjs`, which is what `npm run test:coverage` runs after Jest.
  // One file holds them because the same file is what the ratchet check compares against the base
  // branch, and two sources would disagree the first time someone updated one of them.
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testPathIgnorePatterns: ["<rootDir>/e2e/", "<rootDir>/node_modules/"],
  // next.js's `next/jest` wrapper expands ignore patterns to include its own
  // packages, but next-intl and the @formatjs stack ship ESM and need to be
  // transformed under Jest. Negate the relevant vendor roots so Babel/ts-jest
  // can parse them.
  transformIgnorePatterns: [
    "/node_modules/(?!(next-intl|@formatjs|intl-messageformat|intl-messageformat-format-cache|@internationalized)/)",
  ],
};

module.exports = createJestConfig(customJestConfig);
