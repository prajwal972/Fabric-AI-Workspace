import { Queue, Worker, UnrecoverableError } from "bullmq";
import { WorkerHeartbeat } from "./heartbeat.mjs";
import Redis from "ioredis";
import { newId } from "../security/crypto.mjs";
import { logger } from "../observability/index.mjs";
import { argumentHash } from "../tools/gateway.mjs";
import { AppError, publicError } from "../server/errors.mjs";
// Retry only operations whose handlers implement idempotent durable recovery.
// Notification/report effects lack destination-side idempotency: fail for review.
const retrySafeTypes = new Set([
  "file-process",
  "memory-reindex",
  "analyst",
  "agent-run",
  "storage-delete",
  "cleanup",
]);
export class JobService {
  constructor({ repo, env = process.env }) {
    this.repo = repo;
    this.env = env;
    this.connection = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      commandTimeout: Number(env.FABRIC_REDIS_COMMAND_TIMEOUT_MS || 5000),
      connectTimeout: 3000,
      enableOfflineQueue: false,
    });
    this.queue = new Queue("fabric-production", {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 4,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { age: 86400, count: 5000 },
        removeOnFail: false,
      },
    });
    this.connection.on("error", (error) =>
      logger.warn({
        event: "queue.redis_error",
        code: error.code || "REDIS_UNAVAILABLE",
      }),
    );
    this.queue.on("error", (error) =>
      logger.warn({
        event: "queue.error",
        code: error.code || "QUEUE_UNAVAILABLE",
      }),
    );
    this.dispatchTimer = null;
    this.heartbeat = new WorkerHeartbeat(this.connection, {
      onError: () =>
        logger.warn({
          event: "worker.heartbeat_failed",
          code: "WORKER_HEALTH_UNAVAILABLE",
        }),
    });
  }
  async create(actor, type, input, key = newId("job"), transaction) {
    const create = async (tx) => {
      await tx.pool.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        actor.workspaceId + ":" + type + ":" + key,
      ]);
      const previous = (
        await tx.pool.query(
          "SELECT id,actor_user_id,input FROM jobs WHERE workspace_id=$1 AND type=$2 AND idempotency_key=$3",
          [actor.workspaceId, type, key],
        )
      ).rows[0];
      if (previous) {
        if (
          previous.actor_user_id !== actor.user.id ||
          argumentHash(previous.input) !== argumentHash(input)
        )
          throw new AppError(
            "IDEMPOTENCY_CONFLICT",
            "This idempotency key was used for a different request.",
            409,
          );
        return tx.jobs.require(actor.workspaceId, previous.id);
      }
      const job = await tx.jobs.create(actor.workspaceId, {
        userId: actor.user.id,
        type,
        input,
        status: "queued",
        progress: 0,
        maxAttempts: retrySafeTypes.has(type) ? 4 : 1,
        idempotencyKey: key,
      });
      await tx.pool.query(
        "INSERT INTO outbox(id,workspace_id,job_id) VALUES($1,$2,$3)",
        [newId("out"), actor.workspaceId, job.id],
      );
      return job;
    };
    return transaction ? create(transaction) : this.repo.transaction(create);
  }
  async dispatch() {
    await this.repo.transaction(async (tx) => {
      const rows = (
        await tx.pool.query(
          "SELECT o.id,o.workspace_id,j.id AS job_id,j.type,j.max_attempts FROM outbox o JOIN jobs j ON j.id=o.job_id WHERE o.dispatched_at IS NULL AND j.status <> 'cancelled' ORDER BY o.created_at LIMIT 50 FOR UPDATE OF o SKIP LOCKED",
        )
      ).rows;
      for (const row of rows) {
        await this.queue.add(
          row.type,
          { workspaceId: row.workspace_id, jobId: row.job_id },
          { jobId: row.job_id, attempts: row.max_attempts },
        );
        await tx.pool.query(
          "UPDATE outbox SET dispatched_at=now() WHERE id=$1",
          [row.id],
        );
      }
    });
  }
  startDispatcher() {
    this.dispatchTimer = setInterval(
      () =>
        this.dispatch().catch((error) =>
          logger.error({
            event: "queue.dispatch_failed",
            code: error.code || "DISPATCH_FAILED",
          }),
        ),
      1000,
    );
    this.dispatchTimer.unref();
  }
  async cancel(actor, id) {
    const job = await this.repo.jobs.require(actor.workspaceId, id);
    if (
      job.userId !== actor.user.id &&
      !["owner", "admin"].includes(actor.role)
    )
      throw new AppError("FORBIDDEN", "You cannot cancel this job.", 403);
    if (job.type === "storage-delete")
      throw new AppError(
        "CLEANUP_REQUIRED",
        "Required storage cleanup cannot be cancelled.",
        409,
      );
    if (
      ["completed", "dead_letter", "failed", "cancelled"].includes(job.status)
    )
      return;
    await this.repo.jobs.update(actor.workspaceId, id, {
      cancelRequested: true,
    });
    const queued = await this.queue.getJob(id);
    if (queued && ["waiting", "delayed"].includes(await queued.getState())) {
      await queued.remove();
      await this.repo.jobs.update(actor.workspaceId, id, {
        status: "cancelled",
      });
    }
  }
  async worker(handlers, auth) {
    this.workerConnection = new Redis(this.env.REDIS_URL, {
      maxRetriesPerRequest: null,
    });
    this.workerConnection.on("error", (error) =>
      logger.warn({
        event: "worker.redis_error",
        code: error.code || "REDIS_UNAVAILABLE",
      }),
    );
    const worker = new Worker(
      "fabric-production",
      (queued) => this.executeJob(queued, handlers),
      {
        connection: this.workerConnection,
        concurrency: Number(this.env.FABRIC_WORKER_CONCURRENCY || 4),
        maxStalledCount: 0,
        lockDuration: Number(this.env.FABRIC_JOB_LOCK_MS || 30000),
      },
    );
    worker.on("error", (error) =>
      logger.error({
        event: "worker.error",
        code: error.code || "WORKER_ERROR",
      }),
    );
    worker.on("failed", (queued) => {
      if (queued?.deferredFailure)
        this.recordInterruption(queued).catch((error) =>
          logger.error({
            event: "job.interruption_state_failed",
            jobId: queued.id,
            code: error.code || "DATABASE_UNAVAILABLE",
          }),
        );
    });
    // Do not advertise a worker before BullMQ has connected successfully.
    this.activeWorker = worker;
    let timer;
    try {
      await Promise.race([
        worker.waitUntilReady(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new AppError(
                  "WORKER_STARTUP_FAILED",
                  "Worker startup timed out.",
                  503,
                ),
              ),
            5000,
          );
        }),
      ]);
      await this.heartbeat.start();
    } catch (error) {
      await worker.close(true).catch(() => {});
      this.activeWorker = null;
      throw error;
    } finally {
      clearTimeout(timer);
    }
    return worker;
  }
  async readiness() {
    return this.heartbeat.readiness();
  }
  async recordInterruption(queued) {
    // BullMQ can fail an interrupted job before invoking our processor.
    // Preserve a result committed before Redis lost its lock; otherwise review.
    await this.repo.pool.query(
      "UPDATE jobs SET status='dead_letter',error_code='JOB_INTERRUPTED_OUTCOME_UNKNOWN' WHERE workspace_id=$1 AND id=$2 AND status IN ('queued','running','retrying')",
      [queued.data.workspaceId, queued.data.jobId],
    );
  }
  async executeJob(queued, handlers) {
    const job = await this.repo.jobs.require(
      queued.data.workspaceId,
      queued.data.jobId,
    );
    if (job.status === "completed") return job.output;
    if (["cancelled", "dead_letter", "failed"].includes(job.status))
      return null;
    const controller = new AbortController();
    let timer, cancelPoll;
    const attempt = queued.attemptsMade + 1;
    try {
      if (job.cancelRequested && job.type !== "storage-delete") {
        await this.repo.jobs.update(job.workspaceId, job.id, {
          status: "cancelled",
        });
        return null;
      }
      await this.repo.jobs.update(job.workspaceId, job.id, {
        status: "running",
        attempts: attempt,
        error: null,
      });
      const member = (
        await this.repo.pool.query(
          "SELECT m.role,u.email,u.name,u.memory_enabled FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND u.deleted_at IS NULL",
          [job.workspaceId, job.userId],
        )
      ).rows[0];
      // Only cleanup of already-soft-deleted rows survives membership revocation.
      // Its handler independently verifies the scoped tombstone before touching S3.
      if (!member && job.type !== "storage-delete")
        throw new AppError(
          "FORBIDDEN",
          "Job owner is no longer a workspace member.",
          403,
        );
      const actor = {
        workspaceId: job.workspaceId,
        user: {
          id: job.userId,
          email: member?.email,
          name: member?.name,
          memoryEnabled: member?.memory_enabled,
        },
        role: member?.role || "maintenance",
        requestId: job.id,
      };
      const handler = handlers[job.type];
      if (!handler)
        throw new AppError(
          "JOB_TYPE_UNSUPPORTED",
          "This background operation is not supported.",
          422,
        );
      timer = setTimeout(
        () =>
          controller.abort(
            new AppError("JOB_TIMEOUT", "Background operation timed out.", 504),
          ),
        Number(this.env.FABRIC_JOB_TIMEOUT_MS || 300000),
      );
      cancelPoll = setInterval(async () => {
        try {
          if (
            job.type !== "storage-delete" &&
            (await this.repo.jobs.require(job.workspaceId, job.id))
              .cancelRequested
          )
            controller.abort(
              new AppError(
                "JOB_CANCELLED",
                "Background operation was cancelled.",
                409,
              ),
            );
        } catch {
          controller.abort(
            new AppError(
              "JOB_STATE_UNAVAILABLE",
              "Background job state is unavailable.",
              503,
            ),
          );
        }
      }, 500);
      const output = await handler(actor, job.input, {
        signal: controller.signal,
        jobId: job.id,
        progress: async (progress) => {
          controller.signal.throwIfAborted();
          await queued.updateProgress(progress);
          await this.repo.jobs.update(job.workspaceId, job.id, { progress });
        },
      });
      controller.signal.throwIfAborted();
      await this.repo.jobs.update(job.workspaceId, job.id, {
        status: "completed",
        output,
        progress: 100,
        error: null,
      });
      return output;
    } catch (error) {
      const latest = await this.repo.jobs.require(job.workspaceId, job.id);
      const cancelled = job.type !== "storage-delete" && latest.cancelRequested;
      const actual = controller.signal.aborted
        ? controller.signal.reason
        : error;
      const normalized = publicError(actual, job.id);
      const permanent =
        ["AI_USER_DAILY_LIMIT", "AI_WORKSPACE_DAILY_LIMIT"].includes(
          normalized.body.error.code,
        ) ||
        (normalized.status < 500 && ![408, 429].includes(normalized.status));
      const terminal =
        permanent ||
        !retrySafeTypes.has(job.type) ||
        attempt >= job.maxAttempts;
      await this.repo.jobs.update(job.workspaceId, job.id, {
        status: cancelled ? "cancelled" : terminal ? "dead_letter" : "retrying",
        attempts: attempt,
        error: cancelled ? "JOB_CANCELLED" : normalized.body.error.code,
      });
      if (cancelled) return null;
      if (terminal) throw new UnrecoverableError(normalized.body.error.code);
      // Redis failure fields must not retain raw provider bodies, paths or secrets.
      throw new Error(normalized.body.error.code);
    } finally {
      clearTimeout(timer);
      clearInterval(cancelPoll);
    }
  }
  async close() {
    clearInterval(this.dispatchTimer);
    await this.heartbeat?.close().catch(() => {});
    await this.activeWorker?.close();
    await this.queue.close();
    await this.workerConnection?.quit();
    await this.connection.quit();
  }
}
