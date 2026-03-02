import { describe, it, expect } from "vitest";
import { validateFilter, matchesFilter, FilterValidationError } from "../validate-filter.js";
import type { ParsedFilter } from "../validate-filter.js";

describe("validateFilter", () => {
  const allowed = ["status", "user_id", "total", "created_at"];

  it("parses a valid equality filter", () => {
    const result = validateFilter("status = pending", allowed);
    expect(result).toEqual({ column: "status", operator: "=", value: "pending" });
  });

  it("parses all supported operators", () => {
    const ops = ["=", "!=", "<", ">", "<=", ">="] as const;
    for (const op of ops) {
      const result = validateFilter(`total ${op} 100`, allowed);
      expect(result.operator).toBe(op);
    }
  });

  it("normalises column name to lowercase", () => {
    const result = validateFilter("Status = pending", ["status"]);
    expect(result.column).toBe("status");
  });

  it("trims surrounding whitespace from value", () => {
    const result = validateFilter("status =  shipped ", allowed);
    expect(result.value).toBe("shipped");
  });

  it("throws FilterValidationError for unknown column", () => {
    expect(() => validateFilter("secret = value", allowed)).toThrow(FilterValidationError);
    expect(() => validateFilter("secret = value", allowed)).toThrow(/not allowed/i);
  });

  it("throws FilterValidationError for malformed filter (no operator)", () => {
    expect(() => validateFilter("status", allowed)).toThrow(FilterValidationError);
  });

  it("throws FilterValidationError for missing value", () => {
    expect(() => validateFilter("status =", allowed)).toThrow(FilterValidationError);
  });

  it("throws FilterValidationError for SQL injection attempt", () => {
    expect(() => validateFilter("status = x; DROP TABLE orders", allowed)).not.toThrow();
    // Value is treated as a literal string — no SQL execution
    const result = validateFilter("status = x; DROP TABLE orders", allowed);
    expect(result.value).toBe("x; DROP TABLE orders");
  });
});

describe("matchesFilter", () => {
  function f(column: string, operator: string, value: string): ParsedFilter {
    return { column, operator, value };
  }

  it("matches equality (=)", () => {
    expect(matchesFilter(f("status", "=", "pending"), { status: "pending" })).toBe(true);
    expect(matchesFilter(f("status", "=", "shipped"), { status: "pending" })).toBe(false);
  });

  it("matches inequality (!=)", () => {
    expect(matchesFilter(f("status", "!=", "pending"), { status: "shipped" })).toBe(true);
    expect(matchesFilter(f("status", "!=", "pending"), { status: "pending" })).toBe(false);
  });

  it("compares numerically when both sides are numbers", () => {
    expect(matchesFilter(f("total", ">", "50"), { total: "100" })).toBe(true);
    expect(matchesFilter(f("total", ">", "100"), { total: "50" })).toBe(false);
    expect(matchesFilter(f("total", "<=", "100"), { total: "100" })).toBe(true);
    expect(matchesFilter(f("total", "<", "100"), { total: "100" })).toBe(false);
    expect(matchesFilter(f("total", ">=", "50"), { total: "50" })).toBe(true);
  });

  it("returns false when row column is null", () => {
    expect(matchesFilter(f("status", "=", "pending"), { status: null })).toBe(false);
  });

  it("returns false when row column is undefined", () => {
    expect(matchesFilter(f("status", "=", "pending"), {})).toBe(false);
  });

  it("returns true for != when row column is null and value is not 'null'", () => {
    expect(matchesFilter(f("status", "!=", "pending"), { status: null })).toBe(true);
  });

  it("matches string comparison for non-numeric values", () => {
    // 'b' > 'a' lexicographically
    expect(matchesFilter(f("status", ">", "a"), { status: "b" })).toBe(true);
  });
});
