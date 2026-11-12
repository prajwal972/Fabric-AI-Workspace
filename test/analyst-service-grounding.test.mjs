import test from "node:test";
import assert from "node:assert/strict";
import { AnalystService, executePlan } from "../src/services/analyst.mjs";
import { AppError } from "../src/server/errors.mjs";
const actor = { workspaceId: "ws", user: { id: "u" }, role: "owner" };
function fixture({
  explanation = "Computed revenue is 120.",
  error,
  role = "member",
  signal,
} = {}) {
  const file = {
    id: "fil_99999999",
    status: "ready",
    name: "Revenue2024.csv",
    kind: "csv",
    text: "Region,Revenue\nWest,50\nEast,70\n",
  };
  let saved,
    called = 0,
    accessed = false;
  const repo = {
    pool: {
      query: async (sql) => {
        if (sql.includes("FROM memberships"))
          return { rows: role ? [{ role }] : [] };
        return { rows: [] };
      },
    },
    files: {
      require: async () => {
        accessed = true;
        return file;
      },
    },
    analystSnapshot: async () => ({ state: null, revision: 0 }),
    saveAnalystState: async (ws, state) => (saved = state),
    audit: async () => {},
  };
  const ai = {
    choose: async () => ({ id: "fixture", type: "ollama" }),
    generate: async (a) => {
      assert.equal(a.role, "member");
      called++;
      if (called === 1)
        return { text: '{"action":"sum","columns":["Revenue"]}' };
      if (error) throw error;
      if (signal?.aborted) throw signal.reason;
      return { text: explanation };
    },
  };
  const service = new AnalystService({ repo, ai });
  return {
    run: () =>
      service.run(
        actor,
        { fileIds: [file.id], query: "sum Revenue" },
        { signal },
      ),
    saved: () => saved,
    accessed: () => accessed,
    calls: () => called,
  };
}
test("analyst keeps actual deterministic facts when an explanation invents a file-ID value", async () => {
  const f = fixture({ explanation: "Computed revenue is 99999999." });
  const result = await f.run();
  assert.equal(result.operation.facts.value, 120);
  assert.equal(result.validation.explanationRejected, "unverified_numbers");
  assert.match(result.answer, /120/);
  assert.doesNotMatch(result.answer, /99999999/);
  assert.equal(
    result.validation.explanationNumericCheck.semanticSupportVerified,
    false,
  );
  assert.ok(f.saved());
});
test("optional explanation quota/provider failure does not discard calculated results", async () => {
  for (const code of [
    "AI_USER_DAILY_LIMIT",
    "PROVIDER_ERROR",
    "AI_CLOUD_DISABLED",
  ]) {
    const f = fixture({
      error: new AppError(code, "Explicit unit fixture failure", 429),
    });
    const result = await f.run();
    assert.equal(result.operation.facts.value, 120);
    assert.equal(result.validation.explanationUnavailable, code);
    assert.ok(f.saved());
    assert.equal(f.calls(), 2);
  }
});
test("unknown explanation bugs are not hidden as successful analysis", async () => {
  const f = fixture({
    error: new TypeError("Explicit unit fixture programmer error"),
  });
  await assert.rejects(f.run(), /programmer error/);
  assert.equal(f.saved(), undefined);
});
test("fresh analyst permissions deny viewer/stale owner before dataset reads", async () => {
  for (const role of ["viewer", null]) {
    const f = fixture({ role });
    await assert.rejects(f.run(), { code: "FORBIDDEN" });
    assert.equal(f.accessed(), false);
    assert.equal(f.calls(), 0);
  }
});
test("structured analytics fail rather than publishing non-finite overflow/correlation values", () => {
  const files = [
    {
      id: "f",
      kind: "csv",
      text: "Amount,Other\n1e308,1e308\n1e308,1e308\n-1e308,-1e308\n",
    },
  ];
  assert.throws(
    () => executePlan(files, { action: "sum", columns: ["Amount"] }),
    { code: "NUMERIC_RANGE" },
  );
  assert.throws(
    () =>
      executePlan(files, {
        action: "correlation",
        columns: ["Amount", "Other"],
      }),
    { code: "NUMERIC_RANGE" },
  );
});
