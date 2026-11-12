import test from "node:test";
import assert from "node:assert/strict";
import { AgentEngine } from "../src/agents/engine.mjs";
const actor = { workspaceId: "ws", user: { id: "u" }, role: "owner" };
function fixture(member = { role: "member" }) {
  const calls = [];
  let row = {
    id: "run",
    userId: "u",
    status: "queued",
    state: { index: 0, observations: [] },
  };
  const repo = {
    pool: {
      query: async (sql, params) => {
        calls.push({ op: "query", sql, params });
        return { rows: member ? [member] : [] };
      },
      connect: async () => {
        calls.push({ op: "connect" });
        return {
          query: async () => ({ rows: [{ locked: true }] }),
          release: () => {},
        };
      },
    },
    agents: {
      require: async () => {
        calls.push({ op: "agent-read" });
        return { id: "a" };
      },
    },
    agent_runs: {
      create: async (ws, input) => {
        calls.push({ op: "create", ws, input });
        return input;
      },
      require: async () => {
        calls.push({ op: "run-read" });
        return row;
      },
      update: async (ws, id, patch) => {
        calls.push({ op: "update", patch });
        return (row = { ...row, ...patch });
      },
    },
  };
  const engine = new AgentEngine({ repo, ai: {}, tools: {} });
  return { engine, calls, setRun: (value) => (row = value) };
}
test("agent creation enforces fresh membership and rejects viewer, missing and stale-owner access", async () => {
  for (const member of [undefined, { role: "viewer" }, { role: "unknown" }]) {
    const f = fixture(member);
    if (member === undefined)
      f.engine.repo.pool.query = async () => ({ rows: [] });
    await assert.rejects(f.engine.create(actor, "Valid goal", "a"), {
      code: "FORBIDDEN",
    });
    assert.equal(
      f.calls.some((c) => ["create", "agent-read"].includes(c.op)),
      false,
    );
  }
  const f = fixture();
  const row = await f.engine.create(
    actor,
    "Complete authorized objective",
    "a",
  );
  assert.equal(row.input, "Complete authorized objective");
  assert.deepEqual(f.calls[0].params, ["ws", "u"]);
  assert.match(f.calls[0].sql, /deleted_at IS NULL/);
});
test("agent rejects malformed or oversized objectives instead of silently truncating instructions", async () => {
  const f = fixture();
  for (const goal of [undefined, null, 123, "", "   "])
    await assert.rejects(f.engine.create(actor, goal), {
      code: "OBJECTIVE_REQUIRED",
    });
  await assert.rejects(f.engine.create(actor, "x".repeat(20001)), {
    code: "OBJECTIVE_TOO_LONG",
  });
  assert.equal(f.calls.length, 0);
});
test("agent execution checks membership before acquiring a lease or invoking planning", async () => {
  const f = fixture({ role: "viewer" });
  await assert.rejects(f.engine.execute(actor, "run"), { code: "FORBIDDEN" });
  assert.equal(
    f.calls.some((c) => c.op === "connect"),
    false,
  );
  assert.equal(
    f.calls.some((c) => c.op === "run-read"),
    false,
  );
  for (const a of [null, {}, { workspaceId: "ws", user: {} }])
    await assert.rejects(f.engine.execute(a, "run"), { code: "UNAUTHORIZED" });
});
test("cancellation uses the fresh role and cannot abort another user using stale admin claims", async () => {
  const f = fixture({ role: "member" });
  f.setRun({ id: "run", userId: "other", status: "executing" });
  let aborted = false;
  f.engine.active.set("run", { abort: () => (aborted = true) });
  await assert.rejects(f.engine.cancel({ ...actor, role: "admin" }, "run"), {
    code: "FORBIDDEN",
  });
  assert.equal(aborted, false);
  assert.equal(
    f.calls.some((c) => c.op === "update"),
    false,
  );
  const admin = fixture({ role: "admin" });
  admin.setRun({ id: "run", userId: "other", status: "executing" });
  admin.engine.active.set("run", { abort: () => (aborted = true) });
  await admin.engine.cancel({ ...actor, role: "member" }, "run");
  assert.equal(aborted, true);
  assert.equal(admin.calls.at(-1).patch.cancelRequested, true);
});
