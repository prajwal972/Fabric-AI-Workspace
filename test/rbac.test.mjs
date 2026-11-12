import test from "node:test";
import assert from "node:assert/strict";
import { can, requiredPermission, roles } from "../src/security/rbac.mjs";

test("RBAC defaults to deny and reserves administration for owner/admin", () => {
  assert.deepEqual(roles, ["owner", "admin", "member", "viewer"]);
  assert.equal(can("owner", "workspace.admin"), true);
  assert.equal(can("admin", "audit.read"), true);
  assert.equal(can("member", "workspace.admin"), false);
  assert.equal(can("member", "chat.write"), true);
  assert.equal(can("viewer", "workspace.read"), true);
  assert.equal(can("viewer", "workspace.write"), false);
  assert.equal(can("unknown", "workspace.read"), false);
});

test("sensitive routes require explicit administrative permissions", () => {
  assert.equal(
    requiredPermission("POST", "/api/native/install"),
    "workspace.admin",
  );
  assert.equal(requiredPermission("POST", "/api/providers"), "workspace.admin");
  assert.equal(
    requiredPermission("GET", "/api/plugins/oauth/github/start"),
    "workspace.admin",
  );
  assert.equal(requiredPermission("GET", "/api/logs"), "audit.read");
  assert.equal(
    requiredPermission("POST", "/api/plugins/connections/plu_1/execute"),
    "plugins.execute",
  );
  assert.equal(requiredPermission("POST", "/api/chat/stream"), "chat.write");
});
test("personal memory preference route allows read-only members without permitting memory writes", () => {
  assert.equal(requiredPermission("PATCH", "/api/memory"), "workspace.read");
  assert.equal(requiredPermission("POST", "/api/memory"), "workspace.write");
  assert.equal(
    requiredPermission("DELETE", "/api/memory/id"),
    "workspace.write",
  );
});
