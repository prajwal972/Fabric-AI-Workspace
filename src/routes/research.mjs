import { json, body } from "../server/http.mjs";

export async function researchRoutes({
  ctx,
  actor,
  req,
  res,
  p,
  method,
  u,
  controller,
}) {
  if (p === "/api/modes")
    return json(res, 200, {
      items: [
        "general",
        "coding",
        "data",
        "research",
        "website",
        "app",
        "presentation",
        "study",
        "image",
      ].map((id) => ({ id, name: id })),
    });
  if (p === "/api/research/settings") {
    if (method === "PATCH") {
      const data = await body(req),
        url = data.url ? z.string().url().parse(data.url) : "";
      await ctx.repo.setWorkspace(actor.workspaceId, { researchUrl: url });
    }
    const workspace = await ctx.repo.workspace(actor.workspaceId);
    return json(res, 200, {
      url: workspace.researchUrl || "",
      environmentConfigured: !!ctx.env.FABRIC_RESEARCH_URL,
    });
  }
}
