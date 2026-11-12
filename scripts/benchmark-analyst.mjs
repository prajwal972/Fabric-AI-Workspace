import { performance } from "node:perf_hooks";
import {
  parseDatasetFile,
  buildSemanticModel,
  createDashboard,
} from "../src/analyst/engine.mjs";
import { executePlan } from "../src/services/analyst.mjs";
import { renderAnalystChart } from "../public/analyst-charts.js";
const rows = Number(process.env.FABRIC_ANALYST_BENCH_ROWS || 10000);
if (!Number.isInteger(rows) || rows < 1 || rows > 50000)
  throw new Error("Use between 1 and 50,000 synthetic rows.");
let expected = 0;
const text =
  "Region,Revenue,X,Y\n" +
  Array.from({ length: rows }, (_, i) => {
    const value = (i % 100) + 1;
    expected += value;
    return "R" + (i % 5) + "," + value + "," + (i + 2) + "," + ((i % 101) - 50);
  }).join("\n");
const file = {
  id: "synthetic-benchmark",
  name: "synthetic.csv",
  kind: "text",
  text,
  status: "ready",
};
const measure = (fn) => {
  const start = performance.now();
  const value = fn();
  return { ms: Number((performance.now() - start).toFixed(3)), value };
};
const trials = [];
let actualSum;
for (let i = 0; i < 3; i++) {
  const parsed = measure(() => parseDatasetFile(file));
  const summed = measure(() =>
    executePlan([file], { action: "sum", columns: ["Revenue"] }),
  );
  if (parsed.value.length !== rows || summed.value.value !== expected)
    throw new Error("Benchmark calculation correctness failed.");
  actualSum = summed.value.value;
  const dashboard = measure(() =>
    createDashboard(
      parsed.value,
      buildSemanticModel(parsed.value, "synthetic-benchmark"),
    ),
  );
  const rendered = measure(() =>
    dashboard.value.visuals.map(renderAnalystChart),
  );
  trials.push({
    parseMs: parsed.ms,
    deterministicSumMs: summed.ms,
    modelAndDashboardMs: dashboard.ms,
    chartHtmlMs: rendered.ms,
    visuals: dashboard.value.visuals.length,
  });
}
console.log(
  JSON.stringify(
    {
      scope:
        "Synthetic local CPU microbenchmark; no database, queue, live model or capacity certification.",
      platform: process.platform,
      node: process.version,
      rows,
      inputBytes: Buffer.byteLength(text),
      expectedSum: expected,
      actualSum,
      correctnessVerified: true,
      trials,
    },
    null,
    2,
  ),
);
