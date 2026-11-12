import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { memoryRoutes } from "../src/routes/memory.mjs";
import { applicationConfig } from "../src/application/config.mjs";
function fixture() {
  const calls = [];
  let output, status;
  const res = {
    writeHead(code) {
      status = code;
    },
    end(text) {
      output = JSON.parse(text);
    },
  };
  const ctx = {
    memory: {
      async listPage(actor, input) {
        calls.push(["list", input]);
        return { items: [], nextOffset: 50 };
      },
      async enabled(actor, permission) {
        calls.push(["enabled", permission]);
        return true;
      },
    },
    jobs: {
      async create() {
        return { id: "j", status: "queued" };
      },
    },
  };
  return {
    calls,
    res,
    ctx,
    result: () => ({ output, status }),
    async run(query = "") {
      const req = Readable.from([]);
      req.headers = {};
      const u = new URL("http://test/api/memory" + query);
      return memoryRoutes({
        ctx,
        actor: {},
        req,
        res,
        p: u.pathname,
        method: "GET",
        u,
      });
    },
  };
}
test("memory route parses explicit expiry review and bounded pagination without coercing false to true", async () => {
  const f = fixture();
  await f.run("?limit=20&offset=40&includeExpired=false");
  assert.deepEqual(f.calls[0], [
    "list",
    { limit: 20, offset: 40, includeExpired: false },
  ]);
  assert.equal(f.result().output.nextOffset, 50);
  assert.equal(f.result().status, 200);
  const review = fixture();
  await review.run("?includeExpired=true");
  assert.equal(review.calls[0][1].includeExpired, true);
});
test("memory route rejects oversized pages, invalid booleans and unknown query fields before service access", async () => {
  for (const query of [
    "?limit=101",
    "?offset=-1",
    "?offset=100001",
    "?includeExpired=1",
    "?scope=other-user",
  ]) {
    const f = fixture();
    await assert.rejects(f.run(query));
    assert.equal(f.calls.length, 0);
  }
});
test("memory reindex route asks for current write permission", async () => {
  const f = fixture();
  const req = Readable.from([Buffer.from("{}")]);
  req.headers = {};
  await memoryRoutes({
    ctx: f.ctx,
    actor: {},
    req,
    res: f.res,
    p: "/api/memory/reindex",
    method: "POST",
    u: new URL("http://test/api/memory/reindex"),
  });
  assert.deepEqual(f.calls[0], ["enabled", "workspace.write"]);
  assert.equal(f.result().status, 202);
});
test("optional memory distance config is validated before infrastructure allocation", () => {
  const env = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@127.0.0.1/test",
    REDIS_URL: "redis://127.0.0.1",
    S3_ENDPOINT: "http://127.0.0.1:29000",
    S3_BUCKET: "test",
    FABRIC_MASTER_KEY: "disposable-unit-config-key-32-characters",
  };
  assert.equal(applicationConfig(env).FABRIC_MEMORY_MAX_DISTANCE, 0.35);
  assert.equal(
    applicationConfig({ ...env, FABRIC_MEMORY_MAX_DISTANCE: "0.6" })
      .FABRIC_MEMORY_MAX_DISTANCE,
    0.6,
  );
  for (const value of ["NaN", "-1", "2.1"])
    assert.throws(
      () => applicationConfig({ ...env, FABRIC_MEMORY_MAX_DISTANCE: value }),
      /FABRIC_MEMORY_MAX_DISTANCE/,
    );
});
