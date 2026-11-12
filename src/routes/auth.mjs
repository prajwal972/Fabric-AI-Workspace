import { z } from "zod";
import { AppError } from "../server/errors.mjs";
import { json, limiter } from "../server/http.mjs";

export async function authRoutes({
  ctx,
  actor,
  req,
  res,
  p,
  method,
  u,
  controller,
}) {
  if (p === "/api/auth/logout" && method === "POST") {
    await ctx.auth.revoke(actor);
    res.setHeader("set-cookie", ctx.auth.cookie(""));
    return json(res, 200, { ok: true });
  }
  if (p === "/api/auth/sessions" && method === "GET")
    return json(res, 200, { items: await ctx.auth.sessions(actor) });
  let match = p.match(/^\/api\/auth\/sessions\/([^/]+)$/);
  if (match && method === "DELETE") {
    await ctx.auth.revoke(actor, match[1]);
    return json(res, 200, { ok: true });
  }
  if (p === "/api/auth/verify-email" && method === "POST") {
    await limiter(ctx, "verify-email:" + actor.user.id, 3);
    if (!ctx.notifications.configured())
      throw new AppError(
        "EMAIL_NOT_CONFIGURED",
        "Transactional email is not configured.",
        503,
      );
    const token = await ctx.auth.challenge(actor.user.id, "verify_email");
    await ctx.jobs.create(actor, "notification", {
      ciphertext: ctx.box.encrypt(
        JSON.stringify({ purpose: "verify_email", token }),
      ),
    });
    return json(res, 202, { queued: true });
  }
}
