import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ExcelJS from "exceljs";
import { extractXlsxBounded } from "../src/files/extractors.mjs";
import { parseFile } from "../src/files/parser-process.mjs";
import { executePlan } from "../src/services/analyst.mjs";
async function workbook(t, sheets) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-xlsx-correct-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const filename = path.join(dir, "sample.xlsx");
  const book = new ExcelJS.Workbook();
  for (const [name, rows] of sheets) {
    const sheet = book.addWorksheet(name);
    for (const row of rows) sheet.addRow(row);
  }
  await book.xlsx.writeFile(filename);
  return filename;
}
test("spreadsheet extraction preserves negative, exponent and multiline values", async (t) => {
  const p = await workbook(t, [
    [
      "Data",
      [
        ["Region", "Revenue", "Note"],
        ["West", -20, "one\ntwo"],
        ["East", 50, '"quoted", note'],
      ],
    ],
  ]);
  const out = await extractXlsxBounded(p);
  assert.equal(out.truncated, false);
  const result = executePlan([{ id: "f", name: "data.xlsx", text: out.text }], {
    action: "sum",
    columns: ["Revenue"],
  });
  assert.equal(result.value, 30);
  assert.equal(result.provenance.rowsIncluded, 2);
  assert.match(out.text, /-20/);
});
test("compatible sheets merge one header with worksheet metadata; incompatible sheets fail explicitly", async (t) => {
  const p = await workbook(t, [
    [
      "Jan",
      [
        ["Region", "Revenue"],
        ["West", 50],
      ],
    ],
    [
      "Feb",
      [
        ["Region", "Revenue"],
        ["East", 70],
      ],
    ],
  ]);
  const out = await extractXlsxBounded(p);
  assert.equal(out.rows, 3);
  assert.equal(out.sheets.length, 2);
  assert.equal(out.text.split("Region,Revenue").length, 2);
  assert.equal(
    executePlan([{ id: "f", name: "data.xlsx", text: out.text }], {
      action: "sum",
      columns: ["Revenue"],
    }).value,
    120,
  );
  const bad = await workbook(t, [
    [
      "A",
      [
        ["Region", "Revenue"],
        ["West", 50],
      ],
    ],
    [
      "B",
      [
        ["Country", "Cost"],
        ["East", 70],
      ],
    ],
  ]);
  await assert.rejects(extractXlsxBounded(bad), {
    code: "DATASET_SHEET_SCHEMA",
  });
});
test("exact spreadsheet row and character limits do not falsely report truncation", async (t) => {
  const p = await workbook(t, [
    [
      "Data",
      [
        ["X", "Y"],
        [1, 2],
        [3, 4],
      ],
    ],
  ]);
  const exact = await extractXlsxBounded(p, { maxRows: 3, maxChars: 11 });
  assert.equal(exact.text, "X,Y\n1,2\n3,4");
  assert.equal(exact.truncated, false);
  assert.equal(
    (await extractXlsxBounded(p, { maxRows: 2, maxChars: 11 })).truncated,
    true,
  );
  assert.equal(
    (await extractXlsxBounded(p, { maxRows: 3, maxChars: 10 })).truncated,
    true,
  );
});
test("formula results are cached values, never executed; missing cached results fail", async (t) => {
  const p = await workbook(t, [
    [
      "Data",
      [
        ["Name", "Amount"],
        ["cached", { formula: "10+20", result: 30 }],
      ],
    ],
  ]);
  const out = await extractXlsxBounded(p);
  assert.equal(out.cachedFormulaCells, 1);
  assert.equal(out.formulaResults, "cached_not_recalculated");
  assert.match(out.text, /cached,30/);
  const bad = await workbook(t, [
    [
      "Data",
      [
        ["Name", "Amount"],
        ["uncached", { formula: "10+20" }],
      ],
    ],
  ]);
  await assert.rejects(extractXlsxBounded(bad), {
    code: "DATASET_FORMULA_CACHE_MISSING",
  });
});
test("formula-like text remains neutralized while extraction limits are validated", async (t) => {
  const p = await workbook(t, [
    [
      "Data",
      [
        ["Name", "Note"],
        ["literal", '=WEBSERVICE("https://example.test")'],
      ],
    ],
  ]);
  assert.match((await extractXlsxBounded(p)).text, /'=WEBSERVICE/);
  await assert.rejects(extractXlsxBounded(p, { maxRows: Infinity }), TypeError);
});

test("parser retains worksheet and cached-formula provenance without claiming recalculation", async (t) => {
  const p = await workbook(t, [
    [
      "Data",
      [
        ["Name", "Amount"],
        ["cached", { formula: "10+20", result: 30 }],
      ],
    ],
  ]);
  const parsed = await parseFile(p, "data.xlsx", "document");
  assert.equal(parsed.pages[0].dataset.cachedFormulaCells, 1);
  assert.equal(
    parsed.pages[0].dataset.formulaResults,
    "cached_not_recalculated",
  );
  assert.equal(parsed.pages[0].dataset.worksheets[0].rows, 1);
  const result = executePlan(
    [{ id: "f", name: "data.xlsx", text: parsed.text, pages: parsed.pages }],
    { action: "sum", columns: ["Amount"] },
  );
  assert.equal(result.provenance.parserVersion, "fabric-dataset-v2");
  assert.equal(
    result.provenance.sourceWorksheets[0].formulaResults,
    "cached_not_recalculated",
  );
});
