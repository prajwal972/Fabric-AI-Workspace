import { AppError } from "../server/errors.mjs";

// Deliberately small analytics dialect, not arbitrary SQL execution. Only
// pg_catalog functions below can be called; user-defined/schema-qualified
// functions, operators, casts, comments and quoted identifiers are unavailable.
const functions = new Set([
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "abs",
  "round",
  "ceil",
  "ceiling",
  "floor",
  "sqrt",
  "power",
  "mod",
  "sign",
  "coalesce",
  "nullif",
  "greatest",
  "least",
  "lower",
  "upper",
  "length",
  "char_length",
  "trim",
  "btrim",
  "ltrim",
  "rtrim",
  "substring",
  "substr",
  "replace",
  "concat",
  "date_trunc",
  "date_part",
  "extract",
  "to_char",
  "stddev",
  "stddev_pop",
  "stddev_samp",
  "variance",
  "var_pop",
  "var_samp",
  "corr",
  "covar_pop",
  "covar_samp",
  "percentile_cont",
  "percentile_disc",
  "row_number",
  "rank",
  "dense_rank",
  "lag",
  "lead",
  "first_value",
  "last_value",
]);
const grouping = new Set([
  "select",
  "from",
  "where",
  "having",
  "on",
  "as",
  "in",
  "exists",
  "not",
  "and",
  "or",
  "over",
  "filter",
  "within",
  "group",
  "distinct",
  "when",
  "then",
  "else",
  "by",
]);
const forbidden = new Set([
  "insert",
  "update",
  "delete",
  "merge",
  "drop",
  "alter",
  "create",
  "grant",
  "revoke",
  "copy",
  "call",
  "do",
  "execute",
  "prepare",
  "deallocate",
  "set",
  "reset",
  "show",
  "vacuum",
  "analyze",
  "explain",
  "lock",
  "listen",
  "unlisten",
  "notify",
  "operator",
  "into",
]);
const invalid = () =>
  new AppError(
    "UNSAFE_SQL",
    "Only the bounded read-only analytics SQL dialect is allowed.",
    400,
  );
export function validateAnalyticsSQL(query) {
  if (typeof query !== "string" || query.length > 10000 || !query.trim())
    throw invalid();
  const tokens = [];
  let i = 0;
  while (i < query.length) {
    const c = query[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "'") {
      // Standard SQL strings only. Escaped/backslash, dollar and E strings are
      // rejected so lexical policy cannot disagree with the server parser.
      i++;
      let closed = false;
      while (i < query.length) {
        if (query[i] === "\\") throw invalid();
        if (query[i++] === "'") {
          if (query[i] === "'") {
            i++;
            continue;
          }
          closed = true;
          break;
        }
      }
      if (!closed) throw invalid();
      tokens.push({ kind: "literal", value: "string" });
      continue;
    }
    const word = query.slice(i).match(/^[a-z_][a-z0-9_]*/i);
    if (word) {
      tokens.push({ kind: "word", value: word[0].toLowerCase() });
      i += word[0].length;
      continue;
    }
    const number = query
      .slice(i)
      .match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (number) {
      tokens.push({ kind: "literal", value: "number" });
      i += number[0].length;
      continue;
    }
    if ("(),.+-*/%=<>!".includes(c)) {
      if (query.slice(i, i + 2) === "--" || query.slice(i, i + 2) === "/*")
        throw invalid();
      tokens.push({ kind: "symbol", value: c });
      i++;
      continue;
    }
    throw invalid();
  }
  if (!["select", "with"].includes(tokens[0]?.value)) throw invalid();
  let depth = 0;
  for (let n = 0; n < tokens.length; n++) {
    const token = tokens[n];
    if (token.value === "(" && ++depth > 32) throw invalid();
    if (token.value === ")" && --depth < 0) throw invalid();
    if (token.kind !== "word") continue;
    if (
      forbidden.has(token.value) ||
      token.value.startsWith("pg_") ||
      ["pg_catalog", "information_schema"].includes(token.value)
    )
      throw invalid();
    if (
      tokens[n + 1]?.kind === "literal" &&
      tokens[n + 1]?.value === "string" &&
      ["e", "u", "b", "x"].includes(token.value)
    )
      throw invalid();
    if (tokens[n + 1]?.value === "(") {
      if (
        tokens[n - 1]?.value === "." ||
        (!functions.has(token.value) && !grouping.has(token.value))
      )
        throw invalid();
    }
  }
  if (depth !== 0) throw invalid();
  return query.trim();
}
