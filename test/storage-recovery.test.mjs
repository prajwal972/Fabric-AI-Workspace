import test from "node:test";
import assert from "node:assert/strict";
import { verifyMigrations } from "../src/database/migrations.mjs";
import { S3ObjectStore } from "../src/infrastructure/object-store.mjs";
import { JobService } from "../src/workers/jobs.mjs";
import { AppError } from "../src/server/errors.mjs";
import { StorageCleanupService } from "../src/services/storage-cleanup.mjs";
import { withResourceLease } from "../src/infrastructure/resource-lease.mjs";
import { applicationConfig } from "../src/application/config.mjs";
// Unit doubles test state transitions; actual infrastructure tests live in integration/.
function workerFixture({
  member = true,
  type = "file-process",
  maxAttempts = 4,
  cancelled = false,
} = {}) {
  const row = {
    id: "job",
    workspaceId: "ws",
    userId: "user",
    type,
    input: {},
    status: "queued",
    cancelRequested: cancelled,
    maxAttempts,
  };
  const updates = [];
  const service = Object.create(JobService.prototype);
  service.env = {};
  service.repo = {
    jobs: {
      require: async () => ({ ...row }),
      update: async (_ws, _id, update) => {
        updates.push(update);
        Object.assign(row, update);
      },
    },
    pool: {
      query: async () => ({
        rows: member ? [{ role: "member", name: "Test" }] : [],
      }),
    },
  };
  const queued = {
    data: { workspaceId: "ws", jobId: "job" },
    attemptsMade: 0,
    updateProgress: async () => {},
  };
  return { service, queued, row, updates };
}
test("revoked membership records a permanent failure instead of stale queued state", async () => {
  const f = workerFixture({ member: false });
  let called = false;
  await assert.rejects(
    f.service.executeJob(f.queued, {
      "file-process": async () => {
        called = true;
      },
    }),
    { name: "UnrecoverableError", message: "FORBIDDEN" },
  );
  assert.equal(called, false);
  assert.equal(f.row.status, "dead_letter");
  assert.equal(f.row.attempts, 1);
});
test("only mandatory tombstone cleanup can run after membership revocation", async () => {
  const f = workerFixture({ member: false, type: "storage-delete" });
  await f.service.executeJob(f.queued, {
    "storage-delete": async (actor) => {
      assert.equal(actor.role, "maintenance");
      assert.equal(actor.workspaceId, "ws");
      return { done: true };
    },
  });
  assert.equal(f.row.status, "completed");
  assert.equal(f.row.progress, 100);
});
test("permanent validation and permission failures do not retry", async () => {
  for (const status of [400, 403, 404, 409, 413, 422]) {
    const f = workerFixture();
    await assert.rejects(
      f.service.executeJob(f.queued, {
        "file-process": async () => {
          throw new AppError("DENIED", "Denied", status);
        },
      }),
      { name: "UnrecoverableError" },
    );
    assert.equal(f.row.status, "dead_letter");
    assert.equal(f.row.error, "DENIED");
  }
});
test("transient failures retry only to the persisted attempt limit and redact Redis errors", async () => {
  const f = workerFixture({ maxAttempts: 2 });
  const handlers = {
    "file-process": async () => {
      throw new Error("postgresql://private:secret@db/fabric /private/path");
    },
  };
  await assert.rejects(f.service.executeJob(f.queued, handlers), {
    message: "INTERNAL_ERROR",
  });
  assert.equal(f.row.status, "retrying");
  assert.equal(f.row.attempts, 1);
  f.queued.attemptsMade = 1;
  await assert.rejects(f.service.executeJob(f.queued, handlers), {
    name: "UnrecoverableError",
    message: "INTERNAL_ERROR",
  });
  assert.equal(f.row.status, "dead_letter");
  assert.equal(f.row.attempts, 2);
});
test("rate limits retry and successful retry clears the previous error", async () => {
  const f = workerFixture();
  await assert.rejects(
    f.service.executeJob(f.queued, {
      "file-process": async () => {
        throw new AppError("LIMITED", "Slow down", 429);
      },
    }),
    { message: "LIMITED" },
  );
  assert.equal(f.row.status, "retrying");
  f.queued.attemptsMade = 1;
  await f.service.executeJob(f.queued, {
    "file-process": async () => ({ value: 42 }),
  });
  assert.equal(f.row.error, null);
  assert.equal(f.row.attempts, 2);
  assert.deepEqual(f.row.output, { value: 42 });
});
test("cancellation before or during execution is terminal without automatic retry", async () => {
  const f = workerFixture({ cancelled: true });
  await f.service.executeJob(f.queued, {});
  assert.equal(f.row.status, "cancelled");
  const g = workerFixture();
  assert.equal(
    await g.service.executeJob(g.queued, {
      "file-process": async () => {
        g.row.cancelRequested = true;
        throw new Error("aborted");
      },
    }),
    null,
  );
  assert.equal(g.row.status, "cancelled");
  assert.equal(g.row.error, "JOB_CANCELLED");
});
test("completed and dead-letter deliveries never replay handlers", async () => {
  for (const status of ["completed", "dead_letter", "failed", "cancelled"]) {
    const f = workerFixture();
    f.row.status = status;
    await f.service.executeJob(f.queued, {
      "file-process": async () => {
        throw new Error("Must not run");
      },
    });
    assert.equal(f.updates.length, 0);
  }
});
test("unknown job type records an explicit permanent failure", async () => {
  const f = workerFixture();
  await assert.rejects(f.service.executeJob(f.queued, {}), {
    message: "JOB_TYPE_UNSUPPORTED",
  });
  assert.equal(f.row.status, "dead_letter");
});
test("mandatory deletion cannot be cancelled even by its owner", async () => {
  const f = workerFixture({ type: "storage-delete" });
  await assert.rejects(
    f.service.cancel(
      { workspaceId: "ws", user: { id: "user" }, role: "owner" },
      "job",
    ),
    { code: "CLEANUP_REQUIRED" },
  );
  assert.equal(f.updates.length, 0);
});
function cleanupFixture(deleted) {
  const deletedKeys = [],
    queries = [];
  const client = {
    query: async (sql) => ({ rows: [{ locked: true }] }),
    release: () => {},
  };
  const repo = {
    pool: {
      connect: async () => client,
      query: async (sql, args) => {
        queries.push(args);
        return { rows: deleted === undefined ? [] : [{ deleted_at: deleted }] };
      },
    },
    audit: async () => {},
  };
  const service = new StorageCleanupService({
    repo,
    storage: { delete: async (args) => deletedKeys.push(args) },
  });
  return { service, deletedKeys, queries };
}
test("cleanup refuses live, absent and cross-scoped records before touching storage", async () => {
  for (const deleted of [null, undefined]) {
    const f = cleanupFixture(deleted);
    await assert.rejects(
      f.service.process({ workspaceId: "ws" }, { entity: "file", id: "f" }),
      { code: "CLEANUP_NOT_AUTHORIZED" },
    );
    assert.equal(f.deletedKeys.length, 0);
    assert.deepEqual(f.queries[0], ["ws", "f"]);
  }
});
test("file cleanup deletes original and extracted objects; artifact cleanup deletes only its own key", async () => {
  for (const entity of ["file", "artifact"]) {
    const f = cleanupFixture(new Date());
    await f.service.process({ workspaceId: "ws" }, { entity, id: "id" });
    assert.deepEqual(
      f.deletedKeys.map((x) => x.objectId),
      entity === "file" ? ["id", "id.text"] : ["id"],
    );
    assert.ok(f.deletedKeys.every((x) => x.workspaceId === "ws"));
  }
});
test("cleanup input cannot select arbitrary tables or object paths", async () => {
  const f = cleanupFixture(new Date());
  for (const input of [
    { entity: "users", id: "id" },
    { entity: "file", id: "../../secret" },
    { entity: "artifact", id: "id", objectKey: "foreign" },
  ])
    await assert.rejects(f.service.process({ workspaceId: "ws" }, input));
  assert.equal(f.deletedKeys.length, 0);
});
test("resource leases release on handler failure and destroy connections after failed unlock", async () => {
  const released = [];
  let failUnlock = false;
  const client = {
    query: async (sql) => {
      if (sql.includes("unlock") && failUnlock)
        throw new Error("Connection lost");
      return { rows: [{ locked: true }] };
    },
    release: (broken) => released.push(broken),
  };
  const pool = { connect: async () => client };
  await assert.rejects(
    withResourceLease(pool, "key", undefined, async () => {
      throw new Error("Failure");
    }),
  );
  assert.deepEqual(released, [false]);
  failUnlock = true;
  await withResourceLease(pool, "key", undefined, async () => 42);
  assert.deepEqual(released, [false, true]);
});
test("an aborted lease never starts its handler", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0,
    released = false;
  await assert.rejects(
    withResourceLease(
      {
        connect: async () => ({
          query: async () => {
            calls++;
          },
          release: () => {
            released = true;
          },
        }),
      },
      "key",
      controller.signal,
      async () => {
        calls++;
      },
    ),
  );
  assert.equal(calls, 0);
  assert.equal(released, true);
});
test("worker runtime and lock configuration are bounded at startup", () => {
  const env = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://localhost/test",
    REDIS_URL: "redis://localhost",
    S3_ENDPOINT: "http://localhost:9000",
    S3_BUCKET: "test",
    FABRIC_MASTER_KEY: "x".repeat(32),
  };
  assert.equal(applicationConfig(env).FABRIC_JOB_LOCK_MS, 30000);
  for (const config of [
    { FABRIC_JOB_TIMEOUT_MS: "0" },
    { FABRIC_JOB_TIMEOUT_MS: "Infinity" },
    { FABRIC_JOB_LOCK_MS: "9999999" },
  ])
    assert.throws(() => applicationConfig({ ...env, ...config }));
});

test("external notification failure is never automatically replayed", async () => {
  const f = workerFixture({ type: "notification" });
  await assert.rejects(
    f.service.executeJob(f.queued, {
      notification: async () => {
        throw new Error("Delivery outcome unknown");
      },
    }),
    { name: "UnrecoverableError" },
  );
  assert.equal(f.row.status, "dead_letter");
  assert.equal(f.row.attempts, 1);
});
test("interrupted deliveries persist unknown outcome without overwriting committed results", async () => {
  const f = workerFixture();
  let query, values;
  f.service.repo.pool.query = async (sql, args) => {
    query = sql;
    values = args;
  };
  await f.service.recordInterruption(f.queued);
  assert.match(query, /JOB_INTERRUPTED_OUTCOME_UNKNOWN/);
  assert.match(query, /status IN \(\'queued\',\'running\',\'retrying\'\)/);
  assert.deepEqual(values, ["ws", "job"]);
});

test("S3 operations pass AbortSignal to the SDK transport", async () => {
  const seen = [],
    signal = new AbortController().signal;
  const store = new S3ObjectStore({
    bucket: "test",
    client: {
      send: async (command, options) => seen.push({ command, options }),
    },
  });
  await store.put({
    workspaceId: "ws",
    objectId: "file",
    body: "text",
    signal,
  });
  await store.get({ workspaceId: "ws", objectId: "file", signal });
  await store.delete({ workspaceId: "ws", objectId: "file", signal });
  assert.equal(seen.length, 3);
  assert.ok(seen.every((x) => x.options.abortSignal === signal));
});
test("cleanup forwards cancellation to each object deletion", async () => {
  const f = cleanupFixture(new Date()),
    signal = new AbortController().signal;
  await f.service.process(
    { workspaceId: "ws" },
    { entity: "file", id: "file" },
    { signal },
  );
  assert.ok(f.deletedKeys.every((x) => x.signal === signal));
});

test("startup distinguishes missing migrations from unavailable database and denied grants", async () => {
  for (const [source, code] of [
    ["42P01", "DATABASE_MIGRATIONS_REQUIRED"],
    ["42501", "DATABASE_PERMISSION_DENIED"],
    ["ECONNREFUSED", "DATABASE_UNAVAILABLE"],
  ]) {
    await assert.rejects(
      verifyMigrations(
        {
          query: async () => {
            throw Object.assign(
              new Error("postgresql://hidden:secret@private/db"),
              { code: source },
            );
          },
        },
        "migrations",
      ),
      (error) =>
        error.code === code &&
        !error.message.includes("secret") &&
        !error.message.includes("postgresql://"),
    );
  }
});
test("worker concurrency cannot exhaust all database connections with resource leases", () => {
  const env = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://localhost/test",
    REDIS_URL: "redis://localhost",
    S3_ENDPOINT: "http://localhost:9000",
    S3_BUCKET: "test",
    FABRIC_MASTER_KEY: "x".repeat(32),
  };
  assert.throws(
    () =>
      applicationConfig({
        ...env,
        FABRIC_DB_POOL_MAX: 4,
        FABRIC_WORKER_CONCURRENCY: 4,
      }),
    /POOL/,
  );
  assert.equal(
    applicationConfig({
      ...env,
      FABRIC_DB_POOL_MAX: 6,
      FABRIC_WORKER_CONCURRENCY: 4,
    }).FABRIC_DB_POOL_MAX,
    6,
  );
});

test("daily AI quota exhaustion does not repeatedly reprocess a background job before midnight", async () => {
  const f = workerFixture();
  await assert.rejects(
    f.service.executeJob(f.queued, {
      "file-process": async () => {
        throw new AppError("AI_USER_DAILY_LIMIT", "Wait until reset", 429);
      },
    }),
    { name: "UnrecoverableError" },
  );
  assert.equal(f.row.status, "dead_letter");
  assert.equal(f.row.attempts, 1);
});
