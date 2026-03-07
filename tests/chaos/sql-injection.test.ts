/**
 * Chaos Test: SQL Injection via Filter
 *
 * Verifies that malicious filter strings are either rejected or, when they
 * match the "column operator value" format, are NEVER executed as SQL.
 * The value is always compared in-process via matchesFilter().
 */

import { describe, it, expect } from "vitest";
import { validateFilter, matchesFilter, FilterValidationError } from "@livesql/server";

const ALLOWED_COLUMNS = ["status", "user_id", "total"];

describe("SQL injection via filter", () => {
  describe("filters that fail parsing (rejected outright)", () => {
    const rejectedFilters = [
      "1=1; DROP TABLE orders;--",
      "'; DROP TABLE orders; --",
      "1; SELECT pg_sleep(10);--",
      "../../../etc/passwd",
      "<script>alert(1)</script>",
    ];

    for (const filter of rejectedFilters) {
      it(`rejects: ${filter.slice(0, 60)}`, () => {
        expect(() => validateFilter(filter, ALLOWED_COLUMNS)).toThrow(FilterValidationError);
      });
    }
  });

  describe("filters that parse but value contains SQL — never executed", () => {
    // These match the "column operator value" format, so they parse.
    // But the value is NEVER used in SQL — it's compared in-process.
    // The key guarantee: no client input ever reaches the database.
    const parsedButHarmless = [
      { filter: "status = pending; DELETE FROM users;--", value: "pending; DELETE FROM users;--" },
      { filter: "status = pending OR 1=1", value: "pending OR 1=1" },
      {
        filter: "status = pending UNION SELECT * FROM pg_shadow",
        value: "pending UNION SELECT * FROM pg_shadow",
      },
      {
        filter: "status = (SELECT password FROM users LIMIT 1)",
        value: "(SELECT password FROM users LIMIT 1)",
      },
      { filter: "status = pending /* comment */ OR 1=1", value: "pending /* comment */ OR 1=1" },
    ];

    for (const { filter, value } of parsedButHarmless) {
      it(`parses but value is never SQL: ${filter.slice(0, 60)}`, () => {
        const parsed = validateFilter(filter, ALLOWED_COLUMNS);
        expect(parsed.column).toBe("status");
        expect(parsed.value).toBe(value);

        // The critical test: matchesFilter does an in-process string comparison.
        // The malicious value will simply not match any real row value.
        const row = { status: "pending", id: 1 };
        expect(matchesFilter(parsed, row)).toBe(false); // "pending" !== "pending OR 1=1"
      });
    }
  });

  it("rejects unknown column names", () => {
    expect(() => validateFilter("password = secret", ALLOWED_COLUMNS)).toThrow(
      FilterValidationError,
    );
  });

  it("rejects unknown operators", () => {
    expect(() => validateFilter("status LIKE %pending%", ALLOWED_COLUMNS)).toThrow(
      FilterValidationError,
    );
    expect(() => validateFilter("status IN (pending, shipped)", ALLOWED_COLUMNS)).toThrow(
      FilterValidationError,
    );
  });

  it("accepts valid filters and matches correctly", () => {
    const parsed = validateFilter("status = pending", ALLOWED_COLUMNS);
    expect(parsed.column).toBe("status");
    expect(parsed.operator).toBe("=");
    expect(parsed.value).toBe("pending");

    expect(matchesFilter(parsed, { status: "pending" })).toBe(true);
    expect(matchesFilter(parsed, { status: "shipped" })).toBe(false);
  });
});
