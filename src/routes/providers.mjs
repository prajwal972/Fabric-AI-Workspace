import { AppError } from "../server/errors.mjs";
import { json, body } from "../server/http.mjs";

export async function providersRoutes({
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
  if (p === "/api/providers") {
    if (method === "GET") {
      const page = await ctx.repo.providers.list(actor.workspaceId, {
        limit: 100,
      });
      return json(res, 200, {
        ...page,
        items: page.items.map((r) => ctx.providers.public(r)),
      });
    }
    if (method === "POST")
      return json(res, 201, await ctx.providers.save(actor, await body(req)));
  }
  match = p.match(
    /^\/api\/providers\/([^/]+)(?:\/(models|validate|default|warm))?$/,
  );
  if (match) {
    if (match[2]) {
      if (method !== (match[2] === "models" ? "GET" : "POST"))
        throw new AppError(
          "METHOD_NOT_ALLOWED",
          "Unsupported request method.",
          405,
        );
      return json(
        res,
        200,
        await ctx.providers.action(
          actor,
          match[1],
          match[2],
          method === "GET" ? {} : await body(req),
        ),
      );
    }
    if (method === "PATCH")
      return json(
        res,
        200,
        await ctx.providers.save(actor, await body(req), match[1]),
      );
    if (method === "DELETE") {
      await ctx.providers.delete(actor, match[1]);
      return json(res, 200, { ok: true });
    }
  }
}
