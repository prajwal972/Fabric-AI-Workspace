import { z } from "zod";
import { AppError } from "../server/errors.mjs";
import { publicError } from "../server/errors.mjs";
import { safeErrorMessage } from "../server/errors.mjs";
import { can } from "../security/rbac.mjs";
import { ApprovalRequired } from "../tools/gateway.mjs";
import { once } from "node:events";
import { activeGenerations } from "../observability/index.mjs";
import { json, body, pageOptions, limiter } from "../server/http.mjs";

export async function chatRoutes({
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
  if (p === "/api/conversations") {
    if (method === "GET")
      return json(
        res,
        200,
        await ctx.conversations.list(actor, {
          ...pageOptions(u),
          query: u.searchParams.get("q") || "",
        }),
      );
    if (method === "POST")
      return json(
        res,
        201,
        await ctx.conversations.create(actor, await body(req)),
      );
  }
  match = p.match(/^\/api\/conversations\/([^/]+)$/);
  if (match) {
    if (method === "GET") {
      const conversation = await ctx.conversations.get(actor, match[1]);
      const page = await ctx.repo.messagePage(actor.workspaceId, match[1], {
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .parse(u.searchParams.get("limit") || 100),
        before: u.searchParams.get("before"),
      });
      return json(res, 200, {
        ...conversation,
        messages: page.items,
        messagesNextCursor: page.nextCursor,
      });
    }
    if (method === "PATCH")
      return json(
        res,
        200,
        await ctx.conversations.update(actor, match[1], await body(req)),
      );
    if (method === "DELETE")
      return json(res, 200, await ctx.conversations.delete(actor, match[1]));
  }
  match = p.match(/^\/api\/messages\/([^/]+)$/);
  if (match && method === "PATCH") {
    if (!can(actor.role, "chat.write"))
      throw new AppError("FORBIDDEN", "Editing chat is not permitted.", 403);
    const input = z
      .object({ content: z.string().trim().min(1).max(30000) })
      .parse(await body(req));
    return json(
      res,
      200,
      await ctx.repo.editLatestUserMessage(
        actor,
        match[1],
        input.content.replace(/\0/g, ""),
      ),
    );
  }
  if (p === "/api/chat/stream" && method === "POST") {
    await limiter(ctx, "chat:" + actor.user.id, 30);
    const input = await body(req);
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "x-accel-buffering": "no",
    });
    res.flushHeaders();
    activeGenerations.inc();
    try {
      await ctx.chat.stream(
        actor,
        input,
        async (event, data) => {
          if (
            !res.destroyed &&
            !res.write(
              "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n",
            )
          )
            await Promise.race([once(res, "drain"), once(res, "close")]);
        },
        controller.signal,
      );
    } catch (error) {
      const e = publicError(error, req.rid);
      if (!res.destroyed)
        res.write(
          "event: error\ndata: " +
            JSON.stringify({
              ...e.body.error,
              ...(error instanceof ApprovalRequired
                ? { approvalId: error.approvalId }
                : {}),
            }) +
            "\n\n",
        );
    } finally {
      activeGenerations.dec();
      res.end();
    }
    return;
  }
  if (p === "/api/chat/compare" && method === "POST") {
    const b = await body(req),
      ids = z.array(z.string()).max(4).parse(b.providerIds),
      content = z.string().min(1).max(20000).parse(b.content);
    const items = await Promise.all(
      ids.map(async (id) => {
        const provider = await ctx.repo.providers.require(
          actor.workspaceId,
          id,
        );
        try {
          const response = await ctx.ai.generate(actor, {
            providerId: id,
            messages: [{ role: "user", content }],
            signal: controller.signal,
            requestId: req.rid + "/" + id,
          });
          return {
            providerId: id,
            provider: provider.name,
            model: provider.config.defaultModel,
            response: response.text,
            usage: response.usage,
          };
        } catch (e) {
          return {
            providerId: id,
            provider: provider.name,
            error: safeErrorMessage(e.message, 502),
          };
        }
      }),
    );
    return json(res, 200, { items });
  }
}
