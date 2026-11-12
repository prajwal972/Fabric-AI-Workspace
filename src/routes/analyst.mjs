import { profileDataset } from "../analyst/engine.mjs";
import { json, body } from "../server/http.mjs";

export async function analystRoutes({
  ctx,
  actor,
  req,
  res,
  p,
  method,
  u,
  controller,
}) {
  if (p === "/api/agents/data-state")
    return json(res, 200, {
      state: await ctx.repo.analystState(actor.workspaceId),
    });
  if (p === "/api/agents/data-profile" && method === "POST") {
    const data = await body(req),
      files = await ctx.analyst.files(actor, data.fileIds);
    return json(res, 200, profileDataset(files));
  }
  if (
    ["/api/agents/data-analyst", "/api/agents/dashboard-operation"].includes(
      p,
    ) &&
    method === "POST"
  ) {
    const input = await body(req);
    const job = await ctx.jobs.create(actor, "analyst", input, req.rid);
    return json(res, 202, { jobId: job.id, status: "queued" });
  }
}
