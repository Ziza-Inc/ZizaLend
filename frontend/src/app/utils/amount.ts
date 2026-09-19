/**
 * Amount formatting and comparison.
 *
 * Stellar amounts are integers in stroops with seven decimal places, so a value the contracts
 * hold can exceed `Number.MAX_SAFE_INTEGER` — 9,007,199,254,740,991 stroops is about 900
 * million XLM, and a pool total or a lifetime-remitted figure reaches that far sooner than a
 * single loan does. Anything that goes through a JavaScript `number` on the way to the screen
 * silently drops the last digits, and two helpers that round differently produce a screen where
 * the total does not equal the sum of the rows above it.
 *
 * So there is one path here, and it never uses a `number` for an on-chain amount:
 *
 *   1. a value becomes an exact decimal string — from stroops via {@link stroopsToDecimalString},
 *      or from text via {@link normalizeDecimalInput} — and
 *   2. `Intl.NumberFormat` formats that string directly.
 *
 * Step 2 relies on `format()` accepting a decimal string, which it does in every engine the app
 * supports (ES2023, ICU 72+). That is what makes a locale-correct currency format possible
 * without a float round-trip: the digits reaching the formatter are the digits the contract
 * holds, and any rounding is the formatter's own and happens on the exact value.
 *
 * Aggregates are summed as `bigint` stroops ({@link sumAmounts}) and compared as `bigint`
 * ({@link compareAmounts}), so "the total equals the sum of its rows" is a property of the
 * arithmetic rather than of the rounding.
 */

export const STROOP_DECIMALS = 7;

/**
 * `bigint` constants, written as calls rather than literals.
 *
 * The frontend compiles with `target: ES2017`, where TypeScript rejects bigint *literals* (a
 * bare `10n`) even though the `bigint` type is available and every runtime the app targets
 * implements it. `toStroops` already worked around that with `BigInt(10)`; giving the
 * workaround one home keeps the arithmetic readable instead of scattering the same call through
 * it. Raise the target and these can become literals.
 */
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TEN = BigInt(10);

/** One unit in stroops, as a `bigint`: the scale a `number` cannot hold once amounts grow. */
export const STROOP_SCALE = TEN ** BigInt(STROOP_DECIMALS);

// Asset-specific decimal precision
export const ASSET_DECIMALS: Record<string, number> = {
  XLM: 7,
  USDC: 2,
  EURC: 2,
  PHP: 2,
};

export function getAssetDecimals(asset: string): number {
  return ASSET_DECIMALS[asset] ?? STROOP_DECIMALS;
}

export function sanitizeAmountInput(value: string): string {
  let sanitized = value.replace(/[^\d.]/g, "");
  const firstDotIndex = sanitized.indexOf(".");
  if (firstDotIndex !== -1) {
    sanitized =
      sanitized.slice(0, firstDotIndex + 1) + sanitized.slice(firstDotIndex + 1).replace(/\./g, "");
  }
  return sanitized;
}

export function countFractionDigits(value: string): number {
  const [, fraction = ""] = value.split(".");
  return fraction.length;
}

export function hasInvalidPrecision(value: string, decimals = STROOP_DECIMALS): boolean {
  return countFractionDigits(value) > decimals;
}

/**
 * Render stroops as an exact decimal string.
 *
 * The inverse of {@link toStroops}, and the only conversion this module performs on the way to
 * the screen: integer division by the scale, then the remainder padded to the asset's precision.
 * No `number` appears in it, so the twenty-second digit of a large total is the digit that was
 * there.
 */
export function stroopsToDecimalString(stroops: bigint, decimals = STROOP_DECIMALS): string {
  if (decimals < 0) throw new RangeError("decimals must not be negative");

  const negative = stroops < ZERO;
  const absolute = negative ? -stroops : stroops;

  if (decimals === 0) {
    return `${negative ? "-" : ""}${absolute.toString()}`;
  }

  const scale = TEN ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = absolute % scale;

  return `${negative ? "-" : ""}${whole.toString()}.${fraction.toString().padStart(decimals, "0")}`;
}

/**
 * Reduce a decimal amount written as text to a canonical exact string, or null if it is not one.
 *
 * Trailing zeros go, because `1.500` and `1.5` are the same amount and comparing them as strings
 * would say otherwise; a value that is all zeros loses its sign, so `-0` formats as `0`.
 */
export function normalizeDecimalInput(value: string): string | null {
  // Grouping separators are accepted on the way in — a pasted "1,234.5" is unambiguous — and
  // removed, because the formatter applies its own and would otherwise reject the string.
  const trimmed = value.trim().replace(/[,\s_]/g, "");

  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(trimmed)) return null;

  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [rawWhole = "", rawFraction = ""] = unsigned.split(".");

  const whole = (rawWhole === "" ? "0" : rawWhole).replace(/^0+(?=\d)/, "");
  const fraction = rawFraction.replace(/0+$/, "");

  const isZero = whole === "0" && fraction === "";
  const sign = negative && !isZero ? "-" : "";

  return fraction === "" ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

/**
 * The exact decimal string for any accepted amount representation.
 *
 * A `bigint` is whole units, a `number` is rendered with `toString()` (exact for any finite
 * double, and the caller has already lost whatever a float cost on its own), and a string is
 * normalised as text. Returns null when the value is not a finite decimal.
 */
function toDecimalString(value: string | number | bigint): string | null {
  if (typeof value === "bigint") return value.toString();

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return normalizeDecimalInput(value.toString());
  }

  return normalizeDecimalInput(value);
}

/** An amount expressed in whole units, converted to stroops without a float round-trip. */
export function unitsToStroops(
  value: string | number | bigint,
  decimals = STROOP_DECIMALS,
): bigint | null {
  const decimalString = toDecimalString(value);
  if (decimalString === null) return null;
  return toStroops(decimalString, decimals);
}

/** Options accepted by {@link formatAmount}. */
export interface FormatAmountOptions {
  /** BCP 47 locale, `en-US` by default. */
  locale?: string;
  /** ISO 4217 code. When set, the amount is rendered as currency in that unit. */
  currency?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  /** Default true. Ignored when `currency` is set, where the currency decides. */
  useGrouping?: boolean;
}

/**
 * Format an amount for display. The single entry point every surface should use.
 *
 * Values are in whole units and are kept exact: `formatAmount("123456789012345678901.25")`
 * prints every digit, where `Number()` would have printed `123456789012345680000`.
 * Any rounding happens inside `Intl.NumberFormat`, on the exact decimal string.
 */
export function formatAmount(
  value: string | number | bigint,
  options: FormatAmountOptions = {},
): string {
  const decimalString = toDecimalString(value);
  if (decimalString === null) return "";

  const {
    locale = "en-US",
    currency,
    minimumFractionDigits,
    maximumFractionDigits,
    useGrouping = true,
  } = options;

  const formatOptions: Intl.NumberFormatOptions = currency
    ? { style: "currency", currency, minimumFractionDigits, maximumFractionDigits }
    : {
        minimumFractionDigits,
        // Defaulting to the stroop precision rather than leaving it to `Intl`, whose default of
        // three would round `0.0000001` to `0` — a real amount, hidden by a default nobody chose.
        maximumFractionDigits: maximumFractionDigits ?? STROOP_DECIMALS,
        useGrouping,
      };

  return formatDecimalString(decimalString, locale, formatOptions);
}

/**
 * Format an amount of an asset using that asset's precision.
 *
 * The asset decides how many decimal places are *meaningful* — two for USDC, seven for XLM —
 * so a USDC total is not printed with stroop-level noise. Exact regardless: the trimming
 * happens on the decimal string, before the formatter sees it.
 */
export function formatAssetAmount(
  value: string | number | bigint,
  asset = "XLM",
  options: Omit<FormatAmountOptions, "maximumFractionDigits"> = {},
): string {
  return formatAmount(value, {
    maximumFractionDigits: getAssetDecimals(asset),
    minimumFractionDigits: 2,
    ...options,
  });
}

/**
 * Format an amount as US dollars.
 *
 * There were eleven copies of this across the app, all rendering `en-US`/`USD` and one of them
 * with a different minimum fraction count — which is how two screens showing the same figure
 * come to disagree. This is the one.
 */
export function formatCurrency(
  value: string | number | bigint,
  options: Omit<FormatAmountOptions, "currency"> = {},
): string {
  return formatAmount(value, { minimumFractionDigits: 2, currency: "USD", ...options });
}

/** Format stroops for display, converting exactly. */
export function formatStroops(
  stroops: bigint,
  options: FormatAmountOptions & { decimals?: number } = {},
): string {
  const { decimals = STROOP_DECIMALS, ...formatOptions } = options;
  return formatAmount(stroopsToDecimalString(stroops, decimals), formatOptions);
}

/**
 * Sum amounts exactly, in stroops.
 *
 * The property this exists for: `sumAmounts(rows)` formatted equals the total the screen shows,
 * at any magnitude, because both are the same `bigint`. Values that are not finite decimals are
 * skipped rather than counted as zero, so a malformed row cannot silently shrink a total.
 */
export function sumAmounts(
  values: readonly (string | number | bigint)[],
  decimals = STROOP_DECIMALS,
): bigint {
  let total = ZERO;

  for (const value of values) {
    const stroops = unitsToStroops(value, decimals);
    if (stroops !== null) total += stroops;
  }

  return total;
}

/** Compare two amounts exactly: -1, 0 or 1. Unparseable values sort last and equal each other. */
export function compareAmounts(
  left: string | number | bigint,
  right: string | number | bigint,
  decimals = STROOP_DECIMALS,
): number {
  const leftStroops = unitsToStroops(left, decimals);
  const rightStroops = unitsToStroops(right, decimals);

  if (leftStroops === null && rightStroops === null) return 0;
  if (leftStroops === null) return 1;
  if (rightStroops === null) return -1;

  if (leftStroops < rightStroops) return -1;
  if (leftStroops > rightStroops) return 1;
  return 0;
}

/** Whether an amount is strictly greater than zero, decided on the exact digits. */
export function isPositiveAmount(value: string | number | bigint): boolean {
  const stroops = unitsToStroops(value);
  return stroops !== null && stroops > ZERO;
}

/**
 * Round an exact decimal string to a fixed number of decimal places, half-up.
 *
 * Used to fill an amount input on blur. `Number.prototype.toFixed` did this before, on a value
 * that had already been through `parseFloat`, which is the same lossy conversion in a different
 * place — a long input silently became a different number as the field lost focus.
 */
export function roundDecimalString(value: string, decimals: number): string | null {
  const normalized = normalizeDecimalInput(value);
  if (normalized === null) return null;

  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = "0", fraction = ""] = unsigned.split(".");

  if (decimals <= 0) {
    const rounded = fraction.charCodeAt(0) - 48 >= 5 ? (BigInt(whole) + ONE).toString() : whole;
    return `${negative && rounded !== "0" ? "-" : ""}${rounded}`;
  }

  if (fraction.length <= decimals) {
    return `${negative ? "-" : ""}${whole}.${fraction.padEnd(decimals, "0")}`;
  }

  const kept = fraction.slice(0, decimals);
  const nextDigit = fraction.charCodeAt(decimals) - 48;

  if (nextDigit < 5) {
    return `${negative ? "-" : ""}${whole}.${kept}`;
  }

  const carried = (BigInt(kept) + ONE).toString();

  if (carried.length > decimals) {
    // Every kept digit was a nine: the carry moves into the integer part.
    return `${negative ? "-" : ""}${(BigInt(whole) + ONE).toString()}.${carried.slice(1)}`;
  }

  return `${negative ? "-" : ""}${whole}.${carried.padStart(decimals, "0")}`;
}

/**
 * Format a decimal string with `Intl.NumberFormat`, passing the digits through untouched.
 *
 * The cast is the point of the module: the runtime accepts a decimal string here — ES2023's
 * `Intl.NumberFormat` formats strings exactly rather than coercing them to a double — but
 * TypeScript's DOM/ES lib for this project still declares `format(value: number | bigint)`.
 * Narrowed to the one method this module calls, so the cast cannot hide anything else.
 */
function formatDecimalString(
  value: string,
  locale: string,
  options: Intl.NumberFormatOptions,
): string {
  const formatter = new Intl.NumberFormat(locale, options) as unknown as {
    format(value: string): string;
  };
  return formatter.format(value);
}

/**
 * Parse an amount into a `number`.
 *
 * Retained for the amount *input* path, where the value is a user's keystrokes bounded by the
 * asset's precision and the result is handed to a transaction builder that still takes a
 * number. It is not a formatting or aggregation function — those are exact, above — and an
 * on-chain amount should not be routed through it.
 */
export function parseAmount(value: string): number {
  return Number.parseFloat(value);
}

export function formatTypedAmount(
  value: string,
  decimals = STROOP_DECIMALS,
  locale = "en-US",
): string | null {
  const normalized = normalizeDecimalInput(value);
  if (normalized === null) return null;

  return formatAmount(normalized, { locale, maximumFractionDigits: decimals });
}

export function toStroops(value: string, decimals = STROOP_DECIMALS): bigint | null {
  const normalized = normalizeDecimalInput(value);
  if (!normalized || hasInvalidPrecision(normalized, decimals)) {
    return null;
  }

  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const normalizedFraction = fraction.padEnd(decimals, "0");

  try {
    // Scale by the requested precision, not the fixed 7-decimal stroop scale,
    // so non-XLM assets (e.g. 2-decimal USDC) convert correctly.
    const scale = TEN ** BigInt(decimals);
    const stroops = BigInt(whole || "0") * scale + BigInt(normalizedFraction || "0");
    return negative ? -stroops : stroops;
  } catch {
    return null;
  }
}

export function buildAmountHelperText(
  value: string,
  asset = "XLM",
  decimals = STROOP_DECIMALS,
  locale = "en-US",
): string | null {
  const formatted = formatTypedAmount(value, decimals, locale);
  if (!formatted) {
    return null;
  }

  const stroops = toStroops(value, decimals);
  if (stroops === null) {
    return `Formatted: ${formatted} ${asset}`;
  }

  return `Formatted: ${formatted} ${asset} • Stroops: ${stroops.toString()}`;
}

export function getPrecisionError(value: string, asset = "XLM", decimals?: number): string | null {
  const assetDecimals = decimals ?? getAssetDecimals(asset);
  if (!hasInvalidPrecision(value, assetDecimals)) {
    return null;
  }

  return `${asset} supports at most ${assetDecimals} decimal places.`;
}

export function formatAmountOnBlur(value: string, asset = "XLM"): string {
  const decimals = getAssetDecimals(asset);
  return roundDecimalString(value, decimals) ?? "";
}
