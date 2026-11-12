import { z } from "zod";
import { AppError } from "../server/errors.mjs";
import { json, body } from "../server/http.mjs";

export async function workspacesRoutes({
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
  if (p === "/api/workspaces/switch" && method === "POST")
    return json(res, 200, {
      workspace: await ctx.auth.selectWorkspace(
        actor,
        (await body(req)).workspaceId,
      ),
    });
  if (p === "/api/workspaces" && method === "GET")
    return json(res, 200, {
      items: await ctx.repo.userWorkspaces(actor.user.id),
    });
  match = p.match(/^\/api\/workspaces\/([^/]+)\/members$/);
  if (match) {
    if (match[1] !== actor.workspaceId)
      throw new AppError("FORBIDDEN", "Workspace access denied.", 403);
    if (method === "GET")
      return json(res, 200, {
        items: await ctx.repo.members(actor.workspaceId),
      });
    if (method !== "POST")
      throw new AppError(
        "METHOD_NOT_ALLOWED",
        "Unsupported request method.",
        405,
      );
    const data = z
      .object({
        userId: z.string(),
        role: z.enum(["admin", "member", "viewer"]),
      })
      .parse(await body(req));
    if (!["owner", "admin"].includes(actor.role))
      throw new AppError("FORBIDDEN", "Administration required.", 403);
    await ctx.repo.setMember(actor.workspaceId, data.userId, data.role);
    await ctx.repo.audit(actor, "membership.changed", {
      userId: data.userId,
      role: data.role,
    });
    return json(res, 200, { ok: true });
  }
}
