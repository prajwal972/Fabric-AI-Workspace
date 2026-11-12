// Explicit unit repository/vector doubles. These tests do not certify PostgreSQL locks or semantic relevance.
import test from "node:test";
import assert from "node:assert/strict";
import { MemoryService } from "../src/memory/service.mjs";
const actor = { workspaceId: "ws", user: { id: "user" }, role: "admin" };
function fixture({ role = "member", enabled = true, rows = [] } = {}) {
  const state = {
    role,
    enabled,
    rows,
    queries: [],
    created: [],
    audits: [],
    jobs: [],
    deleted: false,
    policyCalls: 0,
  };
  const repo = {
    pool: {
      async query(sql, params) {
        state.queries.push({ sql, params });
        if (sql.startsWith("SELECT m.role,")) {
          state.policyCalls++;
          return {
            rows: state.role
              ? [
                  {
                    role: state.role,
                    user_enabled: state.enabled,
                    workspace_enabled: true,
                  },
                ]
              : [],
          };
        }
        if (sql.startsWith("SELECT id,scope,content FROM memories"))
          return { rows: state.rows };
        if (sql.startsWith("SELECT 1 FROM memories"))
          return { rows: state.rows.length ? [{ exists: 1 }] : [] };
        if (sql.startsWith("SELECT id,scope,content,"))
          return { rows: state.rows };
        if (sql.startsWith("SELECT id FROM conversations"))
          return { rows: state.conversation === false ? [] : [{ id: "conv" }] };
        if (sql.startsWith("UPDATE memories SET deleted_at")) {
          state.deleted = true;
          return { rowCount: 1 };
        }
        if (sql.startsWith("UPDATE memories SET embedding="))
          return { rowCount: state.updateSkipped ? 0 : 1 };
        if (sql.startsWith("UPDATE workspaces"))
          return { rowCount: ["owner", "admin"].includes(state.role) ? 1 : 0 };
        if (sql.startsWith("UPDATE users"))
          return {
            rowCount: ["owner", "admin", "member", "viewer"].includes(
              state.role,
            )
              ? 1
              : 0,
          };
        throw new Error("Unhandled unit SQL " + sql.slice(0, 60));
      },
    },
    memories: {
      async create(ws, data) {
        const row = { id: "mem", workspaceId: ws, ...data };
        state.created.push(row);
        return row;
      },
      async require() {
        return state.record || { id: "mem", scope: "user", userId: "user" };
      },
    },
    async audit(a, event, details) {
      state.audits.push({ actor: a, event, details });
    },
    async transaction(fn) {
      state.beforeTransaction?.();
      const saved = {
        created: [...state.created],
        audits: [...state.audits],
        jobs: [...state.jobs],
        deleted: state.deleted,
      };
      try {
        return await fn(repo);
      } catch (error) {
        Object.assign(state, saved);
        throw error;
      }
    },
  };
  const jobs = {
    async create(a, type, input, key, tx) {
      assert.equal(tx, repo);
      if (state.jobFails)
        throw new Error("explicit unit job insertion failure");
      state.jobs.push({ actor: a, type, input });
      return { id: "job" };
    },
  };
  const ai = {
    async embed(a, texts, signal) {
      state.embeddings = (state.embeddings || 0) + 1;
      await state.onEmbed?.(a, texts, signal);
      return {
        vectors: texts.map(() => Array(768).fill(0.1)),
        identity: "unit-vector-fixture",
      };
    },
  };
  return {
    state,
    repo,
    ai,
    jobs,
    memory: new MemoryService({ repo, ai, jobs, env: {} }),
  };
}
test("memory reads refresh membership and reject missing/deleted users or workspaces", async () => {
  const f = fixture({ role: null });
  await assert.rejects(f.memory.listPage(actor), { code: "FORBIDDEN" });
  await assert.rejects(f.memory.enabled(actor), { code: "FORBIDDEN" });
  await assert.rejects(f.memory.listPage(null), { code: "UNAUTHORIZED" });
  assert.match(
    f.state.queries[0].sql,
    /u.deleted_at IS NULL.*w.deleted_at IS NULL/,
  );
});
test("cached administrator cannot create workspace memory after demotion", async () => {
  const f = fixture({ role: "member" });
  await assert.rejects(
    f.memory.add(actor, { content: "Project context", scope: "workspace" }),
    { code: "FORBIDDEN" },
  );
  assert.equal(f.state.created.length, 0);
});
test("viewer can review disabled memories but cannot write, delete, reindex or change workspace settings", async () => {
  const f = fixture({ role: "viewer", enabled: false });
  assert.deepEqual((await f.memory.listPage(actor)).items, []);
  for (const work of [
    () => f.memory.add(actor, { content: "Useful fact" }),
    () => f.memory.remove(actor, "mem"),
    () => f.memory.reindex(actor, {}),
    () => f.memory.toggle(actor, true, true),
  ])
    await assert.rejects(work(), { code: "FORBIDDEN" });
});
test("memory opt-out during creation is checked inside the transaction before insert/job", async () => {
  const f = fixture();
  f.state.beforeTransaction = () => {
    f.state.enabled = false;
  };
  await assert.rejects(f.memory.add(actor, { content: "Useful fact" }), {
    code: "MEMORY_DISABLED",
  });
  assert.equal(f.state.created.length, 0);
  assert.equal(f.state.jobs.length, 0);
  assert.match(f.state.queries.at(-1).sql, /FOR SHARE OF m,u,w/);
});
test("workspace role demotion during creation is rechecked while membership rows are locked", async () => {
  const f = fixture({ role: "admin" });
  f.state.beforeTransaction = () => {
    f.state.role = "member";
  };
  await assert.rejects(
    f.memory.add(actor, { content: "Team fact", scope: "workspace" }),
    { code: "FORBIDDEN" },
  );
  assert.equal(f.state.created.length, 0);
});
test("explicit expiry persists with atomically scheduled indexing and content-free audit", async () => {
  const f = fixture();
  const expiry = new Date(Date.now() + 86400000).toISOString();
  const result = await f.memory.add(actor, {
    content: "Temporary project context",
    expiresAt: expiry,
  });
  assert.equal(result.expiresAt, expiry);
  assert.equal(result.jobId, "job");
  assert.equal(f.state.audits[0].event, "memory.created");
  assert.equal(
    JSON.stringify(f.state.audits).includes("Temporary project context"),
    false,
  );
});
test("expired, far-future and malformed expiry or unknown input are rejected", async () => {
  const f = fixture();
  for (const expiry of [
    new Date(Date.now() - 1000).toISOString(),
    new Date(Date.now() + 366 * 86400000).toISOString(),
  ])
    await assert.rejects(
      f.memory.add(actor, { content: "Fact", expiresAt: expiry }),
      { code: "MEMORY_EXPIRY" },
    );
  await assert.rejects(
    f.memory.add(actor, { content: "Fact", expiresAt: "not-a-date" }),
  );
  await assert.rejects(f.memory.add(actor, { content: "Fact", unexpected: 1 }));
  assert.equal(f.state.created.length, 0);
});
test("conversation IDs apply only to conversation scope and must remain active at commit", async () => {
  const f = fixture();
  await assert.rejects(
    f.memory.add(actor, {
      content: "Fact",
      conversationId: "conv",
      scope: "user",
    }),
  );
  await assert.rejects(
    f.memory.add(actor, { content: "Fact", scope: "conversation" }),
    { code: "CONVERSATION_REQUIRED" },
  );
  f.state.beforeTransaction = () => {
    f.state.conversation = false;
  };
  await assert.rejects(
    f.memory.add(actor, {
      content: "Fact",
      scope: "conversation",
      conversationId: "conv",
    }),
    { code: "NOT_FOUND" },
  );
  assert.equal(f.state.created.length, 0);
});
test("unit transaction rollback preserves atomic memory/job/audit behavior on job failure", async () => {
  const f = fixture();
  f.state.jobFails = true;
  await assert.rejects(
    f.memory.add(actor, { content: "Useful fact" }),
    /job insertion failure/,
  );
  assert.equal(f.state.created.length, 0);
  assert.equal(f.state.audits.length, 0);
});
test("bounded memory pages expose expiry and stable pagination without vectors", async () => {
  const f = fixture({ rows: [{ id: "a" }, { id: "b" }, { id: "c" }] });
  const page = await f.memory.listPage(actor, {
    limit: 2,
    offset: 4,
    includeExpired: true,
  });
  assert.deepEqual(page.items, [{ id: "a" }, { id: "b" }]);
  assert.equal(page.nextOffset, 6);
  const q = f.state.queries.at(-1);
  assert.deepEqual(q.params, ["ws", "user", 3, 4, true]);
  assert.match(q.sql, /ORDER BY created_at DESC,id DESC/);
  assert.match(q.sql, /expires_at>now/);
  assert.doesNotMatch(q.sql, /SELECT \*/);
  await assert.rejects(f.memory.listPage(actor, { limit: 101 }));
  await assert.rejects(f.memory.listPage(actor, { offset: 100001 }));
  await assert.rejects(f.memory.listPage(actor, { includeExpired: "false" }));
});
test("deletion reauthorizes ownership, clears vectors and audits in the same transaction", async () => {
  const f = fixture({ enabled: false });
  await f.memory.remove(actor, "mem");
  assert.equal(f.state.deleted, true);
  assert.match(
    f.state.queries.at(-1).sql,
    /embedding=NULL,embedding_model=NULL/,
  );
  assert.equal(f.state.audits[0].event, "memory.deleted");
  const other = fixture();
  other.state.record = { scope: "user", userId: "someone-else" };
  await assert.rejects(other.memory.remove(actor, "mem"), {
    code: "FORBIDDEN",
  });
  assert.equal(other.state.deleted, false);
});
test("workspace deletion and settings use current admin permission, not cached role", async () => {
  const f = fixture();
  f.state.record = { scope: "workspace", userId: null };
  await assert.rejects(f.memory.remove(actor, "mem"), { code: "FORBIDDEN" });
  await assert.rejects(f.memory.toggle(actor, false, true), {
    code: "FORBIDDEN",
  });
  assert.equal(f.state.audits.length, 0);
});
test("settings audit contains scope/enabled only and conditional SQL checks fresh role", async () => {
  const f = fixture({ role: "admin" });
  await f.memory.toggle(actor, false, true);
  assert.equal(f.state.audits[0].event, "memory.settings_changed");
  assert.deepEqual(f.state.audits[0].details, {
    scope: "workspace",
    enabled: false,
  });
  assert.match(f.state.queries.at(-1).sql, /m.role IN \('owner','admin'\)/);
});
test("retrieval opt-out during embedding returns no memories and skips final vector query", async () => {
  const f = fixture({ rows: [{ id: "a", content: "Private memory" }] });
  f.state.onEmbed = () => {
    f.state.enabled = false;
  };
  assert.deepEqual(await f.memory.retrieve(actor, "question"), []);
  assert.equal(
    f.state.queries.some((q) => q.sql.includes("AS distance")),
    false,
  );
});
test("membership revocation during embedding fails before any memory result is read", async () => {
  const f = fixture({ rows: [{ id: "a" }] });
  f.state.onEmbed = () => {
    f.state.role = null;
  };
  await assert.rejects(f.memory.retrieve(actor, "question"), {
    code: "FORBIDDEN",
  });
  assert.equal(
    f.state.queries.some((q) => q.sql.includes("AS distance")),
    false,
  );
});
test("retrieval uses expiry, conversation existence, provider identity, distance cutoff and final authorization SQL", async () => {
  const f = fixture({ rows: [{ id: "a", content: "Context" }] });
  await f.memory.retrieve(actor, "question", "conv");
  const q = f.state.queries.at(-1);
  assert.match(q.sql, /embedding_model=\$4/);
  assert.match(q.sql, /embedding <=> \$5::vector <= \$6/);
  assert.match(q.sql, /c.deleted_at IS NULL/);
  assert.match(q.sql, /u.memory_enabled AND w.memory_enabled/);
  assert.match(q.sql, /ORDER BY embedding <=> \$5::vector,id LIMIT 5/);
  assert.equal(q.params[2], "conv");
  assert.equal(q.params[5], 0.35);
});
test("retrieval cancellation during embedding is preserved and no final read occurs", async () => {
  const f = fixture({ rows: [{ id: "a" }] });
  const abort = new AbortController();
  f.state.onEmbed = () => abort.abort();
  await assert.rejects(
    f.memory.retrieve(actor, "question", null, abort.signal),
    (error) => error.name === "AbortError",
  );
  assert.equal(
    f.state.queries.some((q) => q.sql.includes("AS distance")),
    false,
  );
});
test("empty memory and disabled policy never invoke the embedding provider", async () => {
  for (const f of [
    fixture(),
    fixture({ enabled: false, rows: [{ id: "a" }] }),
  ]) {
    assert.deepEqual(await f.memory.retrieve(actor, "question"), []);
    assert.equal(f.state.embeddings, undefined);
  }
});
test("reindex checks membership/opt-out after embedding before vector write", async () => {
  const f = fixture({
    rows: [{ id: "a", scope: "user", content: "Useful context" }],
  });
  f.state.onEmbed = () => {
    f.state.enabled = false;
  };
  await assert.rejects(f.memory.reindex(actor, {}), {
    code: "MEMORY_DISABLED",
  });
  assert.equal(
    f.state.queries.some((q) =>
      q.sql.startsWith("UPDATE memories SET embedding="),
    ),
    false,
  );
});
test("reindex skips sensitive imported content and conditionally rejects changed/deleted rows", async () => {
  const f = fixture({
    rows: [
      { id: "a", scope: "user", content: "api key value" },
      { id: "b", scope: "user", content: "Useful context" },
    ],
  });
  f.state.updateSkipped = true;
  const result = await f.memory.reindex(actor, {});
  assert.equal(result.indexed, 0);
  assert.equal(result.skippedSensitive, 1);
  assert.equal(result.skipped, 2);
  assert.match(
    f.state.queries.find((q) =>
      q.sql.startsWith("UPDATE memories SET embedding="),
    ).sql,
    /content=\$5.*deleted_at IS NULL.*expires_at>now/,
  );
});
test("distance configuration is bounded and operator override is explicit", () => {
  const f = fixture();
  for (const value of ["NaN", -1, 2.1, Infinity])
    assert.throws(
      () =>
        new MemoryService({
          repo: f.repo,
          env: { FABRIC_MEMORY_MAX_DISTANCE: value },
        }),
      TypeError,
    );
  assert.equal(
    new MemoryService({
      repo: f.repo,
      env: { FABRIC_MEMORY_MAX_DISTANCE: 1.1 },
    }).maxDistance,
    1.1,
  );
});

test("viewer can control personal memory opt-out but cannot change workspace settings", async () => {
  const f = fixture({ role: "viewer" });
  await f.memory.toggle(actor, false);
  assert.deepEqual(f.state.audits[0].details, {
    enabled: false,
    scope: "user",
  });
  await assert.rejects(f.memory.toggle(actor, false, true), {
    code: "FORBIDDEN",
  });
});
