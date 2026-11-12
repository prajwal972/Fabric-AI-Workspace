import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { JobService } from "../src/workers/jobs.mjs";
if (process.env.NODE_ENV !== "test" || !process.env.REDIS_URL)
  throw new Error("Explicit disposable Redis test configuration is required");
test(
  "real Redis producer fails within a bounded deadline when a TCP proxy drops responses",
  { timeout: 15000 },
  async (t) => {
    const target = new URL(process.env.REDIS_URL);
    if (target.protocol !== "redis:")
      throw new Error(
        "This local fault-injection fixture requires non-TLS disposable Redis",
      );
    let blocked = false;
    const sockets = new Set();
    const proxy = net.createServer((client) => {
      const upstream = net.connect(
        Number(target.port || 6379),
        target.hostname,
      );
      sockets.add(client);
      sockets.add(upstream);
      client.on("data", (data) => {
        if (!blocked) upstream.write(data);
      });
      upstream.on("data", (data) => {
        if (!blocked) client.write(data);
      });
      client.on("error", () => {});
      upstream.on("error", () => {});
      client.on("close", () => {
        sockets.delete(client);
        upstream.destroy();
      });
      upstream.on("close", () => {
        sockets.delete(upstream);
        client.destroy();
      });
    });
    await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
    const url = new URL(target);
    url.hostname = "127.0.0.1";
    url.port = proxy.address().port;
    const jobs = new JobService({
      repo: {},
      env: {
        REDIS_URL: url.toString(),
        FABRIC_REDIS_COMMAND_TIMEOUT_MS: "300",
      },
    });
    t.after(async () => {
      await jobs.queue.close();
      jobs.connection.disconnect();
      for (const s of sockets) s.destroy();
      await new Promise((r) => proxy.close(r));
    });
    await jobs.queue.waitUntilReady();
    await jobs.connection.ping();
    blocked = true;
    const started = Date.now();
    await assert.rejects(
      jobs.queue.add(
        "failure-fixture",
        {},
        { jobId: "blocked-fixture-" + Date.now() },
      ),
    );
    assert.ok(
      Date.now() - started < 2000,
      "Producer must not wait forever for a Redis response",
    );
  },
);
