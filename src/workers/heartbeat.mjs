import { randomUUID } from "node:crypto";
// Redis server time avoids API/worker clock skew. Registration expires even if
// the worker is killed without running cleanup; no hostnames or secrets stored.
const update = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]) * 2)
return 1`;
const inspect = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
return redis.call('ZCARD', KEYS[1])`;
export class WorkerHeartbeat {
  constructor(
    connection,
    {
      key = "fabric-production:worker-heartbeats",
      ttlMs = 45000,
      intervalMs = 10000,
      onError = () => {},
    } = {},
  ) {
    if (
      !Number.isInteger(ttlMs) ||
      ttlMs < 1000 ||
      ttlMs > 120000 ||
      !Number.isInteger(intervalMs) ||
      intervalMs < 100 ||
      intervalMs > ttlMs / 3
    )
      throw new Error("Invalid worker heartbeat limits");
    this.connection = connection;
    this.key = key;
    this.ttlMs = ttlMs;
    this.intervalMs = intervalMs;
    this.onError = onError;
    this.id = randomUUID();
    this.stopped = false;
    this.timer = null;
    this.pending = null;
  }
  async renew() {
    if (this.stopped) return;
    if (this.pending) return this.pending;
    this.pending = this.connection.eval(
      update,
      1,
      this.key,
      this.id,
      this.ttlMs,
    );
    try {
      await this.pending;
    } finally {
      this.pending = null;
    }
  }
  async start() {
    if (this.stopped) throw new Error("Worker heartbeat is stopped");
    if (this.timer) return;
    await this.renew();
    if (this.stopped) return;
    this.timer = setInterval(
      () => this.renew().catch(this.onError),
      this.intervalMs,
    );
    this.timer.unref();
  }
  async readiness() {
    const started = Date.now();
    try {
      const count = Number(await this.connection.eval(inspect, 1, this.key));
      if (!Number.isSafeInteger(count) || count < 0)
        throw new Error("Invalid worker heartbeat response");
      return {
        name: "workers",
        ok: count > 0,
        latencyMs: Date.now() - started,
        ...(count > 0 ? {} : { error: "WORKERS_UNAVAILABLE" }),
      };
    } catch {
      return {
        name: "workers",
        ok: false,
        latencyMs: Date.now() - started,
        error: "WORKER_HEALTH_UNAVAILABLE",
      };
    }
  }
  async close() {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = null;
    await this.pending?.catch(() => {});
    await this.connection.zrem(this.key, this.id);
  }
}
