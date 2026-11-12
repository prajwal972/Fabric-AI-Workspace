import { authPublicRoutes } from "./auth-public.mjs";
import { oauthLanding } from "./plugins.mjs";
import { authRoutes } from "./auth.mjs";
import { workspacesRoutes } from "./workspaces.mjs";
import { dashboardRoutes } from "./dashboard.mjs";
import { providersRoutes } from "./providers.mjs";
import { chatRoutes } from "./chat.mjs";
import { researchRoutes } from "./research.mjs";
import { nativeRoutes } from "./native.mjs";
import { filesRoutes } from "./files.mjs";
import { jobsRoutes } from "./jobs.mjs";
import { analystRoutes } from "./analyst.mjs";
import { agentsRoutes } from "./agents.mjs";
import { toolsRoutes } from "./tools.mjs";
import { memoryRoutes } from "./memory.mjs";
import { usageRoutes } from "./usage.mjs";
import { artifactsRoutes } from "./artifacts.mjs";
import { voiceRoutes } from "./voice.mjs";
import { pluginsRoutes } from "./plugins.mjs";
import { workflowsRoutes } from "./workflows.mjs";
import { auditRoutes } from "./audit.mjs";
export const featureRoutes = Object.freeze([
  { name: "auth", prefixes: ["/api/auth/"], handle: authRoutes },
  {
    name: "workspaces",
    prefixes: ["/api/workspaces"],
    handle: workspacesRoutes,
  },
  { name: "dashboard", prefixes: ["/api/dashboard"], handle: dashboardRoutes },
  { name: "providers", prefixes: ["/api/providers"], handle: providersRoutes },
  {
    name: "chat",
    prefixes: ["/api/conversations", "/api/messages/", "/api/chat/"],
    handle: chatRoutes,
  },
  {
    name: "research",
    prefixes: ["/api/modes", "/api/research/settings"],
    handle: researchRoutes,
  },
  { name: "native", prefixes: ["/api/native/"], handle: nativeRoutes },
  { name: "files", prefixes: ["/api/files"], handle: filesRoutes },
  { name: "jobs", prefixes: ["/api/jobs"], handle: jobsRoutes },
  {
    name: "analyst",
    prefixes: ["/api/agents/data-", "/api/agents/dashboard-operation"],
    handle: analystRoutes,
  },
  { name: "agents", prefixes: ["/api/agents"], handle: agentsRoutes },
  {
    name: "tools",
    prefixes: ["/api/tools", "/api/approvals"],
    handle: toolsRoutes,
  },
  { name: "memory", prefixes: ["/api/memory"], handle: memoryRoutes },
  { name: "usage", prefixes: ["/api/usage"], handle: usageRoutes },
  { name: "artifacts", prefixes: ["/api/artifacts"], handle: artifactsRoutes },
  { name: "voice", prefixes: ["/api/voice/"], handle: voiceRoutes },
  { name: "plugins", prefixes: ["/api/plugins"], handle: pluginsRoutes },
  { name: "workflows", prefixes: ["/api/workflows"], handle: workflowsRoutes },
  { name: "audit", prefixes: ["/api/logs"], handle: auditRoutes },
]);
const responded = (res) =>
  res.writableEnded || res.headersSent || res.destroyed;
export async function dispatchFeatures(request) {
  for (const route of featureRoutes) {
    if (
      !route.prefixes.some(
        (prefix) =>
          request.p === prefix ||
          (prefix.endsWith("/") || prefix.endsWith("-")
            ? request.p.startsWith(prefix)
            : request.p.startsWith(prefix + "/")),
      )
    )
      continue;
    await route.handle(request);
    if (responded(request.res)) return true;
  }
  return false;
}
export async function dispatchPublic(request) {
  if (
    [
      "/api/auth/register",
      "/api/auth/login",
      "/api/auth/recover",
      "/api/auth/confirm",
    ].includes(request.p)
  ) {
    await authPublicRoutes(request);
    if (responded(request.res)) return true;
  }
  await oauthLanding(request);
  return !!responded(request.res);
}
