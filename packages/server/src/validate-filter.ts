/**
 * Client-supplied filter validation and in-process matching.
 *
 * Filters are NEVER executed as SQL. They are parsed against a strict
 * format, validated against an allowlist, and applied in-process.
 *
 * Format: "column operator value"
 * Examples: "status = pending", "total > 50", "user_id != 0"
 */

export interface ParsedFilter {
  column: string;
  operator: string;
  value: string;
}

const ALLOWED_OPERATORS = ["=", "!=", "<=", ">=", "<", ">"] as const;

// Strict regex: identifier (column), operator, then the rest (value)
// Column: starts with letter or _, followed by letters/digits/_
const FILTER_REGEX = /^([a-z_][a-z0-9_]*)\s*(!=|<=|>=|=|<|>)\s*(\S.*)?$/i;

export class FilterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilterValidationError";
  }
}

/**
 * Parse and validate a filter expression.
 * @throws FilterValidationError if the filter is malformed or uses a disallowed column/operator
 */
export function validateFilter(filter: string, allowedColumns: string[]): ParsedFilter {
  const trimmed = filter.trim();
  const match = FILTER_REGEX.exec(trimmed);

  if (!match) {
    throw new FilterValidationError(
      `Invalid filter format. Expected "column operator value", got: "${filter}"`,
    );
  }

  const [, column, operator, value] = match;

  if (!column || !operator) {
    throw new FilterValidationError("Invalid filter: missing column or operator");
  }

  if (value === undefined || value === "") {
    throw new FilterValidationError("Invalid filter: missing value");
  }

  if (!allowedColumns.includes(column.toLowerCase())) {
    throw new FilterValidationError(
      `Column "${column}" is not allowed for filtering. Allowed: ${allowedColumns.join(", ")}`,
    );
  }

  if (!(ALLOWED_OPERATORS as readonly string[]).includes(operator)) {
    throw new FilterValidationError(
      `Operator "${operator}" is not allowed. Allowed: ${ALLOWED_OPERATORS.join(", ")}`,
    );
  }

  return { column: column.toLowerCase(), operator, value: value.trim() };
}

/**
 * Test whether a row matches a parsed filter expression.
 * Handles numeric and string comparisons.
 */
export function matchesFilter(filter: ParsedFilter, row: Record<string, unknown>): boolean {
  const rowRawValue = row[filter.column];

  if (rowRawValue === null || rowRawValue === undefined) {
    return filter.operator === "!=" ? filter.value !== "null" : false;
  }

  const rowStr = String(rowRawValue);
  const filterVal = filter.value;

  const numRow = Number(rowStr);
  const numFilter = Number(filterVal);
  const isNumeric = !isNaN(numRow) && !isNaN(numFilter) && filterVal.trim() !== "";

  switch (filter.operator) {
    case "=":
      return rowStr === filterVal;
    case "!=":
      return rowStr !== filterVal;
    case "<":
      return isNumeric ? numRow < numFilter : rowStr < filterVal;
    case ">":
      return isNumeric ? numRow > numFilter : rowStr > filterVal;
    case "<=":
      return isNumeric ? numRow <= numFilter : rowStr <= filterVal;
    case ">=":
      return isNumeric ? numRow >= numFilter : rowStr >= filterVal;
    default:
      return false;
  }
}
