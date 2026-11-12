import test from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "../src/tools/gateway.mjs";
import { registerBuiltins } from "../src/tools/builtins.mjs";
import { AnalystService, executePlan } from "../src/services/analyst.mjs";
import { WorkspaceRepository } from "../src/repositories/workspace.mjs";
const actor = { workspaceId: "ws", user: { id: "u" }, role: "owner" };
const file = {
  id: "fil",
  status: "ready",
  kind: "csv",
  name: "data.csv",
  sha256: "a".repeat(64),
  text: "Region,Revenue\nWest,50\nEast,70\nWest,\n",
};
function registry(deps = {}) {
  const r = new ToolRegistry();
  registerBuiltins(r, deps);
  return r;
}
test("analytics tools expose portable native schemas and bounded inputs", () => {
  const r = registry();
  const schemas = r.schemas(actor);
  assert.ok(schemas.find((s) => s.name === "analyze_data"));
  assert.ok(schemas.find((s) => s.name === "list_files"));
  const tool = r.tools.get("analyze_data");
  assert.equal(tool.classification, "READ");
  assert.equal(tool.permission, "analyst.run");
  for (const plan of [
    { action: "dashboard" },
    { action: "sum", columns: ["x".repeat(501)] },
    {
      action: "sum",
      filters: Object.fromEntries(
        Array.from({ length: 21 }, (_, i) => ["c" + i, []]),
      ),
    },
    { action: "sum", code: "arbitrary" },
  ])
    assert.equal(
      tool.input.safeParse({ fileIds: ["fil"], plan }).success,
      false,
    );
  assert.equal(
    r.tools.get("list_files").input.safeParse({ limit: 21 }).success,
    false,
  );
});
test("metadata repository scopes live files and selects no dataset text", async () => {
  let calls = 0;
  const repo = new WorkspaceRepository({
    query: async (sql, params) => {
      calls++;
      assert.doesNotMatch(sql, /SELECT \*|extracted_text|object_key/);
      assert.match(sql, /workspace_id=\$1 AND deleted_at IS NULL/);
      assert.match(sql, /ORDER BY created_at DESC,id DESC/);
      assert.deepEqual(params, ["ws", 3, 4]);
      return {
        rows: [
          { id: "a", name: "a.csv", kind: "csv", status: "ready" },
          { id: "b", name: "b.csv", kind: "csv", status: "queued" },
          { id: "c" },
        ],
      };
    },
  });
  const page = await repo.listFileMetadata("ws", { limit: 2, offset: 4 });
  assert.equal(page.nextOffset, 6);
  assert.equal(page.items.length, 2);
  await assert.rejects(repo.listFileMetadata("ws", { limit: 21 }), {
    code: "VALIDATION_ERROR",
  });
  assert.equal(calls, 1);
  const tool = registry({ files: { repo } }).tools.get("list_files");
  assert.equal(
    tool.output.parse(await tool.handler({ limit: 2, offset: 4 }, { actor }))
      .items.length,
    2,
  );
});
test("analysis tool returns deterministic filtered result and source provenance without AI", async () => {
  const repo = {
    pool: { query: async () => ({ rows: [{ role: "member" }] }) },
    files: {
      require: async (ws, id) => {
        assert.equal(ws, "ws");
        assert.equal(id, "fil");
        return file;
      },
    },
  };
  const analyst = new AnalystService({
    repo,
    ai: {
      generate: () => {
        throw Error("AI must not calculate");
      },
    },
  });
  const tool = registry({ analyst }).tools.get("analyze_data");
  const input = tool.input.parse({
    fileIds: ["fil"],
    plan: {
      action: "sum",
      columns: ["Revenue"],
      filters: { Region: ["West"] },
    },
  });
  const result = tool.output.parse(await tool.handler(input, { actor }));
  assert.equal(result.value, 50);
  assert.equal(result.provenance.rowsIncluded, 2);
  assert.equal(result.provenance.sourceHashes[0].sha256, file.sha256);
  assert.deepEqual(result.provenance.filters, { Region: ["West"] });
});
test("analysis service rechecks revoked membership before reading datasets", async () => {
  let accessed = false;
  const service = new AnalystService({
    repo: {
      pool: { query: async () => ({ rows: [] }) },
      files: {
        require: async () => {
          accessed = true;
          return file;
        },
      },
    },
  });
  await assert.rejects(service.analyze(actor, ["fil"], { action: "count" }), {
    code: "FORBIDDEN",
  });
  assert.equal(accessed, false);
});
test("analysis service refuses processing and cross-tenant datasets", async () => {
  const repo = {
    pool: { query: async () => ({ rows: [{ role: "member" }] }) },
    files: { require: async () => ({ ...file, status: "processing" }) },
  };
  const service = new AnalystService({ repo });
  await assert.rejects(service.analyze(actor, ["fil"], { action: "count" }), {
    code: "FILES_PROCESSING",
  });
  repo.files.require = async () => {
    throw Object.assign(new Error("not found"), { code: "NOT_FOUND" });
  };
  await assert.rejects(service.analyze(actor, ["other"], { action: "count" }), {
    code: "NOT_FOUND",
  });
});
test("grouped counts distinguish records from valid numeric measurements", () => {
  const rows = executePlan([file], {
    action: "group",
    columns: ["Region"],
    aggregation: "count",
  });
  assert.deepEqual(rows.value, [
    { label: "West", value: 2, rows: 2 },
    { label: "East", value: 1, rows: 1 },
  ]);
  assert.equal(rows.provenance.countMode, "record_rows");
  const values = executePlan([file], {
    action: "group",
    columns: ["Region", "Revenue"],
    aggregation: "count",
  });
  assert.equal(values.value[0].value, 1);
  assert.equal(values.provenance.countMode, "valid_numeric_values");
});
test("large grouped outputs explicitly disclose omitted groups", () => {
  const result = executePlan(
    [
      {
        ...file,
        text:
          "Region,Revenue\n" +
          Array.from({ length: 205 }, (_, i) => "R" + i + ",1").join("\n"),
      },
    ],
    { action: "group", columns: ["Region", "Revenue"] },
  );
  assert.equal(result.value.length, 200);
  assert.equal(result.provenance.outputTotal, 205);
  assert.equal(result.provenance.outputReturned, 200);
  assert.equal(result.provenance.outputTruncated, true);
});
test("deterministic analysis rejects nonfinite intermediate statistics instead of hiding them", () => {
  const huge = { ...file, text: "X,Y\n1e308,1e308\n-1e308,-1e308\n1,1\n" };
  for (const plan of [
    { action: "outliers", columns: ["X"] },
    { action: "correlation", columns: ["X", "Y"] },
  ])
    assert.throws(() => executePlan([huge], plan), { code: "NUMERIC_RANGE" });
  assert.throws(
    () =>
      executePlan([{ ...file, text: "X,Y\n1e308,0\n1e308,0" }], {
        action: "sum",
        columns: ["X"],
      }),
    { code: "NUMERIC_RANGE" },
  );
});

test("analytics refuse row-limit truncation and unparsed data instead of publishing partial or zero totals", () => {
  assert.throws(
    () =>
      executePlan(
        [
          {
            ...file,
            text:
              "X,Y\n" + Array.from({ length: 50001 }, () => "1,0").join("\n"),
          },
        ],
        { action: "sum", columns: ["X"] },
      ),
    { code: "DATASET_ROW_LIMIT" },
  );
  assert.throws(
    () =>
      executePlan([{ ...file, text: "unstructured prose" }], {
        action: "count",
      }),
    { code: "DATASET_UNSUPPORTED" },
  );
  assert.equal(
    registry()
      .tools.get("analyze_data")
      .input.safeParse({ fileIds: ["fil", "fil"], plan: { action: "count" } })
      .success,
    false,
  );
});

test("statistical provenance identifies the actual operation, paired observations and outlier rule", () => {
  const fileWithMissing = { ...file, text: "X,Y\n1,2\n2,4\n3,6\n4,\n" };
  const mean = executePlan([fileWithMissing], {
    action: "mean",
    columns: ["X"],
  });
  assert.equal(mean.value, 2.5);
  assert.equal(mean.provenance.aggregation, "mean");
  const correlation = executePlan([fileWithMissing], {
    action: "correlation",
    columns: ["X", "Y"],
  });
  assert.ok(Math.abs(correlation.value - 1) < 1e-12);
  assert.equal(correlation.provenance.validPairs, 3);
  assert.equal(correlation.provenance.minimumObservations, 3);
  assert.equal(correlation.provenance.method, "pearson");
  const outliers = executePlan([fileWithMissing], {
    action: "outliers",
    columns: ["X"],
  });
  assert.equal(outliers.provenance.method, "population_zscore");
  assert.equal(outliers.provenance.outlierThreshold, 2);
  assert.doesNotThrow(() =>
    registry().tools.get("analyze_data").output.parse(correlation),
  );
});
