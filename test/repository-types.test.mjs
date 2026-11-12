import test from "node:test";
import assert from "node:assert/strict";
import { ScopedRepository } from "../src/repositories/workspace.mjs";
test("agent text is not JSON-encoded while its structured state is JSONB", async () => {
  const calls = [],
    pool = {
      query: async (query, values) => {
        calls.push({ query, values });
        return {
          rows: [
            {
              id: "r",
              workspace_id: "w",
              objective: values[3],
              output: "answer",
            },
          ],
        };
      },
    };
  const repo = new ScopedRepository(pool, "agent_runs");
  await repo.create("w", { userId: "u", input: "chain", state: { index: 0 } });
  assert.equal(calls[0].values[3], "chain");
  assert.equal(calls[0].values[4], '{"index":0}');
  await repo.update("w", "r", {
    output: "The result is 42",
    plan: { steps: [] },
  });
  assert.equal(calls[1].values[2], "The result is 42");
  assert.equal(calls[1].values[3], '{"steps":[]}');
});
test("job input and output remain JSONB instead of raw strings", async () => {
  const calls = [],
    pool = {
      query: async (query, values) => {
        calls.push(values);
        return { rows: [{ id: "j", workspace_id: "w" }] };
      },
    };
  const repo = new ScopedRepository(pool, "jobs");
  await repo.create("w", { input: { fileId: "f" }, output: "done" });
  assert.equal(calls[0][2], '{"fileId":"f"}');
  assert.equal(calls[0][3], '"done"');
});

test("PostgreSQL BYTEA file hashes become genuine hexadecimal provenance, never fabricated digest strings", async () => {
  const { recordDTO } = await import("../src/repositories/workspace.mjs");
  const { createHash } = await import("node:crypto");
  const digest = createHash("sha256").update("real digest fixture").digest();
  const file = recordDTO("files", {
    id: "f",
    workspace_id: "ws",
    sha256: digest,
  });
  assert.equal(file.sha256, digest.toString("hex"));
  assert.equal(file.sha256.length, 64);
  assert.equal(recordDTO("files", { sha256: Buffer.alloc(31) }).sha256, null);
  assert.equal(recordDTO("files", { sha256: "not a digest" }).sha256, null);
});
