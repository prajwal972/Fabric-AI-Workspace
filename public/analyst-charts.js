export const chartTypes = Object.freeze([
  "bar",
  "horizontal-bar",
  "stacked-bar",
  "line",
  "area",
  "pie",
  "scatter",
  "histogram",
  "heatmap",
  "table",
]);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const colors = [
  "#5fd7ff",
  "#8b7cff",
  "#43e6aa",
  "#ffbf69",
  "#ff7697",
  "#7ed8ff",
  "#b8ff6a",
  "#d79bff",
];
const notice = (text) =>
  '<p class="meta chart-validation" role="status">' + esc(text) + "</p>";
function scale(values, zero = false) {
  const lo = Math.min(...values, ...(zero ? [0] : [])),
    hi = Math.max(...values, ...(zero ? [0] : []));
  const k = Math.max(Math.abs(lo), Math.abs(hi), 1);
  return (value) =>
    hi === lo ? 0.5 : (value / k - lo / k) / (hi / k - lo / k);
}
export function chartGeometry(chart) {
  const labels = chart?.labels,
    values = chart?.values;
  if (
    !Array.isArray(labels) ||
    !Array.isArray(values) ||
    labels.length !== values.length ||
    labels.length > 2000
  )
    return {
      error: "Chart labels and values must match within supported limits.",
    };
  if (
    values.some(
      (v) => v !== null && (typeof v !== "number" || !Number.isFinite(v)),
    )
  )
    return {
      error:
        "Chart contains unsupported numerical values. No invalid values were converted to zero.",
    };
  if (!values.some((v) => v !== null))
    return { error: "No valid numerical observations are available." };
  if (!chartTypes.includes(chart.type || "bar"))
    return {
      error:
        "This chart type is not supported. No substitute chart was fabricated.",
    };
  const type = chart.type || "bar",
    limit =
      type === "scatter" ? 200 : ["line", "area"].includes(type) ? 60 : 12;
  if (
    type === "scatter" &&
    (!Array.isArray(chart.xValues) ||
      chart.xValues.length !== values.length ||
      chart.xValues.some((v) => typeof v !== "number" || !Number.isFinite(v)))
  )
    return {
      error:
        "Scatter X coordinates are unavailable. Regenerate this chart; row positions are not numerical X values.",
    };
  const shown = values.slice(0, limit),
    yScale = scale(
      values.filter((v) => v !== null),
      type !== "scatter",
    ),
    zeroY = 180 - yScale(0) * 155;
  const xValues =
    type === "scatter"
      ? chart.xValues
      : labels.map((label, i) =>
          /^\d{4}-\d{2}(?:-\d{2}(?:T.*)?)?$/.test(String(label)) &&
          Number.isFinite(Date.parse(label))
            ? Date.parse(label)
            : i,
        );
  const timeSpacing =
    type !== "scatter" &&
    labels.length > 1 &&
    labels.every(
      (label) =>
        /^\d{4}-\d{2}(?:-\d{2}(?:T.*)?)?$/.test(String(label)) &&
        Number.isFinite(Date.parse(label)),
    );
  const xScale = scale(
    type === "scatter" || timeSpacing ? xValues : shown.map((_, i) => i),
  );
  return {
    type,
    zeroY,
    zeroX:
      30 +
      scale(
        values.filter((v) => v !== null),
        true,
      )(0) *
        500,
    values: shown,
    labels: labels.slice(0, limit),
    total: values.length,
    truncated: values.length > limit,
    timeSpacing,
    points: shown.map((v, i) => ({
      index: i,
      value: v,
      label: labels[i],
      x: 30 + xScale(type === "scatter" || timeSpacing ? xValues[i] : i) * 500,
      y: v === null ? null : 180 - yScale(v) * 155,
      rawX: type === "scatter" ? xValues[i] : null,
    })),
    xScale: scale(
      values.filter((v) => v !== null),
      true,
    ),
  };
}
export function renderAnalystChart(chart) {
  const g = chartGeometry(chart);
  if (g.error) return notice(g.error);
  const { points, values, labels, type } = g;
  const notes = [];
  if (g.truncated)
    notes.push(
      "Showing the first " +
        points.length +
        " of " +
        g.total +
        " supplied observations.",
    );
  if (chart.sampling?.truncated)
    notes.push(
      "The server sampled " +
        chart.sampling.displayedPoints +
        " of " +
        chart.sampling.sourcePoints +
        " valid pairs using " +
        chart.sampling.method +
        ".",
    );
  if (values.includes(null))
    notes.push("Missing values are not plotted as zero.");
  const note = () => notes.map(notice).join("");
  const table = () =>
    '<div class="visual-table">' +
    labels
      .map(
        (label, i) =>
          "<div><span>" +
          esc(label) +
          "</span><b>" +
          esc(values[i] ?? "Missing") +
          "</b></div>",
      )
      .join("") +
    "</div>" +
    note();
  if (type === "table") return table();
  if (type === "heatmap") {
    notes.push(
      "Single-series value grid, not a two-dimensional correlation heatmap. Color intensity uses magnitude; signed values are shown.",
    );
    const max = Math.max(...values.filter((v) => v !== null).map(Math.abs), 1);
    return (
      '<div class="visual-heatmap">' +
      labels
        .map(
          (label, i) =>
            '<div class="heat-level-' +
            (values[i] === null
              ? 1
              : Math.min(
                  10,
                  Math.max(1, Math.ceil((Math.abs(values[i]) / max) * 10)),
                )) +
            '"><span>' +
            esc(label) +
            "</span><b>" +
            esc(values[i] ?? "Missing") +
            "</b></div>",
        )
        .join("") +
      "</div>" +
      note()
    );
  }
  if (type === "pie") {
    if (
      g.truncated ||
      values.some((v) => v === null || v < 0) ||
      !["sum", "count"].includes(chart.aggregation)
    ) {
      notes.push(
        "A pie requires a complete nonnegative count or sum series. Showing values instead.",
      );
      return table();
    }
    const k = Math.max(...values, 1),
      total = values.reduce((s, v) => s + v / k, 0);
    if (!total) return notice("All values are zero; no pie proportions exist.");
    let offset = 0;
    const segments = values.map((v, i) => {
      const part = (v / k / total) * 100;
      const segment =
        '<circle cx="72" cy="72" r="52" fill="none" stroke="' +
        colors[i % colors.length] +
        '" stroke-width="24" pathLength="100" stroke-dasharray="' +
        part.toFixed(4) +
        " " +
        (100 - part).toFixed(4) +
        '" stroke-dashoffset="' +
        (-offset).toFixed(4) +
        '" transform="rotate(-90 72 72)"><title>' +
        esc(labels[i]) +
        ": " +
        esc(v) +
        "</title></circle>";
      offset += part;
      return segment;
    });
    return (
      '<div class="chart-body pie-layout"><svg class="analyst-svg donut" viewBox="0 0 144 144" role="img" aria-label="' +
      esc(chart.title || chart.purpose || "Pie chart") +
      '">' +
      segments.join("") +
      '</svg><div class="chart-legend">' +
      labels
        .map(
          (label, i) =>
            "<div><span>" +
            esc(label) +
            "</span><b>" +
            esc(values[i]) +
            "</b></div>",
        )
        .join("") +
      "</div></div>" +
      note()
    );
  }
  if (type === "stacked-bar")
    notes.push(
      "Only one series is available; shown as signed bars, not a fabricated stack.",
    );
  let body = "";
  const valid = chart.values.filter((v) => v !== null),
    domain = type === "scatter" ? valid : [...valid, 0],
    ys = scale(domain),
    yMin = Math.min(...domain),
    yMax = Math.max(...domain);
  const axisNumber = (v) =>
    Math.abs(v) >= 10000
      ? v.toExponential(2)
      : String(Number(v.toPrecision(4)));
  const ticks = [
    ...new Set([yMin, ...(yMin <= 0 && yMax >= 0 ? [0] : []), yMax]),
  ]
    .map(
      (v) =>
        '<text x="2" y="' +
        (183 - ys(v) * 155).toFixed(2) +
        '" fill="#aeb9c6" font-size="14" data-axis-value="' +
        v +
        '">' +
        esc(axisNumber(v)) +
        "</text>",
    )
    .join("");

  const circle = (p) =>
    p.y === null
      ? ""
      : '<circle data-point-index="' +
        p.index +
        '" data-x="' +
        esc(p.rawX ?? p.index) +
        '" data-value="' +
        p.value +
        '" cx="' +
        p.x.toFixed(2) +
        '" cy="' +
        p.y.toFixed(2) +
        '" r="5" fill="' +
        colors[p.index % colors.length] +
        '"><title>' +
        esc(p.label) +
        ": " +
        (p.rawX !== null ? "X=" + esc(p.rawX) + ", Y=" : "") +
        esc(p.value) +
        "</title></circle>";
  if (type === "scatter") {
    body =
      '<path d="M30 25V180H530" class="chart-axis" fill="none" stroke="#738191" stroke-width="1"/>' +
      points.map(circle).join("");
    const xs = scale(chart.xValues);
    body += [
      ...new Set([Math.min(...chart.xValues), Math.max(...chart.xValues)]),
    ]
      .map(
        (v) =>
          '<text x="' +
          (30 + xs(v) * 500).toFixed(2) +
          '" y="198" text-anchor="middle" fill="#aeb9c6" font-size="14">' +
          esc(axisNumber(v)) +
          "</text>",
      )
      .join("");
  } else if (type === "line" || type === "area") {
    notes.push(
      g.timeSpacing
        ? "X spacing follows the actual supplied dates."
        : "X spacing represents categories, not elapsed time.",
    );
    const segments = [];
    let segment = [];
    for (const p of points) {
      if (p.y === null) {
        if (segment.length) segments.push(segment);
        segment = [];
      } else segment.push(p);
    }
    if (segment.length) segments.push(segment);
    body =
      '<path data-zero-y="' +
      g.zeroY.toFixed(2) +
      '" d="M30 ' +
      g.zeroY.toFixed(2) +
      'H530" class="chart-axis" fill="none" stroke="#738191" stroke-width="1"/>' +
      segments
        .map((s) => {
          const pts = s
            .map((p) => p.x.toFixed(2) + "," + p.y.toFixed(2))
            .join(" ");
          return (
            (type === "area"
              ? '<polygon points="' +
                s[0].x.toFixed(2) +
                "," +
                g.zeroY.toFixed(2) +
                " " +
                pts +
                " " +
                s.at(-1).x.toFixed(2) +
                "," +
                g.zeroY.toFixed(2) +
                '" class="chart-area"/>'
              : "") +
            '<polyline points="' +
            pts +
            '" class="chart-line"/>'
          );
        })
        .join("") +
      points.map(circle).join("");
  } else if (type === "horizontal-bar") {
    const height = Math.min(18, 150 / points.length);
    body =
      '<path data-zero-x="' +
      g.zeroX.toFixed(2) +
      '" d="M' +
      g.zeroX.toFixed(2) +
      ' 20V185" class="chart-axis" fill="none" stroke="#738191" stroke-width="1"/>' +
      points
        .filter((p) => p.y !== null)
        .map((p) => {
          const endpoint = 30 + g.xScale(p.value) * 500;
          return (
            '<rect data-value="' +
            p.value +
            '" x="' +
            Math.min(g.zeroX, endpoint).toFixed(2) +
            '" y="' +
            (25 + (p.index * 150) / points.length).toFixed(2) +
            '" width="' +
            Math.abs(endpoint - g.zeroX).toFixed(2) +
            '" height="' +
            height.toFixed(2) +
            '" rx="3" fill="' +
            colors[p.index % colors.length] +
            '"><title>' +
            esc(p.label) +
            ": " +
            esc(p.value) +
            "</title></rect>"
          );
        })
        .join("");
  } else {
    const width = 500 / points.length;
    body =
      '<path data-zero-y="' +
      g.zeroY.toFixed(2) +
      '" d="M30 ' +
      g.zeroY.toFixed(2) +
      'H530" class="chart-axis" fill="none" stroke="#738191" stroke-width="1"/>' +
      points
        .filter((p) => p.y !== null)
        .map(
          (p) =>
            '<rect data-value="' +
            p.value +
            '" x="' +
            (30 + p.index * width + 3).toFixed(2) +
            '" y="' +
            Math.min(g.zeroY, p.y).toFixed(2) +
            '" width="' +
            Math.max(1, width - 6).toFixed(2) +
            '" height="' +
            Math.abs(g.zeroY - p.y).toFixed(2) +
            '" rx="3" fill="' +
            colors[p.index % colors.length] +
            '"><title>' +
            esc(p.label) +
            ": " +
            esc(p.value) +
            "</title></rect>",
        )
        .join("");
  }
  return (
    '<div class="chart-body"><svg class="analyst-svg" viewBox="0 0 560 210" role="img" aria-label="' +
    esc(chart.title || chart.purpose || type + " chart") +
    '">' +
    body +
    (type === "horizontal-bar" ? "" : ticks) +
    "</svg>" +
    (type === "scatter"
      ? ""
      : '<div class="axis-labels">' +
        labels.map((label) => "<span>" + esc(label) + "</span>").join("") +
        "</div>") +
    "</div>" +
    note()
  );
}
