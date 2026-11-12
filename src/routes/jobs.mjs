import { AppError } from "../server/errors.mjs";
import { json, pageOptions } from "../server/http.mjs";

export async function jobsRoutes({
  ctx,
  actor,
  req,
  res,
  p,
  method,
  u,
  controller,
}) {
  let match;
  if (p === "/api/jobs" && method === "GET") {
    const page = await ctx.repo.jobs.list(actor.workspaceId, pageOptions(u));
    return json(res, 200, {
      ...page,
      items: page.items.map(({ input, ...job }) => job),
    });
  }
  match = p.match(/^\/api\/jobs\/([^/]+)(?:\/(cancel|retry-cleanup))?$/);
  if (match) {
    if (method === "POST" && match[2] === "retry-cleanup") {
      const job = await ctx.storageCleanup.retry(actor, match[1]);
      return json(res, 202, { jobId: job.id, status: job.status });
    }
    if (method === "POST" && match[2] === "cancel") {
      await ctx.jobs.cancel(actor, match[1]);
      return json(res, 200, { ok: true });
    }
    if (method !== "GET")
      throw new AppError(
        "METHOD_NOT_ALLOWED",
        "Unsupported request method.",
        405,
      );
    const { input, ...job } = await ctx.repo.jobs.require(
      actor.workspaceId,
      match[1],
    );
    if (
      job.userId !== actor.user.id &&
      !["owner", "admin"].includes(actor.role)
    )
      throw new AppError("FORBIDDEN", "Job belongs to another user.", 403);
    return json(res, 200, job);
  }
}
