// Numeric identity/format checking only. This does not prove an explanation's
// units, causality, written-out quantities or semantic interpretation.
const literal = /^[+-]?(?:\d+(?:,\d+)*(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
function parseNumber(text) {
  if (!literal.test(text)) return null;
  const mantissa = text.split(/e/i)[0].replace(/^[+-]/, "").split(".")[0];
  if (
    mantissa.includes(",") &&
    !/^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})$/.test(mantissa)
  )
    return null;
  const value = Number(text.replaceAll(",", ""));
  return Number.isFinite(value) ? value : null;
}
function computedNumbers(facts) {
  const values = new Set();
  const collect = (value, depth = 0) => {
    if (depth > 10) return;
    if (typeof value === "number" && Number.isFinite(value)) values.add(value);
    else if (Array.isArray(value))
      value.slice(0, 1000).forEach((item) => collect(item, depth + 1));
    else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        if (key === "label" && typeof item === "string") {
          const parsed = parseNumber(item.trim());
          if (parsed !== null) values.add(parsed);
        } else if (key !== "label") collect(item, depth + 1);
      }
    }
  };
  collect(facts?.value);
  for (const key of [
    "rowsIncluded",
    "validValues",
    "outputTotal",
    "outputReturned",
  ]) {
    const count = facts?.provenance?.[key];
    if (Number.isSafeInteger(count) && count >= 0) values.add(count);
  }
  // Match normal display rounding, not invented transformations/percent scaling.
  const allowed = new Set(values);
  for (const value of values)
    for (let precision = 0; precision <= 8; precision++)
      allowed.add(Number(value.toFixed(precision)));
  return allowed;
}
export function validateNumericExplanation(text, facts) {
  if (typeof text !== "string" || text.length > 30000)
    return {
      valid: false,
      reason: "invalid_explanation",
      semanticSupportVerified: false,
    };
  if (
    /[\p{Nd}]/u.test(text.replace(/[0-9]/g, "")) ||
    /(?<![\p{L}\p{N}_])\d[\d_]*_\d/u.test(text)
  )
    return {
      valid: false,
      reason: "unsupported_numeric_format",
      semanticSupportVerified: false,
    };
  const allowed = computedNumbers(facts),
    normalized = text
      .replace(/[−–]/g, "-")
      .replace(/(?<=\d)[\u00a0\u202f\u2009](?=\d{3}(?:\D|$))/g, ",");
  const scale = {
    k: 1e3,
    thousand: 1e3,
    m: 1e6,
    million: 1e6,
    b: 1e9,
    billion: 1e9,
    t: 1e12,
    trillion: 1e12,
  };
  const tokens =
    /(?<![\p{L}\p{N}_])(?:\(\s*[$€£₹]?\s*)?[-+]?(?:\d+(?:,\d+)*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:\s*(?:thousand|million|billion|trillion|[kKmMbBtT]))?%?\)?(?![\p{L}\p{N}_])/gu;
  let checkedNumericClaims = 0;
  // Unknown compact notation (hex/bigint/etc.) must not evade the checker.
  if (
    /(?<![\p{L}\p{N}_])\d[\w.,+-]*[a-zA-Z]\b/u.test(
      normalized.replace(tokens, ""),
    )
  )
    return {
      valid: false,
      reason: "unsupported_numeric_format",
      semanticSupportVerified: false,
    };
  for (const match of normalized.matchAll(tokens)) {
    let token = match[0].trim(),
      negativeParentheses = token.startsWith("(") && token.endsWith(")");
    token = token.replace(/[()$€£₹%\s]/g, "");
    const magnitude = token.match(
      /(thousand|million|billion|trillion|[kmbt])$/i,
    );
    if (magnitude) token = token.slice(0, -magnitude[0].length);
    let value = parseNumber(token);
    if (value === null)
      return {
        valid: false,
        reason: "unsupported_numeric_format",
        semanticSupportVerified: false,
      };
    value *= magnitude ? scale[magnitude[0].toLowerCase()] : 1;
    if (negativeParentheses) value = -Math.abs(value);
    checkedNumericClaims++;
    if (!Number.isFinite(value) || !allowed.has(value))
      return {
        valid: false,
        reason: "unverified_numbers",
        checkedNumericClaims,
        semanticSupportVerified: false,
      };
  }
  return {
    valid: true,
    checkedNumericClaims,
    displayRoundingAllowed: true,
    semanticSupportVerified: false,
  };
}
