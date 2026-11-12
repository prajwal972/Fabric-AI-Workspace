import test from "node:test";
import assert from "node:assert/strict";
import { chartGeometry, renderAnalystChart } from "../public/analyst-charts.js";
import {
  parseDatasetFile,
  buildSemanticModel,
  planVisuals,
} from "../src/analyst/engine.mjs";
const chart = (type = "bar", values = [-20, 0, 40]) => ({
  type,
  labels: ["A", "B", "C"],
  values,
  aggregation: "sum",
});
test("bar and line charts preserve negative values around a zero baseline", () => {
  for (const type of ["bar", "line", "area"]) {
    const g = chartGeometry(chart(type));
    assert.ok(g.points[0].y > g.zeroY);
    assert.equal(g.points[1].y, g.zeroY);
    assert.ok(g.points[2].y < g.zeroY);
    assert.match(renderAnalystChart(chart(type)), /data-value="-20"/);
  }
});
test("scatter positions use actual X and Y rather than row indices or absolute values", () => {
  const c = { ...chart("scatter"), xValues: [1, 10, 100] };
  const g = chartGeometry(c);
  assert.ok(g.points[1].x - g.points[0].x < g.points[2].x - g.points[1].x);
  assert.ok(g.points[0].y > g.points[2].y);
  assert.match(renderAnalystChart(c), /data-x="100"/);
});
test("legacy scatter without X data fails visibly instead of fabricating coordinates", () => {
  assert.match(renderAnalystChart(chart("scatter")), /Regenerate this chart/);
});
test("missing line values produce separate segments and are never coerced to zero", () => {
  const html = renderAnalystChart(chart("line", [1, null, 3]));
  assert.equal((html.match(/<polyline/g) || []).length, 2);
  assert.equal((html.match(/<circle/g) || []).length, 2);
  assert.match(html, /Missing values are not plotted as zero/);
});
test("mismatched and nonfinite chart data is rejected before rendering", () => {
  for (const c of [
    { ...chart(), labels: ["a"] },
    chart("bar", [Infinity, 0, 1]),
    chart("bar", ["10", 0, 1]),
  ])
    assert.ok(chartGeometry(c).error);
});
test("pie rejects partial, negative, missing and mean series rather than inventing proportions", () => {
  for (const c of [
    chart("pie"),
    chart("pie", [1, null, 3]),
    { ...chart("pie", [1, 2, 3]), aggregation: "average" },
    {
      type: "pie",
      aggregation: "count",
      labels: Array(13).fill("a"),
      values: Array(13).fill(1),
    },
  ]) {
    const html = renderAnalystChart(c);
    assert.match(html, /Showing values instead/);
    assert.doesNotMatch(html, /stroke-dasharray/);
  }
});
test("complete nonnegative pie has proportions and does not mutate histogram type", () => {
  assert.match(renderAnalystChart(chart("pie", [1, 2, 3])), /stroke-dasharray/);
  const c = chart("histogram", [1, 2, 3]);
  renderAnalystChart(c);
  assert.equal(c.type, "histogram");
});
test("renderer escapes labels and discloses bounded rendering and single-series fallbacks", () => {
  const c = {
    type: "bar",
    labels: Array(20).fill("<img onerror=alert(1)>"),
    values: Array(20).fill(1),
  };
  const html = renderAnalystChart(c);
  assert.match(html, /Showing the first 12 of 20/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.match(
    renderAnalystChart(chart("stacked-bar")),
    /not a fabricated stack/,
  );
  assert.match(renderAnalystChart(chart("heatmap")), /not a two-dimensional/);
  assert.match(renderAnalystChart(chart("heatmap")), /class="visual-heatmap"/);
  assert.match(renderAnalystChart(chart("heatmap")), /<b>-20<\/b>/);
});
test("signed horizontal bars use a real zero baseline and extreme finite scales remain finite", () => {
  assert.match(renderAnalystChart(chart("horizontal-bar")), /data-zero-x/);
  const g = chartGeometry(chart("bar", [-1e308, 0, 1e308]));
  assert.ok(g.points.every((p) => Number.isFinite(p.y)));
});
test("date-based line X positions reflect missing periods without inventing rows", () => {
  const g = chartGeometry({
    type: "line",
    labels: ["2026-01-01", "2026-02-01", "2026-06-01"],
    values: [10, 20, 30],
  });
  assert.equal(g.timeSpacing, true);
  assert.ok(g.points[1].x - g.points[0].x < g.points[2].x - g.points[1].x);
  assert.equal(g.points.length, 3);
});
test("deterministic engine retains numeric scatter coordinates and explicit first-pair sampling", () => {
  const file = {
    id: "f",
    name: "data.csv",
    text:
      "Region,X,Y\n" +
      Array.from(
        { length: 205 },
        (_, i) => "A," + (i + 2) + "," + (i - 10),
      ).join("\n"),
  };
  const rows = parseDatasetFile(file),
    model = buildSemanticModel(rows, "f");
  const c = planVisuals(rows, model).find((v) => v.type === "scatter");
  assert.equal(c.xValues.length, 200);
  assert.equal(c.xValues[0], 2);
  assert.equal(c.values[0], -10);
  assert.equal(c.sampling.sourcePoints, 205);
  assert.equal(c.sampling.truncated, true);
  assert.match(renderAnalystChart(c), /200 of 205 valid pairs/);
});

test("constant-axis correlation is undefined, not a fabricated zero correlation", () => {
  const file = { id: "f", name: "data.csv", text: "X,Y\n5,2\n5,4\n5,6" };
  const rows = parseDatasetFile(file);
  const c = planVisuals(rows, buildSemanticModel(rows, "f")).find(
    (v) => v.type === "scatter",
  );
  assert.match(c.explanation.key, /zero variance/);
  assert.doesNotMatch(c.explanation.key, /correlation is 0/);
});

test("SVG axes are unfilled strokes and never close into a data-obscuring triangle", () => {
  const html = renderAnalystChart({
    ...chart("scatter"),
    xValues: [1, 10, 100],
  });
  for (const axis of html.match(/<path[^>]*class="chart-axis"[^>]*>/g) || [])
    assert.match(axis, /fill="none"/);
  assert.ok((html.match(/class="chart-axis"/g) || []).length > 0);
  assert.match(html, /data-axis-value="-20"/);
});
