import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDatasetFile,
  loadRows,
  executeAnalyst,
} from "../src/analyst/engine.mjs";
import { executePlan } from "../src/services/analyst.mjs";
const csv = (text) => ({
  id: "f",
  name: "data.csv",
  kind: "text",
  text,
  status: "ready",
});
test("CSV quoted multiline fields, escaped quotes, commas and CRLF preserve logical rows", () => {
  const file = csv(
    '\uFEFFName,Revenue,Note\r\nWest,50,"first\r\nsecond, \"\"quoted\"\""\r\nEast,-20," padded "\r\n',
  );
  const rows = parseDatasetFile(file);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Note, 'first\nsecond, "quoted"');
  assert.equal(rows[1].Note, " padded ");
  assert.equal(
    executePlan([file], { action: "sum", columns: ["Revenue"] }).value,
    30,
  );
});
test("TSV, semicolon and pipe inference ignores delimiters inside quoted headers", () => {
  for (const delimiter of ["\t", ";", "|"]) {
    const rows = parseDatasetFile(
      csv('"Label,Quoted"' + delimiter + "Value\nA" + delimiter + "4"),
    );
    assert.deepEqual(rows, [{ "Label,Quoted": "A", Value: "4" }]);
  }
});
test("explicit single-column CSV is a dataset, not unsupported prose", () => {
  const file = csv("Value\n10\n20\n");
  assert.equal(
    executePlan([file], { action: "sum", columns: ["Value"] }).value,
    30,
  );
  assert.deepEqual(
    parseDatasetFile({ name: "notes.txt", text: "Plain prose\nMore prose" }),
    [],
  );
});
test("blank lines are ignored but real empty/missing fields remain observable", () => {
  const rows = parseDatasetFile(csv("\nA,B\n\n1,\n2\n,\n"));
  assert.deepEqual(rows, [
    { A: "1", B: "" },
    { A: "2", B: "" },
    { A: "", B: "" },
  ]);
});
test("malformed quotes and excess row fields are rejected, not silently repaired", () => {
  for (const text of ['A,B\n"missing,2', 'A,B\n"a"junk,2', 'A,B\nx"a",2'])
    assert.throws(() => parseDatasetFile(csv(text)), {
      code: "DATASET_CSV_INVALID",
    });
  assert.throws(() => parseDatasetFile(csv("A,B\n1,2,3")), {
    code: "DATASET_CSV_WIDTH",
  });
});
test("duplicate, reserved and oversized column labels fail safely without exposing data", () => {
  for (const header of [
    "A,A",
    "__proto__,B",
    "constructor,B",
    "__sourceId,B",
    "x".repeat(501) + ",B",
  ])
    assert.throws(() => parseDatasetFile(csv(header + "\n1,2")), {
      code: "DATASET_COLUMNS",
    });
  assert.throws(
    () =>
      parseDatasetFile(
        csv(
          Array.from({ length: 101 }, (_, i) => "C" + i).join(",") +
            "\n" +
            Array(101).fill(1).join(","),
        ),
      ),
    { code: "DATASET_COLUMNS" },
  );
});
test("exact row boundary works while oversized individual or combined files fail", () => {
  assert.equal(parseDatasetFile(csv("A,B\n1,2\n3,4"), 2).length, 2);
  assert.throws(() => parseDatasetFile(csv("A,B\n1,2\n3,4\n5,6"), 2), {
    code: "DATASET_ROW_LIMIT",
  });
  assert.throws(
    () => loadRows([csv("A,B\n1,2\n3,4"), { ...csv("A,B\n5,6"), id: "g" }], 2),
    { code: "DATASET_ROW_LIMIT" },
  );
  assert.throws(() => parseDatasetFile(csv("x".repeat(2000001))), {
    code: "DATASET_TOO_LARGE",
  });
});
test("JSON and JSONL typed flat records retain values and enforce valid shape", () => {
  for (const file of [
    { name: "data.json", text: '[{"X":1,"Y":null},{"X":-2,"Y":true}]' },
    { name: "data.jsonl", text: '{"X":1,"Y":null}\n{"X":-2,"Y":true}\n' },
  ])
    assert.deepEqual(parseDatasetFile(file), [
      { X: 1, Y: null },
      { X: -2, Y: true },
    ]);
  for (const text of [
    "[1,2]",
    '[{"nested":{"x":1}}]',
    '[{"x":[1]}]',
    "invalid",
  ])
    assert.throws(() => parseDatasetFile({ name: "data.json", text }));
  assert.throws(
    () => parseDatasetFile({ name: "data.json", text: '[{"x":1e999}]' }),
    { code: "NUMERIC_RANGE" },
  );
  assert.throws(
    () =>
      parseDatasetFile({ name: "data.json", text: '[{"__proto__":"unsafe"}]' }),
    { code: "DATASET_COLUMNS" },
  );
});
test("parsed row metadata remains bound to original files and dashboard calculations remain deterministic", () => {
  const file = csv('Region,Revenue,Note\nWest,50,"one\ntwo"\nEast,70,three');
  const rows = loadRows([file]);
  assert.equal(rows[0].__sourceFile, "data.csv");
  assert.equal(rows[0].__sourceId, "f");
  const result = executeAnalyst({ files: [file], query: "create a dashboard" });
  assert.equal(
    result.dashboard.kpis.find((k) => k.id === "record_count").rawValue,
    2,
  );
  assert.equal(
    result.dashboard.kpis.find((k) => k.id === "total_revenue").rawValue,
    120,
  );
});

test("explicit percentage strings are ratios, not one-hundred-fold inflated dashboard values", () => {
  const file = csv("Region,Margin\nWest,20%\nEast,40%");
  const result = executePlan([file], { action: "mean", columns: ["Margin"] });
  assert.ok(Math.abs(result.value - 0.3) < 1e-12);
  assert.equal(result.provenance.percentStrings, "fraction");
  const dashboard = executeAnalyst({
    files: [file],
    query: "create a dashboard",
  }).dashboard;
  const metric = dashboard.metrics.find(
    (m) =>
      m.columns?.includes("Margin") || m.name.toLowerCase().includes("margin"),
  );
  assert.ok(metric);
  assert.ok(Math.abs(metric.rawValue - 0.3) < 1e-12);
  assert.match(metric.value, /30/);
  assert.doesNotMatch(metric.value, /3,?000/);
});

test("combined sources reject duplicate IDs and excessive column unions instead of silently dropping columns", () => {
  const a = csv("A,B\n1,2");
  assert.throws(() => loadRows([a, a]), { code: "DATASET_DUPLICATE_SOURCE" });
  const file = (prefix, id) => ({
    id,
    name: "columns.csv",
    text:
      Array.from({ length: 60 }, (_, i) => prefix + i).join(",") +
      "\n" +
      Array(60).fill(1).join(","),
  });
  assert.throws(() => loadRows([file("A", "a"), file("B", "b")]), {
    code: "DATASET_COLUMNS",
  });
});
