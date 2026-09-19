import {
  compareAmounts,
  formatAmount,
  formatAmountOnBlur,
  formatCurrency,
  formatStroops,
  formatTypedAmount,
  getAssetDecimals,
  getPrecisionError,
  hasInvalidPrecision,
  isPositiveAmount,
  normalizeDecimalInput,
  roundDecimalString,
  sanitizeAmountInput,
  stroopsToDecimalString,
  sumAmounts,
  toStroops,
  unitsToStroops,
} from "./amount";

/**
 * `bigint` values, written as calls. The project compiles with `target: ES2017`, where TypeScript
 * rejects bigint literals even though the type is available and every runtime the
 * app targets implements it.
 */
const big = (value: string): bigint => BigInt(value);

describe("amount utils", () => {
  describe("getAssetDecimals", () => {
    it("returns known asset decimals", () => {
      expect(getAssetDecimals("XLM")).toBe(7);
      expect(getAssetDecimals("USDC")).toBe(2);
      expect(getAssetDecimals("EURC")).toBe(2);
      expect(getAssetDecimals("PHP")).toBe(2);
    });

    it("falls back for unknown assets", () => {
      expect(getAssetDecimals("UNKNOWN")).toBe(7);
    });
  });

  describe("toStroops", () => {
    it("converts whole and fractional amounts", () => {
      expect(toStroops("1", 7)?.toString()).toBe("10000000");
      expect(toStroops("1.5", 7)?.toString()).toBe("15000000");
      expect(toStroops("0.01", 2)?.toString()).toBe("1");
      expect(toStroops("12.34", 2)?.toString()).toBe("1234");
    });

    it("returns null when precision exceeds decimals", () => {
      expect(toStroops("1.234", 2)).toBeNull();
      expect(toStroops("0.00000001", 7)).toBeNull();
    });
  });

  describe("hasInvalidPrecision / getPrecisionError", () => {
    it("treats values at the limit as valid", () => {
      expect(hasInvalidPrecision("1.12", 2)).toBe(false);
      expect(getPrecisionError("1.12", "USDC")).toBeNull();
    });

    it("flags values over the limit and returns error text", () => {
      expect(hasInvalidPrecision("1.123", 2)).toBe(true);
      expect(getPrecisionError("1.123", "USDC")).toBe("USDC supports at most 2 decimal places.");
    });
  });

  describe("sanitizeAmountInput", () => {
    it("strips non-numeric and collapses multiple dots", () => {
      expect(sanitizeAmountInput("$1,234.56")).toBe("1234.56");
      expect(sanitizeAmountInput("1.2.3")).toBe("1.23");
      expect(sanitizeAmountInput("..1..2..3..")).toBe(".123");
    });
  });

  // ─── Exact conversion ───────────────────────────────────────────────────────
  //
  // The property under test throughout this block is that no value passes through a JavaScript
  // `number`. A stroop amount leaves `Number.MAX_SAFE_INTEGER` at about 900 million XLM, which a
  // pool total or a lifetime-remitted figure reaches without any single loan doing so.

  describe("stroopsToDecimalString", () => {
    it("renders whole and fractional amounts", () => {
      expect(stroopsToDecimalString(big("10000000"), 7)).toBe("1.0000000");
      expect(stroopsToDecimalString(big("15000000"), 7)).toBe("1.5000000");
      expect(stroopsToDecimalString(big("1"), 7)).toBe("0.0000001");
      expect(stroopsToDecimalString(big("1234"), 2)).toBe("12.34");
      expect(stroopsToDecimalString(big("5"), 0)).toBe("5");
    });

    it("round-trips through toStroops", () => {
      const stroops = big("123456789012345678901");
      const decimal = stroopsToDecimalString(stroops, 7);
      expect(toStroops(decimal, 7)).toBe(stroops);
    });

    it("keeps every digit of a value past Number.MAX_SAFE_INTEGER", () => {
      // 2^53 + 1, the smallest integer a double cannot represent exactly.
      expect(stroopsToDecimalString(big("9007199254740993"), 0)).toBe("9007199254740993");
    });

    it("is the inverse of the sign it was given", () => {
      expect(stroopsToDecimalString(-big("15000000"), 7)).toBe("-1.5000000");
    });
  });

  describe("normalizeDecimalInput", () => {
    it("canonicalises trailing zeros and leading zeros", () => {
      expect(normalizeDecimalInput("1.500")).toBe("1.5");
      expect(normalizeDecimalInput("000123.4")).toBe("123.4");
      expect(normalizeDecimalInput(".5")).toBe("0.5");
      expect(normalizeDecimalInput("7.")).toBe("7");
    });

    it("accepts a pasted value with grouping separators", () => {
      expect(normalizeDecimalInput("1,234.56")).toBe("1234.56");
    });

    it("drops the sign from a negative zero", () => {
      expect(normalizeDecimalInput("-0.000")).toBe("0");
      expect(normalizeDecimalInput("-0")).toBe("0");
    });

    it("rejects text that is not a decimal amount", () => {
      expect(normalizeDecimalInput("abc")).toBeNull();
      expect(normalizeDecimalInput("1.2.3")).toBeNull();
      expect(normalizeDecimalInput("")).toBeNull();
      expect(normalizeDecimalInput("1e5")).toBeNull();
    });
  });

  describe("formatAmount", () => {
    it("groups and formats an ordinary value", () => {
      expect(formatAmount("1234.5")).toBe("1,234.5");
      expect(formatAmount(1234)).toBe("1,234");
    });

    it("prints every digit of a value a number cannot hold", () => {
      // `Number("9007199254740993").toString()` is "9007199254740992": the last digit is gone
      // before any formatter sees it, which is why the formatter is given the text.
      expect(Number("9007199254740993").toString()).toBe("9007199254740992");
      expect(formatAmount("9007199254740993")).toBe("9,007,199,254,740,993");

      const huge = "123456789012345678901234.5678";
      expect(formatAmount(huge)).toBe("123,456,789,012,345,678,901,234.5678");
    });

    it("shows stroop-precision digits by default rather than rounding them away", () => {
      // `Intl`'s own default of three fraction digits would print this as "0", hiding a real
      // amount behind a default nobody chose.
      expect(formatAmount("0.0000001")).toBe("0.0000001");
      expect(formatAmount("1.0000001")).toBe("1.0000001");
    });

    it("formats a bigint exactly, up to any magnitude", () => {
      expect(formatAmount(big("123456789012345678901234"))).toBe("123,456,789,012,345,678,901,234");
    });

    it("honours maximumFractionDigits by rounding the exact value", () => {
      expect(formatAmount("1.005", { maximumFractionDigits: 2 })).toBe("1.01");
      expect(formatAmount("1.004", { maximumFractionDigits: 2 })).toBe("1");
    });

    it("formats a locale's own conventions", () => {
      expect(formatAmount("1234.5", { locale: "de-DE" })).toBe("1.234,5");
    });

    it("returns an empty string rather than a wrong one for unusable input", () => {
      expect(formatAmount("not a number")).toBe("");
      expect(formatAmount(Number.NaN)).toBe("");
      expect(formatAmount(Number.POSITIVE_INFINITY)).toBe("");
    });
  });

  describe("formatCurrency", () => {
    it("matches the eleven copies it replaced, for values a float handles", () => {
      // Every copy was `new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })`
      // (one of them with an explicit minimumFractionDigits: 2, which is the same output for
      // USD). Consolidating must not change what is displayed for ordinary amounts.
      const legacy = (value: number) =>
        new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

      for (const value of [0, 1.5, 12.34, 1234.567, 999_999.999, -42.5]) {
        expect(formatCurrency(value)).toBe(legacy(value));
      }
    });

    it("formats an exact decimal string without rounding it through a float", () => {
      expect(formatCurrency("9007199254740993.00")).toBe("$9,007,199,254,740,993.00");
      expect(formatCurrency(big("9007199254740993"))).toBe("$9,007,199,254,740,993.00");
    });
  });

  describe("formatStroops", () => {
    it("converts and formats in one step", () => {
      expect(formatStroops(big("15000000"), { decimals: 7 })).toBe("1.5");
    });

    it("keeps the exact value when rendered as currency", () => {
      expect(formatStroops(big("9007199254740993"), { decimals: 0, currency: "USD" })).toBe(
        "$9,007,199,254,740,993.00",
      );
    });
  });

  describe("sumAmounts", () => {
    it("sums rows exactly, past Number.MAX_SAFE_INTEGER", () => {
      const rows = ["9007199254740993", "9007199254740993"];

      const total = sumAmounts(rows, 7);
      expect(total.toString()).toBe("180143985094819860000000");

      // The float sum the display path used to compute, for contrast: it is off by a whole unit
      // before the stroop scale is even applied.
      const floatTotal = rows.reduce((sum, row) => sum + Number(row), 0);
      expect(floatTotal.toString()).toBe("18014398509481984");
      expect(formatAmount(total)).not.toBe(String(floatTotal));
    });

    it("has an aggregate that equals the sum of its rows at any magnitude", () => {
      const rows = ["100.5", "250.25", "0.0000001", "123456789012345.6789012"];

      const total = sumAmounts(rows, 7);
      const expected = rows.reduce((sum, row) => sum + (toStroops(row, 7) ?? big("0")), big("0"));

      expect(total).toBe(expected);
      // The screen shows the total and the rows through the same formatter, so a total that is
      // the exact sum cannot disagree with them.
      expect(formatAmount(total)).toBe(formatAmount(expected));
      expect(formatAmount(stroopsToDecimalString(total, 7))).toBe("123,456,789,012,696.4289013");
    });

    it("skips a malformed row instead of counting it as zero", () => {
      // Either way the row contributes nothing, but the intent is recorded: a row that cannot be
      // read is not silently the number 0.
      expect(sumAmounts(["1", "nonsense", "2"], 7)).toBe(toStroops("3", 7));
      expect(sumAmounts([], 7)).toBe(big("0"));
    });
  });

  describe("compareAmounts", () => {
    it("orders values a float comparison gets wrong", () => {
      // 2^53 and 2^53 + 1 are the same double; as stroops they are not the same amount.
      expect(compareAmounts("9007199254740993", "9007199254740992")).toBe(1);
      expect(Number("9007199254740993") > Number("9007199254740992")).toBe(false);
    });

    it("compares across representations", () => {
      expect(compareAmounts("1.50", "1.5")).toBe(0);
      expect(compareAmounts(2, "1.999")).toBe(1);
      expect(compareAmounts(big("10"), "11")).toBe(-1);
    });

    it("sorts unreadable values last and equal to each other", () => {
      expect(compareAmounts("abc", "abc")).toBe(0);
      expect(compareAmounts("abc", "1")).toBe(1);
      expect(compareAmounts("1", "abc")).toBe(-1);
    });
  });

  describe("isPositiveAmount", () => {
    it("is decided on the exact digits", () => {
      expect(isPositiveAmount("0.0000001")).toBe(true);
      expect(isPositiveAmount("0.0000000")).toBe(false);
      expect(isPositiveAmount(0)).toBe(false);
      expect(isPositiveAmount("-0.0000001")).toBe(false);
      expect(isPositiveAmount("abc")).toBe(false);
      expect(isPositiveAmount("9007199254740993")).toBe(true);
    });
  });

  describe("roundDecimalString", () => {
    it("pads to the requested precision", () => {
      expect(roundDecimalString("1.5", 2)).toBe("1.50");
      expect(roundDecimalString("1", 7)).toBe("1.0000000");
    });

    it("rounds half up without a float round-trip", () => {
      expect(roundDecimalString("1.005", 2)).toBe("1.01");
      expect(roundDecimalString("1.004", 2)).toBe("1.00");
      expect(roundDecimalString("1.999", 2)).toBe("2.00");
    });

    it("carries into the integer part when every kept digit is a nine", () => {
      expect(roundDecimalString("9.99", 1)).toBe("10.0");
      expect(roundDecimalString("0.99", 1)).toBe("1.0");
    });

    it("is exact for a value past Number.MAX_SAFE_INTEGER", () => {
      expect(roundDecimalString("9007199254740993.4567", 2)).toBe("9007199254740993.46");
    });

    it("returns null for input that is not a decimal", () => {
      expect(roundDecimalString("abc", 2)).toBeNull();
    });
  });

  describe("formatAmountOnBlur", () => {
    it("pads to the asset precision, exactly", () => {
      expect(formatAmountOnBlur("1.5", "USDC")).toBe("1.50");
      expect(formatAmountOnBlur("1.5", "XLM")).toBe("1.5000000");
    });

    it("does not change the digits of a large amount as the field loses focus", () => {
      expect(formatAmountOnBlur("9007199254740993", "USDC")).toBe("9007199254740993.00");
      // The float path this replaced would have written 9007199254740992.00 back into the input.
      expect((9007199254740993).toFixed(2)).toBe("9007199254740992.00");
    });

    it("returns an empty string for input that is not a decimal", () => {
      expect(formatAmountOnBlur("", "XLM")).toBe("");
      expect(formatAmountOnBlur("abc", "XLM")).toBe("");
    });
  });

  describe("formatTypedAmount", () => {
    it("formats as before for ordinary input", () => {
      expect(formatTypedAmount("1000", 7)).toBe("1,000");
      expect(formatTypedAmount("1.5", 7)).toBe("1.5");
      expect(formatTypedAmount("abc", 7)).toBeNull();
      expect(formatTypedAmount("", 7)).toBeNull();
    });

    it("keeps the digits of an amount a float cannot hold", () => {
      expect(formatTypedAmount("9007199254740993", 7)).toBe("9,007,199,254,740,993");
    });
  });

  describe("unitsToStroops", () => {
    it("accepts the representations a call site might have", () => {
      expect(unitsToStroops("1.5", 7)).toBe(big("15000000"));
      expect(unitsToStroops(1.5, 7)).toBe(big("15000000"));
      expect(unitsToStroops(big("2"), 7)).toBe(big("20000000"));
      expect(unitsToStroops("nonsense", 7)).toBeNull();
    });
  });
});
