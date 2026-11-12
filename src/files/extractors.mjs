import fs from "node:fs";
import ExcelJS from "exceljs";

export async function readTextBounded(
  file,
  maxBytes = 2_000_000,
  { preserveNul = false } = {},
) {
  const chunks = [];
  let bytes = 0;
  const stream = fs.createReadStream(file, { highWaterMark: 64 * 1024 });
  for await (const chunk of stream) {
    const remaining = maxBytes - bytes;
    if (remaining <= 0) break;
    chunks.push(chunk.subarray(0, remaining));
    bytes += Math.min(chunk.length, remaining);
  }
  stream.destroy();
  let text;
  try {
    text = preserveNul
      ? new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))
      : Buffer.concat(chunks).toString("utf8");
  } catch {
    throw Object.assign(
      new Error("Structured data must contain valid UTF-8 text."),
      { code: "DATASET_ENCODING" },
    );
  }
  return preserveNul ? text : text.replace(/\0/g, "");
}

const cellValue = (cell) => {
  const value =
    cell && typeof cell === "object" && "value" in cell ? cell.value : cell;
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) {
      if (!("result" in value) || value.result === undefined)
        throw Object.assign(
          new Error(
            "Recalculate and save the workbook before uploading: a formula has no cached result.",
          ),
          { code: "DATASET_FORMULA_CACHE_MISSING" },
        );
      return cellValue(value.result);
    }
    if ("result" in value) return cellValue(value.result);
    if ("text" in value) return String(value.text ?? "");
    if ("richText" in value)
      return value.richText.map((part) => part.text).join("");
    if ("hyperlink" in value)
      return String(value.text || value.hyperlink || "");
    return "";
  }
  return String(value);
};

const csvCell = (value) => {
  let text = String(value ?? "");
  // Prevent spreadsheet-formula execution if extracted data is exported later.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export async function extractXlsxBounded(
  file,
  { maxRows = 50_001, maxChars = 500_000, preserveNumeric = true } = {},
) {
  if (
    !Number.isInteger(maxRows) ||
    maxRows < 1 ||
    maxRows > 50001 ||
    !Number.isInteger(maxChars) ||
    maxChars < 1 ||
    maxChars > 2000000
  )
    throw new TypeError("Invalid spreadsheet extraction limits");
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(file, {
    entries: "emit",
    sharedStrings: "cache",
    hyperlinks: "ignore",
    worksheets: "emit",
  });
  const lines = [],
    sheets = [];
  let rows = 0,
    chars = 0,
    header = null,
    cachedFormulaCells = 0,
    worksheetCount = 0;
  const result = (truncated) => ({
    text: lines.join("\n"),
    rows,
    truncated,
    sheets,
    cachedFormulaCells,
    formulaResults: "cached_not_recalculated",
  });
  for await (const worksheet of workbook) {
    let sheetRows = 0,
      sheetHeader = null;
    if (++worksheetCount > 20)
      throw Object.assign(
        new Error("Workbooks support at most 20 worksheets."),
        { code: "DATASET_SHEETS_LIMIT" },
      );
    const metadata = {
      name: worksheet.name,
      index: sheets.length + 1,
      rows: 0,
      startRow: rows,
    };
    for await (const row of worksheet) {
      if (row.values.length > 101)
        throw Object.assign(
          new Error("Datasets support at most 100 columns."),
          { code: "DATASET_COLUMNS" },
        );
      const values = Array.from(
        { length: Math.max(0, row.values.length - 1) },
        (_, i) => cellValue(row.values[i + 1]),
      );
      if (values.every((value) => value.trim() === "")) continue;
      const isHeader = !sheetHeader;
      if (!sheetHeader) {
        sheetHeader = values;
        if (header && JSON.stringify(header) !== JSON.stringify(sheetHeader))
          throw Object.assign(
            new Error(
              "Worksheets have different column headers. Export each sheet as a separate dataset.",
            ),
            { code: "DATASET_SHEET_SCHEMA" },
          );
        sheets.push(metadata);
        if (header) continue;
        header = sheetHeader;
      }
      if (rows >= maxRows) return result(true);
      for (const cell of row.values.slice(1))
        if (
          cell &&
          typeof cell === "object" &&
          ("formula" in cell || "sharedFormula" in cell)
        )
          cachedFormulaCells++;
      const line = values
        .map((value) =>
          preserveNumeric && /^[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value)
            ? value
            : csvCell(value),
        )
        .join(",");
      const additional = line.length + (lines.length ? 1 : 0);
      if (chars + additional > maxChars) return result(true);
      lines.push(line);
      rows++;
      chars += additional;
      if (!isHeader) sheetRows++;
      metadata.rows = sheetRows;
      metadata.endRow = rows;
    }
  }
  return result(false);
}
