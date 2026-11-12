import { z } from "zod";
import { ApprovalRequired } from "../tools/gateway.mjs";
import { json, body } from "../server/http.mjs";

export async function toolsRoutes({
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
  if (p === "/api/tools")
    return json(res, 200, { items: ctx.registry.schemas(actor) });
  if (p === "/api/tools/execute" && method === "POST") {
    const data = await body(req),
      toolName = data.toolId === "safe-http" ? "safe_http" : data.toolId;
    try {
      return json(res, 200, {
        result: await ctx.tools.execute(actor, toolName, data.input, {
          signal: controller.signal,
          approvalId: data.approvalId,
        }),
      });
    } catch (error) {
      if (error instanceof ApprovalRequired)
        return json(res, 202, {
          status: "waiting_approval",
          approvalId: error.approvalId,
        });
      throw error;
    }
  }
  if (p === "/api/approvals")
    return json(res, 200, { items: await ctx.tools.pending(actor) });
  match = p.match(/^\/api\/approvals\/([^/]+)$/);
  if (match && method === "POST") {
    const data = z.object({ approved: z.boolean() }).parse(await body(req));
    const decision = await ctx.tools.decideAndSchedule(
      actor,
      match[1],
      data.approved,
    );
    return json(res, 200, { ok: true, runId: decision.run_id });
  }
}
