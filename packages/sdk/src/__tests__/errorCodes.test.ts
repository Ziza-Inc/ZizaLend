import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  API_ERROR_CODES,
  UNKNOWN_API_ERROR,
  isKnownApiErrorCode,
  toApiErrorCode,
  type ApiErrorCode,
} from "../errorCodes.generated.js";
import { ApiError } from "../client.js";

/**
 * The registry the union is generated from.
 *
 * Read from source rather than imported: the SDK does not depend on the backend, and the
 * point of this file is to compare the two artefacts, so importing one into the other would
 * make the comparison vacuous.
 */
function findRegistry(): string {
  let directory = process.cwd();

  for (;;) {
    const candidate = join(
      directory,
      "backend",
      "src",
      "errors",
      "errorCodes.ts",
    );
    if (existsSync(candidate)) return candidate;

    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(
        "could not find backend/src/errors/errorCodes.ts above " +
          process.cwd(),
      );
    }
    directory = parent;
  }
}

const registrySource = readFileSync(findRegistry(), "utf8");

function registryCodes(): string[] {
  const body = /export enum ErrorCode\s*\{([\s\S]*?)\n\}/.exec(
    registrySource,
  )?.[1];
  if (body === undefined) {
    throw new Error(
      "could not find `export enum ErrorCode` in the backend registry",
    );
  }
  return [...body.matchAll(/^\s{2}([A-Z][A-Z0-9_]*)\s*=\s*'([^']*)'/gm)].map(
    (match) => String(match[2]),
  );
}

describe("generated error codes", () => {
  it("represents every code the backend registry declares", () => {
    const declared = registryCodes();
    expect(declared.length).toBeGreaterThan(0);

    const missing = declared.filter(
      (code) => !(API_ERROR_CODES as readonly string[]).includes(code),
    );
    expect(missing).toEqual([]);
    expect([...API_ERROR_CODES]).toEqual(declared);
  });

  it("declares nothing the registry does not", () => {
    const declared = new Set(registryCodes());
    const extra = (API_ERROR_CODES as readonly string[]).filter(
      (code) => !declared.has(code),
    );
    expect(extra).toEqual([]);
  });

  it("keeps the unknown member out of the wire codes", () => {
    // `UNKNOWN_API_ERROR` means "the server did not say". If the backend ever emitted it, the
    // client could no longer tell a named failure from an unnamed one.
    expect(registryCodes()).not.toContain(UNKNOWN_API_ERROR);
    expect(API_ERROR_CODES as readonly string[]).not.toContain(
      UNKNOWN_API_ERROR,
    );
  });

  describe("toApiErrorCode", () => {
    it("passes a known code through unchanged", () => {
      expect(toApiErrorCode("VALIDATION_ERROR")).toBe("VALIDATION_ERROR");
      expect(toApiErrorCode("NOT_FOUND")).toBe("NOT_FOUND");
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["an empty string", ""],
      ["an unregistered string", "TOO_MANY_REQUESTS"],
      ["a number", 429],
      ["an object", { code: "VALIDATION_ERROR" }],
    ])("maps %s to the unknown member", (_label, value) => {
      expect(toApiErrorCode(value)).toBe(UNKNOWN_API_ERROR);
    });
  });

  describe("isKnownApiErrorCode", () => {
    it("accepts a declared code and rejects everything else", () => {
      expect(isKnownApiErrorCode("INVALID_AMOUNT")).toBe(true);
      expect(isKnownApiErrorCode("NOT_A_REAL_CODE")).toBe(false);
      expect(isKnownApiErrorCode(UNKNOWN_API_ERROR)).toBe(false);
      expect(isKnownApiErrorCode(undefined)).toBe(false);
    });

    it("narrows the type rather than only returning a boolean", () => {
      const value: unknown = "INVALID_AMOUNT";
      if (isKnownApiErrorCode(value)) {
        // Would not compile if the guard did not narrow: `string` has no `toLowerCase`-only
        // guarantee that this is a member, and the array index below would be a type error.
        const index: number = (API_ERROR_CODES as readonly string[]).indexOf(
          value,
        );
        expect(index).toBeGreaterThanOrEqual(0);
      } else {
        throw new Error("expected a known code to narrow");
      }
    });
  });

  describe("ApiError.errorCode", () => {
    it("is populated even when the server named nothing", () => {
      const error = new ApiError("boom", 500);
      expect(error.errorCode).toBe(UNKNOWN_API_ERROR);
      expect(error.hasKnownErrorCode).toBe(false);
    });

    it("carries a declared code through the constructor", () => {
      const error = new ApiError("bad request", 400, "VALIDATION_ERROR");
      expect(error.errorCode).toBe("VALIDATION_ERROR");
      expect(error.hasKnownErrorCode).toBe(true);
      expect(error.isValidationError).toBe(true);
    });

    it("normalises a code the registry does not declare", () => {
      // A newer backend could return a code this SDK version has not been regenerated for.
      // That must arrive as the unknown member, not as a string that no `switch` can handle.
      const error = new ApiError("too many requests", 429, "REQUEST_THROTTLED");
      expect(error.errorCode).toBe(UNKNOWN_API_ERROR);
      expect(error.hasKnownErrorCode).toBe(false);
    });
  });

  describe("exhaustiveness", () => {
    /**
     * The property a consumer relies on: with every member handled and no `default`, adding a
     * member to the union makes this function fail to compile because the final branch would
     * no longer be `never`.
     *
     * Demonstrated on an illustrative union rather than the full generated one so that adding
     * a backend code does not break this test — the generated file being current is checked by
     * `node scripts/generate-sdk-error-codes.mjs --check`, not here.
     */
    type IllustrativeCode =
      "INVALID_AMOUNT" | "NOT_FOUND" | typeof UNKNOWN_API_ERROR;

    function describeCode(code: IllustrativeCode): string {
      switch (code) {
        case "INVALID_AMOUNT":
          return "a validation problem";
        case "NOT_FOUND":
          return "the resource is missing";
        case UNKNOWN_API_ERROR:
          return "the server did not say";
        default: {
          const unreachable: never = code;
          return unreachable;
        }
      }
    }

    it("switches over a code union with no fallthrough", () => {
      expect(describeCode("INVALID_AMOUNT")).toBe("a validation problem");
      expect(describeCode("NOT_FOUND")).toBe("the resource is missing");
      expect(describeCode(UNKNOWN_API_ERROR)).toBe("the server did not say");
    });

    it("lets a consumer accept the generated union without a cast", () => {
      const codes: ApiErrorCode[] = [...API_ERROR_CODES, UNKNOWN_API_ERROR];
      expect(codes).toHaveLength(API_ERROR_CODES.length + 1);
    });
  });
});
