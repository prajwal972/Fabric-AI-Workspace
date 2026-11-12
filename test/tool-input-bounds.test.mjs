import test from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry, ToolGateway } from "../src/tools/gateway.mjs";
import { registerBuiltins } from "../src/tools/builtins.mjs";
test("built-in network/file schemas reject oversized identifiers before executing", () => {
  const registry = new ToolRegistry();
  registerBuiltins(registry, {});
  for (const name of ["read_file", "delete_file"])
    assert.equal(
      registry.tools.get(name).input.safeParse({ fileId: "x".repeat(201) })
        .success,
      false,
    );
  assert.equal(
    registry.tools
      .get("search_knowledge")
      .input.safeParse({ query: "fixture", fileIds: ["x".repeat(201)] })
      .success,
    false,
  );
  assert.equal(
    registry.tools
      .get("safe_http")
      .input.safeParse({ url: "https://example.test/?q=" + "x".repeat(4000) })
      .success,
    false,
  );
  assert.equal(
    registry.tools.get("read_file").input.safeParse({ fileId: "fil_fixture" })
      .success,
    true,
  );
});
test("tool execution validates identity and nondeleted membership at its own boundary", async () => {
  let queried = false;
  const gateway = new ToolGateway({
    registry: new ToolRegistry(),
    repo: {
      pool: {
        query: async (sql) => {
          queried = true;
          assert.match(sql, /JOIN users/);
          assert.match(sql, /JOIN workspaces/);
          assert.match(sql, /deleted_at IS NULL/);
          return { rows: [] };
        },
      },
    },
  });
  await assert.rejects(gateway.execute(null, "clock", {}), {
    code: "UNAUTHORIZED",
  });
  assert.equal(queried, false);
  await assert.rejects(
    gateway.execute(
      { workspaceId: "ws", user: { id: "u" }, role: "owner" },
      "clock",
      {},
    ),
    { code: "FORBIDDEN_TOOL" },
  );
  assert.equal(queried, true);
});
