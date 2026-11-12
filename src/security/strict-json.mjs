import { AppError } from "../server/errors.mjs";
const messages = Object.freeze({
  DATASET_JSON_INVALID:
    "Dataset JSON is invalid. Export valid JSON before uploading.",
  DATASET_JSON_DUPLICATE_KEY:
    "JSON contains duplicate fields. Remove ambiguous duplicate fields before uploading.",
  DATASET_JSON_DEPTH:
    "JSON nesting exceeds supported limits. Flatten or split the document.",
  DATASET_TOO_LARGE:
    "The dataset exceeds supported size limits. Split it before uploading.",
  NUMERIC_RANGE: "Dataset numbers exceed the supported safe numeric range.",
  NUMERIC_PRECISION:
    "A dataset number would lose decimal precision. Export it as text or reduce its precision explicitly.",
});
const fail = (code) => {
  throw new AppError(code, messages[code], 422);
};
// Compare decimal spellings without evaluating large powers or allocating large integers.
function decimalIdentity(token) {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!match) fail("DATASET_JSON_INVALID");
  const exponent = Number(match[4] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 10000)
    fail("NUMERIC_RANGE");
  let digits = (match[2] + (match[3] || "")).replace(/^0+/, ""),
    power = exponent - (match[3]?.length || 0);
  if (!digits) return "0";
  const stripped = digits.replace(/0+$/, "");
  power += digits.length - stripped.length;
  return match[1] + stripped + "e" + power;
}
export function checkedJsonNumber(token) {
  const value = Number(token);
  if (
    !Number.isFinite(value) ||
    (Number.isInteger(value) && !Number.isSafeInteger(value))
  )
    fail("NUMERIC_RANGE");
  if (decimalIdentity(token) !== decimalIdentity(String(value)))
    fail("NUMERIC_PRECISION");
  return value;
}
// Bounded preflight runs before native JSON.parse, which otherwise silently keeps the
// last duplicate key and rounds unsafe numeric literals. This is for uploaded data,
// not provider response floats, tokens, authentication or arbitrary JavaScript.
export function parseUnambiguousJson(
  raw,
  { strictNumbers = true, maxDepth = 64 } = {},
) {
  if (typeof raw !== "string") throw new TypeError("JSON input must be text");
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 64)
    throw new TypeError("Invalid JSON depth limit");
  if (Buffer.byteLength(raw) > 2000000) fail("DATASET_TOO_LARGE");
  let pos = 0,
    tokens = 0;
  const space = () => {
    while (/[\t\n\r ]/.test(raw[pos] || "x")) pos++;
  };
  const expect = (c) => {
    space();
    if (raw[pos++] !== c) fail("DATASET_JSON_INVALID");
  };
  function string(decode = false) {
    const begin = pos;
    if (raw[pos++] !== '"') fail("DATASET_JSON_INVALID");
    while (pos < raw.length) {
      const c = raw[pos++];
      if (c === '"') {
        if (!decode) return;
        try {
          return JSON.parse(raw.slice(begin, pos));
        } catch {
          fail("DATASET_JSON_INVALID");
        }
      }
      if (c.charCodeAt(0) < 32) fail("DATASET_JSON_INVALID");
      if (c === "\\") {
        const escape = raw[pos++];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(raw.slice(pos, pos + 4)))
            fail("DATASET_JSON_INVALID");
          pos += 4;
        } else if (!escape || !'"\\/bfnrt'.includes(escape))
          fail("DATASET_JSON_INVALID");
      }
    }
    fail("DATASET_JSON_INVALID");
  }
  function value(depth) {
    if (++tokens > 500000) fail("DATASET_TOO_LARGE");
    space();
    const c = raw[pos];
    if (c === "{" || c === "[") {
      if (depth >= maxDepth) fail("DATASET_JSON_DEPTH");
      const object = c === "{",
        end = object ? "}" : "]",
        keys = object ? new Set() : null;
      pos++;
      space();
      if (raw[pos] === end) {
        pos++;
        return;
      }
      while (true) {
        if (object) {
          space();
          const key = string(true);
          if (keys.has(key)) fail("DATASET_JSON_DUPLICATE_KEY");
          keys.add(key);
          expect(":");
        }
        value(depth + 1);
        space();
        if (raw[pos] === end) {
          pos++;
          return;
        }
        expect(",");
      }
    }
    if (c === '"') return string();
    for (const literal of ["true", "false", "null"]) {
      if (raw.startsWith(literal, pos)) {
        pos += literal.length;
        return;
      }
    }
    const begin = pos;
    if (raw[pos] === "-") pos++;
    if (raw[pos] === "0") pos++;
    else {
      if (!/[1-9]/.test(raw[pos] || "x")) fail("DATASET_JSON_INVALID");
      while (/[0-9]/.test(raw[pos] || "x")) pos++;
    }
    if (raw[pos] === ".") {
      pos++;
      const at = pos;
      while (/[0-9]/.test(raw[pos] || "x")) pos++;
      if (pos === at) fail("DATASET_JSON_INVALID");
    }
    if (raw[pos] === "e" || raw[pos] === "E") {
      pos++;
      if (raw[pos] === "+" || raw[pos] === "-") pos++;
      const at = pos;
      while (/[0-9]/.test(raw[pos] || "x")) pos++;
      if (pos === at) fail("DATASET_JSON_INVALID");
    }
    if (strictNumbers) checkedJsonNumber(raw.slice(begin, pos));
  }
  value(0);
  space();
  if (pos !== raw.length) fail("DATASET_JSON_INVALID");
  try {
    return JSON.parse(raw);
  } catch {
    fail("DATASET_JSON_INVALID");
  }
}
