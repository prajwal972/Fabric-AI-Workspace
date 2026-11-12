import { z } from "zod";
import { AppError } from "../server/errors.mjs";
import { json, body, pageOptions } from "../server/http.mjs";

export async function agentsRoutes({
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
  if (p === "/api/agents" && method === "GET")
    return json(
      res,
      200,
      await ctx.repo.agents.list(actor.workspaceId, pageOptions(u)),
    );
  if (p === "/api/agents" && method === "POST") {
    const data = z
      .object({
        name: z.string().trim().min(1).max(80),
        instructions: z.string().max(4000).default(""),
        tools: z
          .array(z.string().regex(/^[a-z][a-z0-9_]{1,60}$/))
          .max(20)
          .default([]),
      })
      .parse(await body(req));
    return json(
      res,
      201,
      await ctx.repo.agents.create(actor.workspaceId, data),
    );
  }
  if (p === "/api/agents/run" && method === "POST") {
    const data = z
      .object({
        task: z.string().trim().min(1).max(20000),
        agentId: z.string().min(1).max(200).optional(),
      })
      .strict()
      .parse(await body(req));
    const run = await ctx.agents.schedule(actor, data.task, data.agentId);
    return json(res, 202, run);
  }
  match = p.match(/^\/api\/agents\/runs\/([^/]+)(?:\/(cancel))?$/);
  if (match) {
    if (method === "POST" && match[2]) {
      await ctx.agents.cancel(actor, match[1]);
      return json(res, 200, { ok: true });
    }
    if (method !== "GET")
      throw new AppError(
        "METHOD_NOT_ALLOWED",
        "Unsupported request method.",
        405,
      );
    return json(
      res,
      200,
      await ctx.repo.agent_runs.require(actor.workspaceId, match[1]),
    );
  }
}
