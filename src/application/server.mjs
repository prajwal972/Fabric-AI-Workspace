import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createContext } from "./context.mjs";
import { can, requiredPermission } from "../security/rbac.mjs";
import { hash, newId } from "../security/crypto.mjs";
import { AppError, publicError } from "../server/errors.mjs";
import { securityHeaders } from "../server/security-headers.mjs";
import {
  observeRequest,
  metricsText,
  logger,
} from "../observability/index.mjs";
import { json, cookie, nativePublic, limiter } from "../server/http.mjs";
import { dispatchFeatures, dispatchPublic } from "../routes/index.mjs";
const root = path.dirname(
  path.dirname(path.dirname(fileURLToPath(import.meta.url))),
);
export async function createApplication(env = process.env) {
  const ctx = await createContext(env);
  let closing = false;
  ctx.jobs.startDispatcher();
  const server = http.createServer(async (req, res) => {
    req.rid = newId("req");
    res.requestId = req.rid;
    observeRequest(req, res);
    res.setHeader("x-request-id", req.rid);
    for (const [k, v] of Object.entries(
      securityHeaders({ production: ctx.env.production }),
    ))
      res.setHeader(k, v);
    const controller = new AbortController();
    res.once("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const u = new URL(req.url, ctx.env.FABRIC_PUBLIC_URL),
        p = u.pathname,
        method = req.method;
      if (
        ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
        req.headers.origin &&
        req.headers.origin !== new URL(ctx.env.FABRIC_PUBLIC_URL).origin
      )
        throw new AppError("ORIGIN", "Cross-origin request blocked.", 403);
      if (!p.startsWith("/api/")) {
        const relative = decodeURIComponent(
            p === "/" ? "index.html" : p.slice(1),
          ),
          base = path.join(root, "public"),
          target = path.resolve(base, relative);
        if (!target.startsWith(base + path.sep))
          throw new AppError("FORBIDDEN", "Forbidden.", 403);
        let bytes;
        try {
          bytes = await fs.readFile(target);
        } catch {
          if (path.extname(target))
            throw new AppError("NOT_FOUND", "Not found.", 404);
          bytes = await fs.readFile(path.join(base, "index.html"));
        }
        res.writeHead(200, {
          "content-type":
            {
              ".html": "text/html; charset=utf-8",
              ".js": "text/javascript",
              ".css": "text/css",
              ".png": "image/png",
              ".webp": "image/webp",
              ".svg": "image/svg+xml",
            }[path.extname(target)] || "text/html",
        });
        res.end(bytes);
        return;
      }
      if (p === "/api/live")
        return json(res, closing ? 503 : 200, {
          status: closing ? "shutting_down" : "ok",
          persistence: "postgres",
          version: "1.10.4",
        });
      if (p === "/api/ready" || p === "/api/health") {
        const readiness = await ctx.infrastructure.readiness();
        const workerHealth = await ctx.jobs.readiness();
        readiness.dependencies.push(workerHealth);
        readiness.ok = readiness.ok && workerHealth.ok;
        return json(res, readiness.ok && !closing ? 200 : 503, {
          status: readiness.ok && !closing ? "ready" : "not_ready",
          dependencies: readiness.dependencies,
          persistence: "postgres",
        });
      }
      if (p === "/api/metrics") {
        if (
          !ctx.env.FABRIC_METRICS_TOKEN ||
          hash(
            String(req.headers.authorization || "").replace(/^Bearer /, ""),
          ) !== hash(ctx.env.FABRIC_METRICS_TOKEN)
        )
          throw new AppError(
            "UNAUTHORIZED",
            "Metrics authentication required.",
            401,
          );
        res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
        res.end(await metricsText());
        return;
      }
      if (p === "/api/runtime" && method === "GET")
        return json(res, 200, {
          native: nativePublic(await ctx.nativeRuntime.status()),
          ollamaUrl: ctx.env.FABRIC_OLLAMA_URL || "http://127.0.0.1:11434",
          persistence: "postgres",
        });
      if (await dispatchPublic({ ctx, req, res, p, method, u })) return;
      const actor = await ctx.auth.authenticate(cookie(req, "flux_session"));
      if (p === "/api/me") {
        if (!actor)
          return json(res, 200, {
            authenticated: false,
            persistence: "postgres",
            registrationOpen: ctx.env.FABRIC_REGISTRATION_MODE === "open",
            emailVerificationRequired:
              ctx.env.FABRIC_REQUIRE_EMAIL_VERIFICATION,
          });
        return json(res, 200, {
          authenticated: true,
          persistence: "postgres",
          user: actor.user,
          workspace: await ctx.repo.workspace(actor.workspaceId),
          csrf: actor.csrf,
          role: actor.role,
        });
      }
      if (!actor)
        throw new AppError("UNAUTHORIZED", "Authentication required.", 401);
      actor.requestId = req.rid;
      if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        if (
          req.headers.origin &&
          req.headers.origin !== new URL(ctx.env.FABRIC_PUBLIC_URL).origin
        )
          throw new AppError("ORIGIN", "Cross-origin request blocked.", 403);
        ctx.auth.checkCSRF(actor, req.headers["x-csrf-token"]);
      }
      let permission = requiredPermission(method, p);
      if (p.startsWith("/api/auth/sessions") || p === "/api/workspaces/switch")
        permission = "workspace.read";
      if (
        p.startsWith("/api/workspaces") &&
        p.includes("/members") &&
        method !== "GET"
      )
        permission = "workspace.admin";
      if (!can(actor.role, permission))
        throw new AppError(
          "FORBIDDEN",
          "You do not have permission to perform this action.",
          403,
        );
      await limiter(ctx, actor.workspaceId + ":" + actor.user.id, 120);
      if (
        await dispatchFeatures({
          ctx,
          actor,
          req,
          res,
          p,
          method,
          u,
          controller,
        })
      )
        return;
      throw new AppError("NOT_FOUND", "Route not found.", 404);
    } catch (error) {
      logger.error({
        event: "http.error",
        requestId: req.rid,
        code: error.code || "INTERNAL_ERROR",
        name: error.name,
      });
      const normalized =
        error instanceof z.ZodError
          ? new AppError(
              "VALIDATION_ERROR",
              "Submitted values are invalid.",
              400,
            )
          : error;
      const result = publicError(normalized, req.rid);
      if (!res.headersSent) json(res, result.status, result.body);
      else res.end();
    }
  });
  const close = async () => {
    closing = true;
    await new Promise((resolve) => server.close(resolve));
    await ctx.close();
  };
  return { server, ctx, close };
}
export async function startApplication(env = process.env) {
  const app = await createApplication(env);
  const readiness = await app.ctx.infrastructure.readiness();
  if (!readiness.ok) {
    await app.ctx.close();
    throw new Error("Required infrastructure is not ready.");
  }
  await new Promise((resolve) =>
    app.server.listen(app.ctx.env.port, app.ctx.env.host, resolve),
  );
  logger.info({
    event: "fabric.started",
    persistence: "postgres",
    port: app.ctx.env.port,
  });
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => {
      const timer = setTimeout(() => process.exit(1), 30000);
      timer.unref();
      app.close().then(() => {
        clearTimeout(timer);
        process.exit(0);
      });
    });
  return app;
}
