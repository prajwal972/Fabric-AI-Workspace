import test from "node:test";
import assert from "node:assert/strict";
import {
  dispatchFeatures,
  dispatchPublic,
  featureRoutes,
} from "../src/routes/index.mjs";
import { providersRoutes } from "../src/routes/providers.mjs";
import { body, cookie } from "../src/server/http.mjs";
const response = () => ({
  headersSent: false,
  writableEnded: false,
  status: null,
  writeHead(status) {
    this.headersSent = true;
    this.status = status;
  },
  end(data) {
    this.writableEnded = true;
    this.data = JSON.parse(data);
  },
});
test("feature router rejects prefix lookalikes without invoking a service", async () => {
  const ctx = new Proxy(
    {},
    {
      get() {
        throw new Error("Unexpected service call");
      },
    },
  );
  for (const p of [
    "/api/providerssuffix",
    "/api/memoryevil",
    "/api/conversationssuffix",
    "/api/jobssuffix",
  ])
    assert.equal(await dispatchFeatures({ p, res: response(), ctx }), false);
  assert.ok(Object.isFrozen(featureRoutes));
  assert.equal(
    new Set(featureRoutes.map((r) => r.name)).size,
    featureRoutes.length,
  );
});
test("public auth dispatch recognizes only explicit endpoints, not nested suffixes", async () => {
  const ctx = new Proxy(
    {},
    {
      get() {
        throw new Error("Unexpected public service call");
      },
    },
  );
  assert.equal(
    await dispatchPublic({
      p: "/api/auth/arbitrary/login",
      method: "POST",
      ctx,
      res: response(),
    }),
    false,
  );
});
test("provider route performs one bounded repository read and preserves page fields", async () => {
  let calls = 0;
  const ctx = {
    repo: {
      providers: {
        list: async (ws, options) => {
          calls++;
          assert.equal(ws, "w");
          assert.equal(options.limit, 100);
          return {
            items: [
              {
                id: "p",
                name: "Provider",
                credential: "fixture-private-value",
              },
            ],
            nextOffset: null,
          };
        },
      },
    },
    providers: { public: (row) => ({ id: row.id, name: row.name }) },
  };
  const res = response();
  await providersRoutes({
    ctx,
    res,
    p: "/api/providers",
    method: "GET",
    actor: { workspaceId: "w" },
  });
  assert.equal(calls, 1);
  assert.deepEqual(res.data, {
    items: [{ id: "p", name: "Provider" }],
    nextOffset: null,
  });
});
test("shared HTTP parsing rejects oversized and malformed JSON and malformed cookies", async () => {
  const req = async function* (bytes) {
    yield Buffer.from(bytes);
  };
  await assert.rejects(body(req("123456"), 5), { code: "REQUEST_TOO_LARGE" });
  await assert.rejects(body(req("{broken")), { code: "INVALID_JSON" });
  assert.equal(
    cookie({ headers: { cookie: "flux_session=%zz" } }, "flux_session"),
    "",
  );
});
