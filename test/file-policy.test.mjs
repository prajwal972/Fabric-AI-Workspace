import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { FileService } from "../src/files/service.mjs";
import { AppError } from "../src/server/errors.mjs";
// Explicit service-unit doubles, not a real scanner/storage/embedding claim.
function fixture(ragStatus = "pending") {
  const file = {
      id: "fixture",
      name: "fixture.csv",
      kind: "text",
      status: ragStatus.startsWith("blocked") ? "ready" : "quarantined",
      ragStatus,
    },
    updates = [];
  const repo = {
    pool: {
      connect: async () => ({
        query: async () => ({ rows: [{ locked: true }] }),
        release: () => {},
      }),
    },
    files: {
      require: async () => ({ ...file }),
      get: async () => ({ ...file }),
      update: async (_ws, _id, update) => {
        updates.push(update);
        Object.assign(file, update);
      },
    },
  };
  const service = new FileService({
    repo,
    storage: {
      get: async () => ({
        Body: Readable.from([Buffer.from("Revenue\n200\n")]),
      }),
      put: async () => {},
      key: (ws, id) => ws + "/" + id,
    },
    rag: {
      index: async () => {
        throw new AppError("AI_USER_DAILY_LIMIT", "Daily limit", 429);
      },
    },
    env: {
      FABRIC_UPLOAD_SCAN_MODE: "optional",
      FABRIC_CLAMDSCAN_BIN: "fixture-missing-clamav-bin",
    },
  });
  let parses = 0;
  service.parse = async () => {
    parses++;
    return {
      text: "Revenue\n200\n",
      method: "explicit unit parser fixture",
      pages: [{ pageNumber: 1, text: "Revenue\n200\n" }],
    };
  };
  return { service, file, updates, parseCount: () => parses };
}
test("parsed data remains ready for deterministic analysis when embedding is policy-blocked", async () => {
  const f = fixture();
  const result = await f.service.process(
    { workspaceId: "ws", user: { id: "u" } },
    { fileId: "fixture" },
    { signal: new AbortController().signal, progress: async () => {} },
  );
  assert.equal(result.status, "ready");
  assert.equal(result.ragStatus, "blocked_ai_policy");
  assert.equal(f.file.text, "Revenue\n200\n");
  assert.equal(f.file.error, null);
  assert.equal(result.chunks, 0);
  assert.equal(f.parseCount(), 1);
});
test("ready-but-unindexed files can actually retry after provider or policy configuration changes", async () => {
  const f = fixture("blocked_requires_embedding_provider");
  f.service.rag.index = async () => 1;
  const result = await f.service.process(
    { workspaceId: "ws", user: { id: "u" } },
    { fileId: "fixture" },
    { signal: new AbortController().signal, progress: async () => {} },
  );
  assert.equal(result.ragStatus, "ready");
  assert.equal(result.chunks, 1);
  assert.equal(f.parseCount(), 1);
});
test("already indexed files are idempotent without parsing or reindexing", async () => {
  const f = fixture();
  f.file.status = "ready";
  f.file.ragStatus = "ready";
  const result = await f.service.process(
    { workspaceId: "ws", user: { id: "u" } },
    { fileId: "fixture" },
    { signal: new AbortController().signal, progress: async () => {} },
  );
  assert.equal(result.status, "ready");
  assert.equal(f.parseCount(), 0);
  assert.equal(f.updates.length, 0);
});
