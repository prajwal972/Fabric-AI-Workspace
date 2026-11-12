import { json } from "../server/http.mjs";

export async function auditRoutes({
  ctx,
  actor,
  req,
  res,
  p,
  method,
  u,
  controller,
}) {
  if (p === "/api/logs")
    return json(res, 200, {
      items: await ctx.repo.auditPage(actor.workspaceId),
    });
}
