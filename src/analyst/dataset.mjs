import { parseUnambiguousJson } from "../security/strict-json.mjs";
import { AppError } from "../server/errors.mjs";
export const DATASET_ERROR_MESSAGES = Object.freeze({
  DATASET_ENCODING:
    "Structured data must contain valid UTF-8 text. Export it as UTF-8 before uploading.",
  DATASET_TOO_LARGE:
    "The dataset exceeds supported size limits. Split it before uploading.",
  DATASET_ROW_LIMIT:
    "The dataset exceeds supported row limits. Split it before analysis.",
  DATASET_DUPLICATE_SOURCE:
    "The same file was selected more than once. Select each source only once.",
  DATASET_COLUMNS:
    "Column names are duplicate, unsafe or exceed supported limits. Rename or reduce columns.",
  DATASET_CSV_INVALID:
    "CSV quoting is malformed. Export a valid CSV before uploading.",
  DATASET_CSV_WIDTH:
    "A CSV row has more fields than its header. Correct the row widths.",
  DATASET_JSON_INVALID:
    "Dataset JSON is invalid. Export valid JSON before uploading.",
  DATASET_JSON_DUPLICATE_KEY:
    "JSON contains duplicate fields. Remove ambiguous duplicate fields before uploading.",
  DATASET_JSON_DEPTH:
    "JSON nesting exceeds supported limits. Flatten or split the document.",
  NUMERIC_PRECISION:
    "A dataset number would lose decimal precision. Export it as text or reduce its precision explicitly.",
  DATASET_JSON_SHAPE:
    "Analysis requires flat JSON records. Explicitly flatten nested values first.",
  DATASET_NUL: "Structured data contains null bytes. Export clean UTF-8 data.",
  NUMERIC_RANGE: "Dataset numbers exceed the supported finite numeric range.",
  DATASET_SHEET_SCHEMA:
    "Worksheets have different headers. Export them as separate datasets.",
  DATASET_SHEETS_LIMIT: "The workbook exceeds the supported worksheet limit.",
  DATASET_FORMULA_CACHE_MISSING:
    "Recalculate and save the workbook before uploading: formula results are missing.",
});

const reserved = new Set(["__proto__", "prototype", "constructor"]);
const fail = (code, message) => {
  throw new AppError(code, message, 422);
};
function checkLimit(maxRows) {
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 50001)
    throw new TypeError("Invalid structured dataset row limit");
}
function column(name) {
  if (!name || name.length > 500 || name.startsWith("__") || reserved.has(name))
    fail(
      "DATASET_COLUMNS",
      "Dataset column names are empty, unsafe or exceed supported limits.",
    );
}
function records(raw, delimiter, maxRows) {
  const rows = [];
  let row = [],
    value = "",
    quoted = false,
    inQuotes = false,
    closed = false,
    touched = false;
  const field = () => {
    row.push(quoted ? value : value.trim());
    value = "";
    quoted = false;
    closed = false;
    if (row.length > 100)
      fail("DATASET_COLUMNS", "Datasets support at most 100 columns.");
  };
  const record = () => {
    field();
    if (touched) {
      rows.push(row);
      if (rows.length > maxRows + 1)
        fail(
          "DATASET_ROW_LIMIT",
          "Datasets support at most the configured row limit; no partial dataset was returned.",
        );
    }
    row = [];
    touched = false;
  };
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inQuotes) {
      if (c === '"') {
        if (raw[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          inQuotes = false;
          closed = true;
        }
      } else if (c === "\r") {
        value += "\n";
        if (raw[i + 1] === "\n") i++;
      } else value += c;
      continue;
    }
    if (c === delimiter) {
      touched = true;
      field();
      continue;
    }
    if (c === "\r" || c === "\n") {
      record();
      if (c === "\r" && raw[i + 1] === "\n") i++;
      continue;
    }
    if (closed) {
      if (c === " " || c === "\t") continue;
      fail(
        "DATASET_CSV_INVALID",
        "CSV contains invalid characters after a quoted field.",
      );
    }
    if (c === '"') {
      if (value.trim())
        fail(
          "DATASET_CSV_INVALID",
          "CSV quotes must enclose a complete field.",
        );
      value = "";
      quoted = true;
      inQuotes = true;
      touched = true;
      continue;
    }
    value += c;
    if (c.trim()) touched = true;
  }
  if (inQuotes)
    fail("DATASET_CSV_INVALID", "CSV contains an unterminated quoted field.");
  if (touched || row.length || value) record();
  return rows;
}
function delimiterFor(raw) {
  let quoted = false;
  const counts = new Map([
    [",", 0],
    ["\t", 0],
    [";", 0],
    ["|", 0],
  ]);
  let started = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') {
      if (quoted && raw[i + 1] === '"') {
        i++;
        continue;
      }
      quoted = !quoted;
      started = true;
    } else if (!quoted && (c === "\n" || c === "\r")) {
      if (started) break;
    } else if (!quoted && counts.has(c)) {
      counts.set(c, counts.get(c) + 1);
      started = true;
    } else if (c.trim()) started = true;
  }
  const [delimiter, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return { delimiter, n };
}
function jsonRows(raw, jsonl, maxRows) {
  let rows;
  try {
    if (jsonl) {
      rows = [];
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        rows.push(parseUnambiguousJson(line));
        if (rows.length > maxRows) break;
      }
    } else {
      const data = parseUnambiguousJson(raw);
      rows = Array.isArray(data) ? data : [data];
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    fail("DATASET_JSON_INVALID", "Dataset JSON could not be parsed.");
  }
  if (rows.length > maxRows)
    fail(
      "DATASET_ROW_LIMIT",
      "Dataset exceeds its configured row limit; no partial dataset was returned.",
    );
  const names = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row))
      fail(
        "DATASET_JSON_SHAPE",
        "Dataset JSON must contain flat records, not scalar or nested arrays.",
      );
    for (const [name, value] of Object.entries(row)) {
      column(name);
      names.add(name);
      if (names.size > 100)
        fail("DATASET_COLUMNS", "Datasets support at most 100 columns.");
      if (value !== null && typeof value === "object")
        fail(
          "DATASET_JSON_SHAPE",
          "Nested JSON values require explicit flattening before analysis.",
        );
      if (typeof value === "number" && !Number.isFinite(value))
        fail(
          "NUMERIC_RANGE",
          "Dataset JSON contains a number outside the supported numeric range.",
        );
    }
  }
  return rows;
}
export function parseStructuredDataset(file, maxRows = 50000) {
  checkLimit(maxRows);
  const raw = String(file?.text ?? "").replace(/^\uFEFF/, "");
  if (Buffer.byteLength(raw) > 2000000)
    fail(
      "DATASET_TOO_LARGE",
      "Structured datasets support at most 2 MB of extracted text.",
    );
  if (raw.includes("\0"))
    fail("DATASET_NUL", DATASET_ERROR_MESSAGES.DATASET_NUL);
  if (!raw.trim()) return [];
  const ext =
    String(file?.name || "")
      .toLowerCase()
      .match(/\.[^.]+$/)?.[0] || "";
  if (
    [".json", ".jsonl"].includes(ext) ||
    file?.kind === "json" ||
    file?.kind === "jsonl"
  )
    return jsonRows(raw, ext === ".jsonl" || file?.kind === "jsonl", maxRows);
  const { delimiter, n } = delimiterFor(raw);
  const explicit =
    [".csv", ".tsv", ".xlsx"].includes(ext) || file?.kind === "csv";
  if (!n && !explicit) return [];
  const all = records(raw, delimiter, maxRows);
  if (all.length < 2) return [];
  const headers = all[0].map((name, i) => name.trim() || "Column " + (i + 1));
  const seen = new Set();
  for (const name of headers) {
    column(name);
    if (seen.has(name))
      fail(
        "DATASET_COLUMNS",
        "Duplicate column names require renaming before analysis.",
      );
    seen.add(name);
  }
  return all.slice(1).map((cells) => {
    if (cells.length > headers.length)
      fail(
        "DATASET_CSV_WIDTH",
        "CSV row contains more fields than its header.",
      );
    return Object.fromEntries(headers.map((name, i) => [name, cells[i] ?? ""]));
  });
}
export function loadStructuredRows(files, maxRows = 50000) {
  checkLimit(maxRows);
  const rows = [],
    names = new Set(),
    ids = new Set();
  for (const file of files || []) {
    if (file.id) {
      if (ids.has(file.id))
        fail(
          "DATASET_DUPLICATE_SOURCE",
          DATASET_ERROR_MESSAGES.DATASET_DUPLICATE_SOURCE,
        );
      ids.add(file.id);
    }
    const remaining = maxRows - rows.length;
    const parsed = parseStructuredDataset(file, Math.max(1, remaining));
    if (parsed.length > remaining)
      fail(
        "DATASET_ROW_LIMIT",
        "Combined datasets exceed the configured row limit; no partial aggregate was returned.",
      );
    for (const row of parsed)
      for (const name of Object.keys(row)) {
        names.add(name);
        if (names.size > 100)
          fail(
            "DATASET_COLUMNS",
            "Combined datasets support at most 100 distinct columns. Select fewer columns or datasets.",
          );
      }
    rows.push(
      ...parsed.map((row) => ({
        ...row,
        __sourceFile: file.name,
        __sourceId: file.id,
      })),
    );
  }
  return rows;
}
