# Fabric Data Analyst Agent

## Architecture

The Data Analyst is embedded in Fabric's existing Agents area. `src/analyst/engine.mjs` is a dependency-free deterministic analytics domain module; `src/server.mjs` remains the authenticated workspace/API boundary; `public/app.js` and `public/analyst-bi.css` extend the existing framework-free glass UI.

Provider models may assist other Fabric features, but they are never the source of KPI or chart values. Parsed rows plus declared aggregations are the numerical source of truth.

## Local-first workflow

1. Classify the conversational or structured operation.
2. Parse and profile selected workspace files.
3. Build column metadata and a semantic model.
4. Apply safe transformations to a copy, preserving uploaded rows.
5. Generate supported analytical questions and a story plan.
6. Calculate metrics, groups, distributions, correlations, and anomalies deterministically.
7. Select a small set of purposeful visuals.
8. Attach formulas, source columns, filter context, row counts, and timestamps as provenance.
9. Validate and return only the pipeline stages that ran.
10. Persist conversation, filters, transformations, active dashboard, versions, and undo snapshots per workspace.

## Semantic model

Each field records `physicalType`, `semanticType`, `role`, cardinality, missing count/percentage, unique count, samples, numeric distribution or top values, proposed aggregation, display format, and relationship hints. Roles include identifier, time dimension, dimension/location, demographic, financial measure, measure, outcome, category, and text. Domain plans cover customer, sales, finance, and general data.

## Metric/provenance contract

```json
{
  "id": "average_salary",
  "name": "Average Salary",
  "value": "$65,333",
  "rawValue": 65333.3333,
  "format": "currency",
  "expression": "avg(Salary)",
  "aggregation": "average",
  "sourceColumns": ["Salary"],
  "semanticMeaning": "Average financial value",
  "provenance": {
    "datasetId": "customers",
    "sourceColumns": ["Salary"],
    "aggregation": "average",
    "filters": {},
    "rowsIncluded": 9,
    "expression": "avg(Salary)",
    "calculatedAt": "ISO-8601 timestamp"
  }
}
```

## Dashboard schema

A dashboard contains `id`, `title`, `datasetId`, `version`, timestamps, `story`, `filters`, the full `metrics` catalog, selected `kpis`, `visuals` (plus compatibility alias `charts`), responsive `layout`, evidence-backed `insights`, `dataQuality`, filtered `details`, and the `semanticModel`.

Every visual records its analytical question, purpose, type, dimensions, measures, aggregation, labels/values, explanation, and provenance.

## API and operation contracts

- `POST /api/agents/data-profile` — semantic profile and initial row/information tables.
- `POST /api/agents/data-analyst` — natural-language deterministic analysis.
- `GET /api/agents/data-state` — `{ state }`, including the active dashboard and recent conversation.
- `POST /api/agents/dashboard-operation` — structured dashboard operation.

Supported operation families include dashboard create/refresh; clean; add/remove/update metric; add/remove/update/move/resize visual; add/remove/update/apply/clear filter; layout/theme; analysis; insights; explain; and undo. Existing Fabric authentication, CSRF, workspace ownership, upload extraction, rate limits, audit logging, provider system, and JSON persistence remain in place.

## Example customer dashboard

For the tested 10-row `Country, Age, Salary, Purchased` fixture:

- People / Records: **10**
- Average Age: **38.78**
- Average Salary: **$65,333**
- Purchased Rate: **60%**
- Visuals: salary by country, purchased rate by country, age distribution, salary distribution, age versus salary, and records by country
- Story warnings: two missing cells and a small sample

`Total Age` is intentionally not generated.

## Example conversation

> **User:** Create a dashboard.
>
> **Fabric:** Builds a customer story with four meaningful KPIs and six evidence-backed visuals.
>
> **User:** Filter to Germany.
>
> **Fabric:** Recalculates KPIs, story, findings, visuals, and details in the new filter context.
>
> **User:** Explain salary by country.
>
> **Fabric:** Returns what it shows, the finding, why it matters, data used, expression, included rows, and filters.
>
> **User:** Change salary by country to a line chart. Then undo.
>
> **Fabric:** Updates the selected visual and restores the prior version on undo.

## Tests

`test/analyst-engine.test.mjs` covers 21 semantic, calculation, dashboard, filter, cleaning, edit, undo, provenance, sales, finance, time-series, limitation, intent, and pipeline-stage scenarios. Existing API, UI, native runtime, security, plugin, file, and reliability suites are retained and updated. The full suite currently has 78 passing tests.

## Limitations

- CSV, TSV, semicolon/pipe-delimited text, JSON, and JSONL have the strongest structured parsing.
- Excel relies on Fabric's existing extraction pipeline; complex formulas, multiple sheets, and workbook relationships may not preserve a relational table.
- The current engine analyzes one merged logical table; automatic multi-table relationship inference is limited.
- Correlation is association, not causation. Small samples are flagged.
- Forecasts are not fabricated when sufficient history or a time field is absent.
- Local processing is currently capped at 50,000 rows.
- Map visuals and full drill-through are not equivalent to Power BI Desktop.
- There is no `.pbix` or Tableau workbook export; dashboard export is JSON.

## Run and verify

```bash
npm run check
npm test
npm start
```

Open `http://127.0.0.1:8787`, sign in, open **Agents**, select a structured file, inspect the two initial tables, and send **Create a dashboard**. Verify filtering, explain, cleaning, visual changes, export, persistence, and undo.
