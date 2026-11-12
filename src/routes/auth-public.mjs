import { z } from "zod";
import { AppError } from "../server/errors.mjs";
import { json, body, limiter } from "../server/http.mjs";
export async function authPublicRoutes({ ctx, req, res, p, method }) {
  if (
    p.startsWith("/api/auth/") &&
    ["register", "login"].includes(p.split("/").at(-1)) &&
    method === "POST"
  ) {
    await limiter(ctx, "auth:" + req.socket.remoteAddress, 10);
    const input = await body(req, 10000),
      result = p.endsWith("register")
        ? await ctx.auth.register(input, req.headers["user-agent"])
        : await ctx.auth.login(input, req.headers["user-agent"]);
    const actor = {
      user: result.user,
      workspaceId: result.workspace.id,
      role: result.role,
      requestId: req.rid,
    };
    if (p.endsWith("register") && ctx.env.FABRIC_REQUIRE_EMAIL_VERIFICATION) {
      const verificationToken = await ctx.auth.challenge(
        actor.user.id,
        "verify_email",
      );
      await ctx.jobs.create(actor, "notification", {
        ciphertext: ctx.box.encrypt(
          JSON.stringify({ purpose: "verify_email", token: verificationToken }),
        ),
      });
    }
    await ctx.providers.bootstrap(actor);
    await ctx.repo.audit(
      actor,
      p.endsWith("register") ? "auth.register" : "auth.login",
      {},
      req.rid,
    );
    res.setHeader("set-cookie", ctx.auth.cookie(result.token));
    const { token, sessionId, ...publicResult } = result;
    return json(res, p.endsWith("register") ? 201 : 200, {
      ...publicResult,
      persistence: "postgres",
    });
  }
  if (p === "/api/auth/recover" && method === "POST") {
    await limiter(ctx, "recover:" + req.socket.remoteAddress, 5);
    if (!ctx.notifications.configured())
      throw new AppError(
        "EMAIL_NOT_CONFIGURED",
        "Transactional email must be configured for recovery.",
        503,
      );
    const input = await body(req, 10000),
      email = z.email().parse(input.email).toLowerCase();
    const user = await ctx.repo.recoveryUser(email);
    if (user) {
      const token = await ctx.auth.challenge(user.id, "reset_password"),
        actor = {
          user: { id: user.id, email: user.email, name: user.name },
          workspaceId: user.workspace_id,
          role: user.role,
        };
      await ctx.jobs.create(actor, "notification", {
        ciphertext: ctx.box.encrypt(
          JSON.stringify({ purpose: "reset_password", token }),
        ),
      });
    }
    return json(res, 202, {
      message: "If the account exists, a recovery email will be sent.",
    });
  }
  if (p === "/api/auth/confirm" && method === "POST") {
    await limiter(ctx, "confirm:" + req.socket.remoteAddress, 10);
    const input = z
      .object({
        token: z.string().min(20).max(200),
        purpose: z.enum(["verify_email", "reset_password"]),
        password: z.string().optional(),
      })
      .parse(await body(req, 10000));
    await ctx.auth.consumeChallenge(input.token, input.purpose, input.password);
    return json(res, 200, { ok: true });
  }
}
