import { z } from "zod";
import { AppError } from "../server/errors.mjs";
import { withResourceLease } from "../infrastructure/resource-lease.mjs";
const inputSchema = z
  .object({
    entity: z.enum(["file", "artifact"]),
    id: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/)
      .max(160),
  })
  .strict();
const tables = { file: "files", artifact: "artifacts" };
export class StorageCleanupService {
  constructor({ repo, storage, jobs }) {
    Object.assign(this, { repo, storage, jobs });
  }
  async delete(actor, entity, id) {
    const input = inputSchema.parse({ entity, id });
    return this.repo.transaction(async (tx) => {
      // The row lock also coordinates RAG's final indexing transaction.
      const row = (
        await tx.pool.query(
          `SELECT deleted_at FROM ${tables[entity]} WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,
          [actor.workspaceId, id],
        )
      ).rows[0];
      if (!row) throw new AppError("NOT_FOUND", "Record not found.", 404);
      if (!row.deleted_at) {
        await tx[tables[entity]].delete(actor.workspaceId, id);
        if (entity === "file") {
          await tx.pool.query(
            "DELETE FROM rag_chunks WHERE workspace_id=$1 AND file_id=$2",
            [actor.workspaceId, id],
          );
          await tx.pool.query(
            "UPDATE jobs SET cancel_requested=true WHERE workspace_id=$1 AND type='file-process' AND input->>'fileId'=$2 AND status IN ('queued','running','retrying')",
            [actor.workspaceId, id],
          );
        }
        await tx.audit(actor, entity + ".deleted", {
          id,
          storageStatus: "queued",
        });
      }
      // Key independent of deleting user: repeat deletion returns the same durable job.
      const existing = (
        await tx.pool.query(
          "SELECT id,status FROM jobs WHERE workspace_id=$1 AND type='storage-delete' AND idempotency_key=$2",
          [actor.workspaceId, "delete-" + entity + "-" + id],
        )
      ).rows[0];
      const job =
        existing ||
        (await this.jobs.create(
          actor,
          "storage-delete",
          input,
          "delete-" + entity + "-" + id,
          tx,
        ));
      return {
        ok: true,
        cleanupJobId: job.id,
        storageStatus:
          job.status === "completed"
            ? "completed"
            : job.status === "dead_letter"
              ? "failed"
              : "queued",
      };
    });
  }
  async process(actor, input, { signal } = {}) {
    const { entity, id } = inputSchema.parse(input);
    return withResourceLease(
      this.repo.pool,
      `${actor.workspaceId}:storage:${entity}:${id}`,
      signal,
      async () => {
        const row = (
          await this.repo.pool.query(
            `SELECT deleted_at FROM ${tables[entity]} WHERE workspace_id=$1 AND id=$2`,
            [actor.workspaceId, id],
          )
        ).rows[0];
        if (!row?.deleted_at)
          throw new AppError(
            "CLEANUP_NOT_AUTHORIZED",
            "Only previously deleted records can be cleaned up.",
            403,
          );
        for (const objectId of entity === "file" ? [id, id + ".text"] : [id]) {
          signal?.throwIfAborted();
          await this.storage.delete({
            workspaceId: actor.workspaceId,
            objectId,
            signal,
          });
        }
        await this.repo.audit(actor, entity + ".storage_deleted", { id });
        return { entity, id, storageStatus: "completed" };
      },
    );
  }
  async retry(actor, jobId) {
    if (!["owner", "admin"].includes(actor.role))
      throw new AppError(
        "FORBIDDEN",
        "Only workspace administrators can retry cleanup.",
        403,
      );
    return this.repo.transaction(async (tx) => {
      const prior = (
        await tx.pool.query(
          "SELECT * FROM jobs WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
          [actor.workspaceId, jobId],
        )
      ).rows[0];
      if (!prior) throw new AppError("NOT_FOUND", "Record not found.", 404);
      if (
        prior.type !== "storage-delete" ||
        !["failed", "dead_letter"].includes(prior.status)
      )
        throw new AppError(
          "RETRY_NOT_ALLOWED",
          "Only failed storage cleanup jobs can be retried.",
          409,
        );
      const input = inputSchema.parse(prior.input);
      const job = await this.jobs.create(
        actor,
        "storage-delete",
        input,
        "retry-" + jobId,
        tx,
      );
      await tx.audit(actor, "storage.cleanup_retried", {
        previousJobId: jobId,
        jobId: job.id,
      });
      return job;
    });
  }
}
