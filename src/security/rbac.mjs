const ROLE_PERMISSIONS = Object.freeze({
  owner: new Set(["*"]),
  admin: new Set(["*"]),
  member: new Set([
    "workspace.read",
    "workspace.write",
    "chat.write",
    "files.write",
    "analyst.run",
    "tools.execute",
    "plugins.execute",
  ]),
  viewer: new Set(["workspace.read"]),
});

export function can(role, permission) {
  const permissions = ROLE_PERMISSIONS[role] || new Set();
  return permissions.has("*") || permissions.has(permission);
}

export function requiredPermission(method, pathname) {
  if (pathname === "/api/auth/logout") return "workspace.read";
  // Every member may control personal memory opt-out; workspace changes remain admin-only in the service.
  if (method === "PATCH" && pathname === "/api/memory") return "workspace.read";
  if (pathname.startsWith("/api/plugins/oauth/")) return "workspace.admin";
  if (method === "GET") {
    if (pathname === "/api/logs") return "audit.read";
    return "workspace.read";
  }
  if (
    pathname.startsWith("/api/native/") ||
    pathname.startsWith("/api/providers") ||
    (pathname === "/api/research/settings" && method === "PATCH") ||
    pathname.startsWith("/api/plugins/oauth/")
  )
    return "workspace.admin";
  if (
    /^\/api\/plugins\/connections\/[^/]+$/.test(pathname) &&
    method === "DELETE"
  )
    return "workspace.admin";
  if (
    pathname.includes("/plugins/connections/") ||
    pathname === "/api/plugins/connect"
  )
    return "plugins.execute";
  if (
    pathname.startsWith("/api/chat") ||
    pathname.startsWith("/api/conversations")
  )
    return "chat.write";
  if (
    pathname.startsWith("/api/files") ||
    pathname.startsWith("/api/artifacts")
  )
    return "files.write";
  if (
    pathname.startsWith("/api/agents/data") ||
    pathname === "/api/agents/dashboard-operation"
  )
    return "analyst.run";
  if (
    pathname.startsWith("/api/tools") ||
    pathname.startsWith("/api/agents/run")
  )
    return "tools.execute";
  return "workspace.write";
}

export const roles = Object.freeze(Object.keys(ROLE_PERMISSIONS));
