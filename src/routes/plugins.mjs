import { AppError } from "../server/errors.mjs";
import { hash } from "../security/crypto.mjs";
import { secretToken } from "../security/crypto.mjs";
import { json } from "../server/http.mjs";

export async function pluginsRoutes({
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
  if (p === "/api/plugins")
    return json(res, 200, await pluginCatalog(ctx, actor));
  if (p === "/api/plugins/connect")
    throw new AppError(
      "MANUAL_PLUGIN_AUTH_REMOVED",
      "Use official connector authorization.",
      410,
    );
  match = p.match(/^\/api\/plugins\/oauth\/([^/]+)\/(start|callback)$/);
  if (match) {
    await oauthRoute(ctx, actor, req, res, match[1], match[2], u);
    return;
  }
  match = p.match(
    /^\/api\/plugins\/connections\/([^/]+)(?:\/(test|execute))?$/,
  );
  if (match) {
    const connection = await ctx.repo.plugins.require(
      actor.workspaceId,
      match[1],
    );
    if (method === "DELETE") {
      await ctx.repo.plugins.delete(actor.workspaceId, match[1]);
      return json(res, 200, { ok: true });
    }
    if (method !== "POST" || !match[2])
      throw new AppError(
        "METHOD_NOT_ALLOWED",
        "Unsupported request method.",
        405,
      );
    const action = ctx.connectors.actions[connection.pluginId];
    if (!action)
      throw new AppError(
        "UNAVAILABLE_CONNECTOR",
        "This connector has no approved action.",
        400,
      );
    const result = await ctx.connectors.execute(
      connection,
      {},
      action,
      match[2] === "test",
    );
    await ctx.repo.audit(actor, "plugin.executed", {
      pluginId: connection.pluginId,
    });
    return json(res, 200, {
      result,
      message: "Connector action completed.",
    });
  }
}

async function pluginCatalog(ctx, actor) {
  const connections = (
    await ctx.repo.plugins.list(actor.workspaceId, { limit: 100 })
  ).items;
  return {
    connections: connections.map(ctx.connectors.publicPlugin),
    catalog: ctx.connectors.catalog.map((row) => {
      const connection = connections.find(
          (c) => c.pluginId === row.id && c.enabled,
        ),
        provider = ctx.connectors.oauthMap[row.id],
        ready = !!ctx.connectors.oauthConfig(provider);
      return {
        ...row,
        connected: !!connection,
        connectionId: connection?.id,
        oauthProvider: provider,
        oauthReady: ready,
        availability: connection
          ? "connected"
          : provider
            ? ready
              ? "official"
              : "deployment-setup"
            : "coming-soon",
      };
    }),
  };
}
async function oauthRoute(ctx, actor, req, res, pluginId, action, u) {
  const definition = ctx.connectors.catalog.find((c) => c.id === pluginId),
    provider = ctx.connectors.oauthMap[pluginId],
    config = ctx.connectors.oauthConfig(provider);
  if (!definition || !config)
    throw new AppError(
      "CONNECTOR_NOT_CONFIGURED",
      "The official connector is not configured.",
      503,
    );
  const redirectUri = new URL(
    "/api/plugins/oauth/" + pluginId + "/callback",
    ctx.env.FABRIC_PUBLIC_URL,
  ).toString();
  if (action === "start") {
    const state = secretToken(),
      verifier = secretToken();
    await ctx.repo.saveOAuthState([
      hash(state),
      actor.workspaceId,
      actor.user.id,
      pluginId,
      provider,
      ctx.box.encrypt(verifier),
    ]);
    const target = new URL(config.authorize);
    for (const [k, v] of Object.entries({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
      scope: config.scope,
      code_challenge: Buffer.from(hash(verifier), "hex").toString("base64url"),
      code_challenge_method: "S256",
    }))
      target.searchParams.set(k, v);
    return json(res, 200, { url: target.toString() });
  }
  const state = u.searchParams.get("state"),
    code = u.searchParams.get("code");
  const row = await ctx.repo.consumeOAuthState(
    hash(state || ""),
    actor.workspaceId,
    actor.user.id,
    pluginId,
  );
  if (!row || !code)
    throw new AppError(
      "INVALID_OAUTH",
      "OAuth callback is invalid or expired.",
      400,
    );
  const token = await ctx.connectors.exchangeOAuth(
    provider,
    code,
    redirectUri,
    config,
    ctx.box.decrypt(row.verifier_ciphertext),
  );
  const old = (
    await ctx.repo.plugins.list(actor.workspaceId, { limit: 100 })
  ).items.find((c) => c.pluginId === pluginId);
  const fields = {
    pluginId,
    name: definition.name,
    baseUrl: definition.defaultBaseUrl,
    authScheme: "bearer",
    enabled: true,
    oauthProvider: provider,
    credential: ctx.box.encrypt(token),
  };
  if (old) await ctx.repo.plugins.update(actor.workspaceId, old.id, fields);
  else await ctx.repo.plugins.create(actor.workspaceId, fields);
  await ctx.repo.audit(actor, "plugin.oauth_connected", { pluginId });
  res.writeHead(302, { location: "/?plugin=connected" });
  res.end();
}

export async function oauthLanding({ p, method, u, res }) {
  if (
    /^\/api\/plugins\/oauth\/[^/]+\/callback$/.test(p) &&
    method === "GET" &&
    u.searchParams.get("continue") !== "1"
  ) {
    if (!u.searchParams.get("state") || !u.searchParams.get("code"))
      throw new AppError("INVALID_OAUTH", "OAuth callback is invalid.", 400);
    u.searchParams.set("continue", "1");
    const target = (u.pathname + u.search).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    res.end(
      '<!doctype html><html lang="en"><meta charset="utf-8"><title>Complete Fabric connection</title><main><h1>Complete your connection</h1><p>Continue securely to your Fabric workspace.</p><a href="' +
        target +
        '">Complete connection</a></main></html>',
    );
    return;
  }
}
