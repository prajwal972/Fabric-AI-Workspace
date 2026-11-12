import test from "node:test";
import assert from "node:assert/strict";
import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { WorkerHeartbeat } from "../src/workers/heartbeat.mjs";
const url = process.env.FABRIC_TEST_REDIS_URL;
if (process.env.NODE_ENV !== "test" || !url || process.env.REDIS_URL !== url)
  throw new Error(
    "Explicit matching disposable Redis test configuration is required",
  );
test(
  "real Redis worker health uses server time and expires killed registrations",
  { timeout: 10000 },
  async (t) => {
    const connection = new Redis(url, {
      maxRetriesPerRequest: 1,
      commandTimeout: 1000,
      enableOfflineQueue: false,
    });
    connection.on("error", () => {});
    const key = "fabric-test:worker-heartbeat:" + randomUUID();
    const a = new WorkerHeartbeat(connection, {
        key,
        ttlMs: 1000,
        intervalMs: 200,
      }),
      b = new WorkerHeartbeat(connection, {
        key,
        ttlMs: 1000,
        intervalMs: 200,
      });
    t.after(async () => {
      await a.close().catch(() => {});
      await b.close().catch(() => {});
      try {
        await connection.del(key);
      } finally {
        connection.disconnect();
      }
    });
    await new Promise((r, j) => {
      if (connection.status === "ready") r();
      else {
        connection.once("ready", r);
        connection.once("error", j);
      }
    });
    assert.equal((await a.readiness()).ok, false);
    await a.renew();
    assert.equal((await b.readiness()).ok, true);
    // Simulate process death: a single registration with no periodic refresh.
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal((await b.readiness()).ok, false);
    await Promise.all([a.start(), b.start()]);
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal((await a.readiness()).ok, true);
    await a.close();
    assert.equal((await b.readiness()).ok, true);
    await b.close();
    assert.equal((await b.readiness()).ok, false);
  },
);
