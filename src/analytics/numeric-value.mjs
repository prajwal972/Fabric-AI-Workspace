import { AppError } from "../server/errors.mjs";
import { checkedJsonNumber } from "../security/strict-json.mjs";
// One explicit input convention for the deterministic service and dashboard.
// This is not a general locale parser or an arbitrary-precision arithmetic engine.
export function analystNumber(value, { strict = false } = {}) {
  if (value == null || typeof value === "boolean" || typeof value === "object")
    return null;
  if (typeof value === "number") {
    try {
      return checkedJsonNumber(String(value));
    } catch (error) {
      if (strict) throw error;
      return null;
    }
  }
  let text = String(value).trim();
  if (!text || text.length > 1000) return null;
  let accounting = false,
    percent = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    accounting = true;
    text = text.slice(1, -1).trim();
  }
  if (text.endsWith("%")) {
    percent = true;
    text = text.slice(0, -1).trim();
  }
  // Currency may precede/follow the sign, but cannot appear embedded in digits.
  text = text.replace(/^([+-]?)\s*[$€£₹]\s*/, "$1").replace(/\s*[$€£₹]$/, "");
  if (accounting && /^[+-]/.test(text)) return null;
  const parts = /^([+-]?)([\d,]+|\d*\.\d+)(\.\d+)?([eE][+-]?\d+)?$/.exec(text);
  if (!parts) return null;
  let integer = parts[2];
  if (integer.includes(",")) {
    const western = /^\d{1,3}(?:,\d{3})+$/.test(integer),
      indian = /^\d{1,2}(?:,\d{2})*,\d{3}$/.test(integer);
    if (!western && !indian) return null;
    integer = integer.replaceAll(",", "");
  }
  // Normalize benign spelling only, never precision or malformed grouping.
  let token =
    (parts[1] === "-" ? "-" : "") +
    integer +
    (parts[3] || "") +
    (parts[4] || "");
  token = token.replace(/^(-?)0+(?=\d)/, "$1").replace(/^(-?)\./, "$10.");
  if (accounting) token = "-" + token;
  if (!/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token)) return null;
  try {
    const number = checkedJsonNumber(token);
    const result = percent ? number / 100 : number;
    if (number !== 0 && result === 0)
      throw new AppError(
        "NUMERIC_PRECISION",
        "A dataset percentage would underflow the supported numeric precision.",
        422,
      );
    return result;
  } catch (error) {
    if (strict) throw error;
    return null;
  }
}
