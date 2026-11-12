import test from "node:test";
import assert from "node:assert/strict";
import { WorkerHeartbeat } from "../src/workers/heartbeat.mjs";
function fixture() {
  const calls = [];
  const connection = {
    eval: async (...args) => {
      calls.push(args);
      return 1;
    },
    zrem: async (...args) => calls.push(["remove", ...args]),
  };
  return { calls, connection, beat: new WorkerHeartbeat(connection) };
}
test("worker registration uses Redis time, expiry and random non-identifying IDs", async () => {
  const f = fixture();
  await f.beat.start();
  await f.beat.close();
  assert.match(f.calls[0][0], /redis.call\('TIME'\)/);
  assert.match(f.calls[0][0], /ZREMRANGEBYSCORE/);
  assert.match(f.calls[0][0], /PEXPIRE/);
  assert.match(f.beat.id, /^[a-f0-9-]{36}$/);
  assert.equal(f.calls[0][4], 45000);
  assert.equal(f.calls.at(-1)[0], "remove");
  assert.equal(f.calls.at(-1)[2], f.beat.id);
});
test("readiness requires a live worker and rejects invalid Redis results", async () => {
  const f = fixture();
  assert.equal((await f.beat.readiness()).ok, true);
  f.connection.eval = async () => 0;
  assert.deepEqual((await f.beat.readiness()).error, "WORKERS_UNAVAILABLE");
  for (const value of [-1, "bad", 1.2]) {
    f.connection.eval = async () => value;
    assert.equal((await f.beat.readiness()).error, "WORKER_HEALTH_UNAVAILABLE");
  }
  await f.beat.close();
});
test("worker health errors do not expose Redis secrets", async () => {
  const f = fixture();
  f.connection.eval = async () => {
    throw new Error("redis://private:secret@example.test");
  };
  assert.equal((await f.beat.readiness()).error, "WORKER_HEALTH_UNAVAILABLE");
  await assert.rejects(f.beat.start(), /redis:/);
  assert.equal(f.beat.timer, null);
  await f.beat.close();
});
test("overlapping heartbeat renewals share one bounded Redis command", async () => {
  const f = fixture();
  let release;
  f.connection.eval = (...args) => {
    f.calls.push(args);
    return new Promise((r) => (release = r));
  };
  const a = f.beat.renew(),
    b = f.beat.renew();
  assert.equal(f.calls.length, 1);
  release(1);
  await Promise.all([a, b]);
  await f.beat.close();
});
test("close waits for in-flight registration then removes it without re-registering", async () => {
  const f = fixture();
  let release;
  f.connection.eval = (...args) => {
    f.calls.push(args);
    return new Promise((r) => (release = r));
  };
  const start = f.beat.start(),
    close = f.beat.close();
  release(1);
  await Promise.all([start, close]);
  assert.equal(f.beat.timer, null);
  assert.equal(f.calls.at(-1)[0], "remove");
  await f.beat.renew();
  assert.equal(f.calls.length, 2);
  await assert.rejects(f.beat.start(), /stopped/);
});
test("invalid heartbeat intervals fail before sending commands", () => {
  const f = fixture();
  for (const options of [
    { ttlMs: 0 },
    { ttlMs: 120001 },
    { intervalMs: 0 },
    { intervalMs: 20000 },
    { intervalMs: NaN },
  ])
    assert.throws(() => new WorkerHeartbeat(f.connection, options), /Invalid/);
});
