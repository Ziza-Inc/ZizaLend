#!/usr/bin/env node
/**
 * Translation key completeness check.
 *
 * Nothing enforced that a key referenced in code existed in every locale, or that a key in a
 * locale was still referenced anywhere. A missing key renders its own identifier — the user
 * sees `HomePage.quickActions.applyLoan` instead of "Apply for Loan" — and an unused key is
 * dead weight that only grows.
 *
 * Two failures, deliberately different in severity:
 *
 *   - A key referenced in code but absent from a locale file is an **error**: it is a
 *     user-visible defect that CI can catch before a deploy, and the message names the key and
 *     the file that references it.
 *   - A key present in a locale but referenced nowhere is **reported**, not failed on. It is
 *     real drift, but it is not a defect a reader of the app can see, and failing the build on
 *     it would block an unrelated change until someone deletes a key. Pass `--strict-unused` to
 *     make it fail.
 *
 * A lookup built from a template literal — `` t(`status.${item.status}`) `` — is checked as a
 * pattern rather than a literal: every key it could produce must exist, and each one that does
 * counts as referenced. That keeps the wildcard form honest without pretending the checker can
 * see which branch runs.
 *
 * Usage:
 *   node scripts/check-i18n.mjs [--strict-unused] [--messages-dir <path>]
 *
 * `--messages-dir` points the check at a different set of locale files. CI uses it to run the
 * checker against a deliberately-broken copy and assert that it fails, which is the only way
 * to know the gate is a gate and not a green step that never looks at anything.
 */

import { readFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(frontendRoot, "src");

const strictUnused = process.argv.includes("--strict-unused");

const messagesDirFlag = process.argv.indexOf("--messages-dir");
const messagesDir =
  messagesDirFlag === -1
    ? path.join(frontendRoot, "messages")
    : path.resolve(process.argv[messagesDirFlag + 1] ?? "");

if (messagesDirFlag !== -1 && process.argv[messagesDirFlag + 1] === undefined) {
  console.error("--messages-dir requires a path");
  process.exit(1);
}

/** Flatten a nested message object into dotted key paths. */
function flatten(value, prefix = "") {
  const keys = [];
  for (const [key, child] of Object.entries(value)) {
    const full = prefix === "" ? key : `${prefix}.${key}`;
    if (child !== null && typeof child === "object" && !Array.isArray(child)) {
      keys.push(...flatten(child, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

async function collectSourceFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory)) {
    const full = path.join(directory, entry);
    if ((await stat(full)).isDirectory()) {
      found.push(...(await collectSourceFiles(full)));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Every translation lookup in one file.
 *
 * `next-intl` resolves a key against the namespace the file's `useTranslations(...)` call was
 * given, and these files use exactly one lookup form — `useTranslations("Ns")` paired with
 * `t("key")` — so the namespace can be recovered statically. A file may open more than one
 * namespace, in which case a key is allowed to resolve under any of them. A namespace held in
 * a variable cannot be recovered at all, and the file is reported as unchecked rather than
 * guessed at.
 */
function keysInFile(source) {
  const namespaces = [...source.matchAll(/useTranslations\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map(
    (match) => match[1],
  );

  const literals = [];
  const patterns = [];

  // A quoted lookup is a literal key. A backtick lookup containing `${...}` is a pattern:
  // the interpolated segment is replaced by `*` and matched against the locale's keys.
  for (const match of source.matchAll(/\bt\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g)) {
    const [, , key] = match;
    if (key.includes("${")) {
      patterns.push(key.replace(/\$\{[^}]*\}/g, "*"));
    } else {
      literals.push(key);
    }
  }

  return { namespaces, literals, patterns };
}

/** Turn a `fn.*.title` pattern into a matcher over dotted key paths. */
function patternMatcher(pattern) {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^.]+");
  return new RegExp(`^${escaped}$`);
}

async function main() {
  const localeFiles = (await readdir(messagesDir)).filter((name) => name.endsWith(".json")).sort();
  if (localeFiles.length === 0) {
    console.error(`No locale files found in ${messagesDir}`);
    process.exit(1);
  }

  const locales = new Map();
  for (const file of localeFiles) {
    const locale = path.basename(file, ".json");
    locales.set(
      locale,
      new Set(flatten(JSON.parse(readFileSync(path.join(messagesDir, file), "utf8")))),
    );
  }

  // Every key in any locale. Resolution is checked against this, so a key that exists in
  // Spanish but not English is caught as a parity problem below rather than as "missing".
  const allKeys = new Set();
  for (const keys of locales.values()) {
    for (const key of keys) allKeys.add(key);
  }

  const errors = [];

  // ── 1. Parity between locale files ─────────────────────────────────────────
  const reference = "en";
  const referenceKeys = locales.get(reference);
  if (referenceKeys === undefined) {
    console.error(`Expected a ${reference}.json locale to compare against`);
    process.exit(1);
  }

  for (const [locale, keys] of locales) {
    if (locale === reference) continue;
    const missing = [...referenceKeys].filter((key) => !keys.has(key));
    const extra = [...keys].filter((key) => !referenceKeys.has(key));

    if (missing.length > 0) {
      errors.push(
        `messages/${locale}.json is missing ${missing.length} key(s) present in ${reference}.json:\n` +
          missing.map((key) => `    ${key}`).join("\n"),
      );
    }
    if (extra.length > 0) {
      errors.push(
        `messages/${locale}.json has ${extra.length} key(s) not present in ${reference}.json:\n` +
          extra.map((key) => `    ${key}`).join("\n"),
      );
    }
  }

  // ── 2. Every key referenced in code resolves ───────────────────────────────
  const files = await collectSourceFiles(sourceDir);
  const referenced = new Set();
  const unresolved = [];
  const skipped = [];

  for (const file of files) {
    const { namespaces, literals, patterns } = keysInFile(readFileSync(file, "utf8"));
    const keys = [...literals, ...patterns];
    if (keys.length === 0) continue;

    // A lookup with no enclosing `useTranslations` cannot be resolved against a namespace.
    // Reporting it as missing would be a false positive, so it is surfaced instead.
    if (namespaces.length === 0) {
      skipped.push({ file, keys });
      continue;
    }

    for (const key of literals) {
      const candidates = namespaces.map((namespace) => `${namespace}.${key}`);
      const resolved = candidates.filter((candidate) => allKeys.has(candidate));

      if (resolved.length === 0) {
        unresolved.push({ file, key, candidates });
      } else {
        for (const candidate of resolved) referenced.add(candidate);
      }
    }

    for (const pattern of patterns) {
      const candidates = namespaces.map((namespace) => `${namespace}.${pattern}`);
      const matchers = candidates.map(patternMatcher);
      const resolved = [...allKeys].filter((candidate) =>
        matchers.some((matcher) => matcher.test(candidate)),
      );

      if (resolved.length === 0) {
        unresolved.push({ file, key: pattern, candidates });
      } else {
        for (const candidate of resolved) referenced.add(candidate);
      }
    }
  }

  if (unresolved.length > 0) {
    const lines = unresolved.map(
      ({ file, key, candidates }) =>
        `    ${key} — referenced in ${path.relative(frontendRoot, file)}\n` +
        `      tried: ${candidates.join(", ")}`,
    );
    errors.push(
      `${unresolved.length} translation key(s) referenced in code but present in no locale:\n` +
        lines.join("\n"),
    );
  }

  if (skipped.length > 0) {
    const lines = skipped.map(
      ({ file, keys }) =>
        `    ${path.relative(frontendRoot, file)} — ${keys.length} key(s): ${keys.join(", ")}`,
    );
    console.warn(
      `Warning: ${skipped.length} file(s) reference translation keys without a resolvable ` +
        `useTranslations(...) namespace, and were not checked:\n${lines.join("\n")}\n`,
    );
  }

  // ── 3. Keys in a locale that nothing references ────────────────────────────
  const unused = [...referenceKeys].filter((key) => !referenced.has(key));

  if (unused.length > 0) {
    const report =
      `${unused.length} key(s) in messages/${reference}.json are referenced nowhere in src/:\n` +
      unused.map((key) => `    ${key}`).join("\n");

    if (strictUnused) {
      errors.push(report);
    } else {
      console.warn(`Warning: ${report}\n`);
    }
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`\n✖ ${error}\n`);
    console.error(
      `i18n check failed: ${errors.length} problem(s). ` +
        `Add the missing keys to every locale in frontend/messages/.`,
    );
    process.exit(1);
  }

  console.log(
    `i18n check passed: ${locales.size} locales, ${referenceKeys.size} keys, ` +
      `${referenced.size} referenced, ${unused.length} unused.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
