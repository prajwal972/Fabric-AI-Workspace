import test from "node:test";
import assert from "node:assert/strict";
import { AgentEngine } from "../src/agents/engine.mjs";
import { ToolGateway } from "../src/tools/gateway.mjs";
const actor = { workspaceId: "ws", user: { id: "u" }, role: "owner" };
function fixture({
  failure = false,
  role = "member",
  runId = "run",
  toolPermission = "workspace.write",
  runState = "waiting_approval",
  currentApproval = "apr",
  cancelRequested = false,
} = {}) {
  const calls = [];
  const state = { approval: "pending", run: null, jobs: [] };
  const transaction = async (fn) => {
    const draft = structuredClone(state);
    const tx = {
      pool: {
        query: async (sql, params) => {
          calls.push({ sql, params });
          if (sql.includes("FROM memberships")) return { rows: [{ role }] };
          if (sql.includes("SELECT tool_name"))
            return {
              rows:
                state.approval === "pending"
                  ? [{ tool_name: "remember", run_id: runId }]
                  : [],
            };
          if (sql.startsWith("UPDATE approvals")) {
            draft.approval = params[3];
            return { rows: [{ id: "apr", run_id: runId }] };
          }
          throw new Error("Unexpected fixture SQL");
        },
      },
      agents: { require: async () => ({ id: "a" }) },
      agent_runs: {
        create: async (ws, record) => {
          draft.run = { id: "run", ...record };
          return draft.run;
        },
        require: async () => ({
          id: "run",
          userId: "u",
          status: runState,
          cancelRequested,
          state: { approvalId: currentApproval },
        }),
        update: async (ws, id, patch) => {
          draft.run = patch;
          return patch;
        },
      },
    };
    try {
      const result = await fn(tx);
      Object.assign(state, draft);
      calls.push({ commit: true });
      return result;
    } catch (error) {
      calls.push({ rollback: true });
      throw error;
    }
  };
  const repo = { transaction };
  const jobs = {
    create: async (a, type, input, key, tx) => {
      assert.ok(tx);
      assert.equal(type, "agent-run");
      calls.push({ type, input, key, sameTransaction: !!tx.agent_runs });
      if (failure) throw new Error("injected outbox failure");
      tx.jobObserved = true;
      return { id: "job" };
    },
  };
  const agents = new AgentEngine({ repo, jobs });
  const registry = {
    tools: new Map([["remember", { permission: toolPermission }]]),
  };
  const tools = new ToolGateway({ repo, jobs, registry });
  return { agents, tools, state, calls };
}
test("agent scheduling creates the run and durable job using the same transaction", async () => {
  const f = fixture();
  const result = await f.agents.schedule(actor, "Authorized goal", "a");
  assert.equal(result.id, "run");
  assert.equal(result.jobId, "job");
  assert.equal(f.state.run.input, "Authorized goal");
  const queued = f.calls.find((c) => c.type === "agent-run");
  assert.deepEqual(queued.input, { runId: "run" });
  assert.equal(queued.key, "agent-run");
  assert.equal(queued.sameTransaction, true);
  assert.equal(f.calls.at(-1).commit, true);
});
test("job/outbox failure rolls back agent scheduling rather than publishing an orphan run", async () => {
  const f = fixture({ failure: true });
  await assert.rejects(
    f.agents.schedule(actor, "Authorized goal"),
    /outbox failure/,
  );
  assert.equal(f.state.run, null);
  assert.equal(f.calls.at(-1).rollback, true);
});
test("approval and agent resume scheduling commit together; standalone approvals create no job", async () => {
  const f = fixture();
  assert.equal(
    (await f.tools.decideAndSchedule(actor, "apr", true)).run_id,
    "run",
  );
  assert.equal(f.state.approval, "approved");
  const queued = f.calls.find((c) => c.type === "agent-run");
  assert.deepEqual(queued.input, { runId: "run", approvalId: "apr" });
  assert.equal(queued.key, "resume-apr");
  const standalone = fixture({ runId: null });
  await standalone.tools.decideAndSchedule(actor, "apr", true);
  assert.equal(standalone.state.approval, "approved");
  assert.equal(
    standalone.calls.some((c) => c.type === "agent-run"),
    false,
  );
});
test("failed resume outbox insertion leaves the approval pending and retryable", async () => {
  const f = fixture({ failure: true });
  await assert.rejects(
    f.tools.decideAndSchedule(actor, "apr", true),
    /outbox failure/,
  );
  assert.equal(f.state.approval, "pending");
  assert.equal(f.calls.at(-1).rollback, true);
});
test("approval rejection cancels the waiting run within the same transaction without resume", async () => {
  const f = fixture();
  await f.tools.decideAndSchedule(actor, "apr", false);
  assert.equal(f.state.approval, "rejected");
  assert.equal(f.state.run.status, "cancelled");
  assert.equal(f.state.run.cancelRequested, true);
  assert.equal(
    f.calls.some((c) => c.type === "agent-run"),
    false,
  );
});
test("fresh tool permission and the exact waiting action are required before approval update", async () => {
  for (const options of [
    { role: "viewer" },
    { role: "member", toolPermission: "sandbox.execute" },
    { runState: "completed" },
    { currentApproval: "different" },
  ]) {
    const f = fixture(options);
    await assert.rejects(
      f.tools.decideAndSchedule(actor, "apr", true),
      (error) => ["FORBIDDEN_TOOL", "APPROVAL_RUN_STATE"].includes(error.code),
    );
    assert.equal(f.state.approval, "pending");
    assert.equal(
      f.calls.some((c) => c.sql?.startsWith("UPDATE approvals")),
      false,
    );
    assert.equal(
      f.calls.some((c) => c.type === "agent-run"),
      false,
    );
  }
});
test("scheduling dependencies fail closed before any transaction when unavailable", async () => {
  let entered = false;
  const repo = { transaction: async () => (entered = true) };
  await assert.rejects(new AgentEngine({ repo }).schedule(actor, "Goal"), {
    code: "QUEUE_UNAVAILABLE",
  });
  await assert.rejects(
    new ToolGateway({ repo }).decideAndSchedule(actor, "apr", true),
    { code: "QUEUE_UNAVAILABLE" },
  );
  assert.equal(entered, false);
});

test("rejecting an older pending approval does not cancel a different currently waiting action", async () => {
  const f = fixture({ currentApproval: "newer-action" });
  await f.tools.decideAndSchedule(actor, "apr", false);
  assert.equal(f.state.approval, "rejected");
  assert.equal(f.state.run, null);
  assert.equal(
    f.calls.some((c) => c.type === "agent-run"),
    false,
  );
});
