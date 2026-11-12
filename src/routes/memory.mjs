import { z } from "zod";
import { AppError } from "../server/errors.mjs";
import { json, body } from "../server/http.mjs";

export async function memoryRoutes({
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
  if (p === "/api/memory/reindex" && method === "POST") {
    const data = z
      .object({
        limit: z.number().int().min(1).max(100).default(50),
        afterId: z.string().max(100).optional(),
        force: z.boolean().default(false),
      })
      .strict()
      .parse(await body(req));
    if (!(await ctx.memory.enabled(actor, "workspace.write")))
      throw new AppError("MEMORY_DISABLED", "Memory is disabled.", 409);
    const job = await ctx.jobs.create(
      actor,
      "memory-reindex",
      data,
      req.headers["idempotency-key"] || undefined,
    );
    return json(res, 202, { jobId: job.id, status: job.status });
  }
  if (p === "/api/memory") {
    if (method === "GET") {
      const data = z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
          offset: z.coerce.number().int().min(0).max(100000).default(0),
          includeExpired: z
            .enum(["true", "false"])
            .default("false")
            .transform((v) => v === "true"),
        })
        .strict()
        .parse(Object.fromEntries(u.searchParams));
      return json(res, 200, {
        ...(await ctx.memory.listPage(actor, data)),
        enabled: await ctx.memory.enabled(actor),
      });
    }
    if (method === "POST")
      return json(res, 201, await ctx.memory.add(actor, await body(req)));
    if (method === "PATCH") {
      const b = z
        .object({
          enabled: z.boolean(),
          workspace: z.boolean().default(false),
        })
        .parse(await body(req));
      await ctx.memory.toggle(actor, b.enabled, b.workspace);
      return json(res, 200, { ok: true });
    }
  }
  match = p.match(/^\/api\/memory\/([^/]+)$/);
  if (match && method === "DELETE") {
    await ctx.memory.remove(actor, match[1]);
    return json(res, 200, { ok: true });
  }
}
