import { json } from "../server/http.mjs";

export async function usageRoutes({
  ctx,
  actor,
  req,
  res,
  p,
  method,
  u,
  controller,
}) {
  if (p === "/api/usage/limits" && method === "GET")
    return json(res, 200, await ctx.aiPolicy.status(actor));
  if (p === "/api/usage" && method === "GET")
    return json(res, 200, {
      items: await ctx.repo.usageSummary(actor.workspaceId),
    });
}
