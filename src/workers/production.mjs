import { isMainModule } from "../utils/entrypoint.mjs";
import { createContext } from "../application/context.mjs";
import { logger } from "../observability/index.mjs";
export async function startWorker(env = process.env) {
  const ctx = await createContext(env);
  ctx.jobs.startDispatcher();
  const handlers = {
    "storage-delete": ctx.storageCleanup.process.bind(ctx.storageCleanup),
    "file-process": ctx.files.process.bind(ctx.files),
    analyst: ctx.analyst.run.bind(ctx.analyst),
    "memory-reindex": ctx.memory.reindex.bind(ctx.memory),
    "agent-run": async (actor, { runId, approvalId }, options) =>
      ctx.agents.execute(actor, runId, { ...options, approvalId }),
    report: ctx.artifacts.report.bind(ctx.artifacts),
    notification: ctx.notifications.send.bind(ctx.notifications),
    cleanup: async (actor) => {
      await ctx.repo.pool.query(
        "DELETE FROM sessions WHERE expires_at<now()-interval '30 days' OR revoked_at<now()-interval '30 days'",
      );
      return { completed: true };
    },
  };
  let worker;
  try {
    worker = await ctx.jobs.worker(handlers);
  } catch (error) {
    await ctx.close();
    throw error;
  }
  worker.on("failed", (job, error) =>
    logger.error({
      event: "job.failed",
      jobId: job?.id,
      code: error.code || "JOB_FAILED",
    }),
  );
  const close = async () => {
    await ctx.close();
  };
  return { ctx, worker, close };
}
if (isMainModule(import.meta.url)) {
  const runtime = await startWorker();
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => runtime.close().then(() => process.exit(0)));
}
