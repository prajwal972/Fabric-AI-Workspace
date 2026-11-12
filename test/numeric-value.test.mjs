import test from "node:test";
import assert from "node:assert/strict";
import { analystNumber } from "../src/analytics/numeric-value.mjs";
import { executePlan } from "../src/services/analyst.mjs";
import { buildSemanticModel, executeAnalyst } from "../src/analyst/engine.mjs";
const csv = (text) => ({ id: "f", name: "data.csv", text, status: "ready" });
test("deterministic numeric conversion preserves exponents, accounting, currencies and percentage fractions", () => {
  for (const [input, expected] of [
    ["1.25e2", 125],
    ["-2.5e-1", -0.25],
    ["(₹ 1,23,456.78)", -123456.78],
    ["$1,234.5", 1234.5],
    ["-$1,234", -1234],
    ["20%", 0.2],
    [".5", 0.5],
    ["00012.50", 12.5],
    ["+12", 12],
  ])
    assert.equal(analystNumber(input, { strict: true }), expected, input);
});
test("ambiguous grouping, embedded currencies, hex, booleans and invalid signs are not numerical evidence", () => {
  for (const input of [
    "1,23",
    "1,234,56",
    "12 34",
    "1$23",
    "0x10",
    "(-3)",
    "(3)%",
    "12%%",
    "1.2.3",
    true,
    false,
    {},
    "",
    null,
  ])
    assert.equal(analystNumber(input), null, String(input));
});
test("precision loss never becomes a valid numeric measure; selected calculations fail explicitly", () => {
  for (const token of ["9007199254740993", "0.10000000000000001", "1e309"]) {
    assert.equal(analystNumber(token), null);
    assert.throws(
      () =>
        executePlan([csv("Value\n" + token)], {
          action: "sum",
          columns: ["Value"],
        }),
      (error) => ["NUMERIC_RANGE", "NUMERIC_PRECISION"].includes(error.code),
    );
  }
});
test("scientific numeric strings agree between deterministic tool and preserved dashboard engine", () => {
  const file = csv("Region,Revenue\nA,1.25e2\nB,-2.5e-1");
  assert.equal(
    executePlan([file], { action: "sum", columns: ["Revenue"] }).value,
    124.75,
  );
  const model = buildSemanticModel([
    { Revenue: "1.25e2" },
    { Revenue: "-2.5e-1" },
  ]);
  assert.equal(model.columns[0].physicalType, "number");
  const result = executeAnalyst({ query: "create a dashboard", files: [file] });
  assert.ok(result.dashboard.kpis.some((kpi) => kpi.rawValue === 124.75));
  assert.equal(result.dashboard.kpis.find(kpi=>kpi.rawValue===124.75).value,"$124.75");
});
test("unsafe identifier strings remain grouping labels and row counts, not rounded numbers", () => {
  const file = csv("ID,Value\n9007199254740993,2\n9007199254740994,3");
  assert.equal(executePlan([file], { action: "count", columns: [] }).value, 2);
  const groups = executePlan([file], {
    action: "group",
    columns: ["ID", "Value"],
    aggregation: "sum",
  });
  assert.deepEqual(
    groups.value.map((row) => row.label),
    ["9007199254740993", "9007199254740994"],
  );
});

test("selected count still counts valid numeric observations while unselected count counts all rows", () => {
  const file = csv("Value\n2\nmissing\n3");
  assert.equal(
    executePlan([file], { action: "count", columns: ["Value"] }).value,
    2,
  );
  assert.equal(executePlan([file], { action: "count", columns: [] }).value, 3);
});
test("percentage underflow and malformed repeated decimal points cannot produce false numeric values", () => {
  assert.throws(() => analystNumber("5e-324%", { strict: true }), {
    code: "NUMERIC_PRECISION",
  });
  assert.equal(analystNumber("5e-324%"), null);
  assert.equal(analystNumber("1.2.3", { strict: true }), null);
});
