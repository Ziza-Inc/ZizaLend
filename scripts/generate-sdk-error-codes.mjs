#!/usr/bin/env node
/**
 * Generate the SDK's error-code union from the backend registry, and check that it is current.
 *
 * Why generated rather than written
 * ---------------------------------
 * `ApiError.errorCode` used to be `string | undefined`. The backend publishes a closed set of
 * codes in `backend/src/errors/errorCodes.ts`, so an optional string threw that closure away:
 * a consumer could not switch exhaustively, a comparison against a renamed code kept
 * compiling and silently stopped matching, and `undefined` — which is exactly the case a
 * consumer needs to separate, because it means the failure never reached the error handler —
 * was indistinguishable from a field nobody populated.
 *
 * Restating the 35 codes inside the SDK would reproduce the same drift one level down, so the
 * list is read out of the registry here. The SDK therefore cannot disagree with the backend
 * about what a code is called: the only way to change the union is to change the registry and
 * regenerate.
 *
 * Why the generated file is committed
 * -----------------------------------
 * `packages/types/src/generated.ts` is gitignored because it is rebuilt from the OpenAPI
 * document on every CI run. This one is committed because the SDK is consumed as source by the
 * frontend and must typecheck without a generation step, and because a diff in a generated
 * file is the reviewable record that the wire contract changed.
 *
 * Usage
 * -----
 *   node scripts/generate-sdk-error-codes.mjs           # write the generated file
 *   node scripts/generate-sdk-error-codes.mjs --check    # fail if it is out of date
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const REGISTRY = path.join(ROOT, "backend", "src", "errors", "errorCodes.ts");
const OUT = path.join(
  ROOT,
  "packages",
  "sdk",
  "src",
  "errorCodes.generated.ts",
);

/** The extra member that stands for "this failure did not come from the error handler". */
const UNKNOWN_MEMBER = "UNKNOWN_API_ERROR";

const check = process.argv.includes("--check");

/**
 * Read the variants of `export enum ErrorCode`.
 *
 * The registry is written as `NAME = 'NAME'` one per line. Both the member name and the string
 * value are captured so a mismatch between them — which would make the union describe something
 * other than what the wire carries — is caught rather than silently encoded.
 */
function parseRegistry(source, file) {
  const enumBody = /export enum ErrorCode\s*\{([\s\S]*?)\n\}/.exec(source);
  if (!enumBody) {
    throw new Error(`${file}: no \`export enum ErrorCode\` block found`);
  }

  const entries = [];
  const pattern = /^\s{2}([A-Z][A-Z0-9_]*)\s*=\s*'([^']*)'/gm;
  let match;
  while ((match = pattern.exec(enumBody[1])) !== null) {
    entries.push({ member: match[1], value: match[2] });
  }

  if (entries.length === 0) {
    throw new Error(`${file}: the ErrorCode enum declares no string members`);
  }

  return entries;
}

function render(entries) {
  const values = entries.map((entry) => entry.value);
  const misnamed = entries.filter((entry) => entry.member !== entry.value);
  const duplicates = values.filter(
    (value, index) => values.indexOf(value) !== index,
  );

  const lines = [
    "/**",
    " * GENERATED FILE — do not edit by hand.",
    " *",
    " * Produced by `scripts/generate-sdk-error-codes.mjs` from the backend registry at",
    " * `backend/src/errors/errorCodes.ts`. Run `npm run generate:error-codes` from the",
    " * repository root after changing a code; CI fails when this file is out of date.",
    " */",
    "",
    "/** Every error code the API can return, in registry order. */",
    "export const API_ERROR_CODES = [",
    ...values.map((value) => `  '${value}',`),
    "] as const;",
    "",
    "/** A code the API actually returns. */",
    "export type KnownApiErrorCode = (typeof API_ERROR_CODES)[number];",
    "",
    "/**",
    " * The code reported for a failure that did not come through the backend error handler —",
    " * a transport failure, an unparseable body, or a response from something other than the",
    " * API. It is a named member rather than `undefined` so that a `switch` on the code has to",
    ' * handle it, and so that "the server did not say" is distinguishable from "the client',
    ' * forgot to read it".',
    " */",
    `export const ${UNKNOWN_MEMBER} = '${UNKNOWN_MEMBER}' as const;`,
    "",
    "/**",
    " * The type of `ApiError.errorCode`. Switching on it with no `default` is exhaustive over",
    " * every code the backend can emit plus the unknown case.",
    " */",
    `export type ApiErrorCode = KnownApiErrorCode | typeof ${UNKNOWN_MEMBER};`,
    "",
    "/**",
    " * Narrow to a code the backend declares.",
    " *",
    " * This is what lets a consumer separate the known cases from the unknown one at a single",
    " * point instead of comparing against a list that can drift.",
    " */",
    "export function isKnownApiErrorCode(value: unknown): value is KnownApiErrorCode {",
    "  return (",
    "    typeof value === 'string' &&",
    "    (API_ERROR_CODES as readonly string[]).includes(value)",
    "  );",
    "}",
    "",
    "/**",
    " * Normalise a raw `errorCode` from a response body into the union.",
    " *",
    " * Anything that is not a code the registry declares becomes the unknown member, so a",
    " * consumer never has to handle an arbitrary string from the wire.",
    " */",
    "export function toApiErrorCode(value: unknown): ApiErrorCode {",
    "  return isKnownApiErrorCode(value) ? value : UNKNOWN_API_CODE_PLACEHOLDER;",
    "}",
    "",
  ];

  // The placeholder above keeps the emitted function readable; substitute the real constant.
  return {
    contents: lines
      .join("\n")
      .replace("UNKNOWN_API_CODE_PLACEHOLDER", UNKNOWN_MEMBER),
    misnamed,
    duplicates,
  };
}

async function main() {
  const source = await fs.readFile(REGISTRY, "utf8");
  const entries = parseRegistry(source, REGISTRY);
  const { contents, misnamed, duplicates } = render(entries);

  if (misnamed.length > 0) {
    throw new Error(
      `${REGISTRY}: these members do not equal their own value, so the union would ` +
        `describe something other than the wire format: ${misnamed
          .map((entry) => `${entry.member} = '${entry.value}'`)
          .join(", ")}`,
    );
  }
  if (duplicates.length > 0) {
    throw new Error(
      `${REGISTRY}: duplicate code value(s): ${[...new Set(duplicates)].join(", ")}`,
    );
  }
  if (entries.some((entry) => entry.value === UNKNOWN_MEMBER)) {
    throw new Error(
      `${REGISTRY}: ${UNKNOWN_MEMBER} is reserved for the SDK and must not be a backend code`,
    );
  }

  let existing = null;
  try {
    existing = await fs.readFile(OUT, "utf8");
  } catch {
    existing = null;
  }

  if (check) {
    if (existing === contents) {
      console.log(
        `SDK error codes are current (${entries.length} codes + ${UNKNOWN_MEMBER}).`,
      );
      return;
    }
    console.error(
      `packages/sdk/src/errorCodes.generated.ts is out of date with ${path.relative(
        ROOT,
        REGISTRY,
      )}.\n` +
        "Run `node scripts/generate-sdk-error-codes.mjs` and commit the result, so the SDK and\n" +
        "the API cannot disagree about what a code is called.",
    );
    process.exit(1);
  }

  if (existing === contents) {
    console.log(
      `Unchanged: ${path.relative(ROOT, OUT)} (${entries.length} codes).`,
    );
    return;
  }

  await fs.writeFile(OUT, contents, "utf8");
  console.log(
    `Wrote ${path.relative(ROOT, OUT)}: ${entries.length} codes plus ${UNKNOWN_MEMBER}.`,
  );
}

await main();
