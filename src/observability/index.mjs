import pino from "pino";
import client from "prom-client";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { service: "fabric", version: "1.10.4" },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.apiKey",
      "*.token",
      "*.secret",
      "*.credential",
      "*.document",
      "*.audio",
    ],
    censor: "[REDACTED]",
  },
});

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: "fabric_" });

const requests = new client.Counter({
  name: "fabric_http_requests_total",
  help: "HTTP requests completed",
  labelNames: ["method", "route", "status"],
  registers: [registry],
});
const duration = new client.Histogram({
  name: "fabric_http_request_duration_seconds",
  help: "HTTP request duration",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 60],
  registers: [registry],
});
export const activeGenerations = new client.Gauge({
  name: "fabric_ai_active_generations",
  help: "Active AI streaming generations",
  registers: [registry],
});
export const providerFailures = new client.Counter({
  name: "fabric_ai_provider_failures_total",
  help: "AI provider failures",
  labelNames: ["provider_type", "code"],
  registers: [registry],
});

const normalizedRoute = (url = "") => {
  const p = String(url).split("?")[0];
  if (!p.startsWith("/api/")) return "/static";
  const plain = new Set([
    "live",
    "ready",
    "health",
    "metrics",
    "runtime",
    "me",
    "dashboard",
    "providers",
    "conversations",
    "chat/stream",
    "chat/compare",
    "modes",
    "research/settings",
    "files",
    "files/upload",
    "jobs",
    "agents",
    "agents/run",
    "agents/data-state",
    "agents/data-profile",
    "agents/data-analyst",
    "agents/dashboard-operation",
    "tools",
    "tools/execute",
    "approvals",
    "memory",
    "usage",
    "artifacts",
    "voice/config",
    "voice/transcribe",
    "voice/synthesize",
    "plugins",
    "plugins/connect",
    "logs",
    "auth/register",
    "auth/login",
    "auth/logout",
    "auth/recover",
    "auth/confirm",
    "auth/sessions",
    "auth/verify-email",
    "workspaces",
    "workspaces/switch",
  ]);
  const suffix = p.slice(5);
  if (plain.has(suffix)) return p;
  const match = p.match(
    /^\/api\/(providers|conversations|files|jobs|approvals|memory|artifacts|agents\/runs|auth\/sessions|workspaces|plugins\/connections|plugins\/oauth)\/[^/]+(?:\/(models|validate|default|warm|download|retry|cancel|members|test|execute|start|callback))?$/,
  );
  return match
    ? "/api/" + match[1] + "/:id" + (match[2] ? "/" + match[2] : "")
    : "/api/:unmatched";
};

export function observeRequest(req, res) {
  const started = process.hrtime.bigint();
  res.once("finish", () => {
    const route = normalizedRoute(req.url);
    const status = String(res.statusCode);
    const labels = { method: req.method || "UNKNOWN", route, status };
    requests.inc(labels);
    duration.observe(labels, Number(process.hrtime.bigint() - started) / 1e9);
    logger.info({
      event: "http.request",
      requestId: req.rid,
      method: req.method,
      route,
      status: res.statusCode,
    });
  });
}

export async function metricsText() {
  return registry.metrics();
}
