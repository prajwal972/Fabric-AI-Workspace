import { json } from "../server/http.mjs";

export async function dashboardRoutes({
  ctx,
  actor,
  req,
  res,
  p,
  method,
  u,
  controller,
}) {
  if (p === "/api/dashboard") {
    const [providers, conversations, files, runs] = await Promise.all([
      ctx.repo.providers.list(actor.workspaceId, { limit: 100 }),
      ctx.conversations.list(actor, { limit: 5 }),
      ctx.repo.files.list(actor.workspaceId, { limit: 5 }),
      ctx.repo.agent_runs.list(actor.workspaceId, { limit: 8 }),
    ]);
    return json(res, 200, {
      providers: providers.items.map((r) => ctx.providers.public(r)),
      conversations: conversations.items,
      files: files.items.map((f) => ctx.files.publicFile(f)),
      runs: runs.items,
      workflows: [],
    });
  }
}
