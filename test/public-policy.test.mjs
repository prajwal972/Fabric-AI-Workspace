import test from "node:test";
import assert from "node:assert/strict";
import {
  publicControls,
  assertRegistrationAllowed,
  AIRequestPolicy,
} from "../src/security/public-policy.mjs";
import { AIQuotaRepository } from "../src/repositories/ai-quota.mjs";
import { AIGateway } from "../src/ai/gateway.mjs";
import { AuthService } from "../src/auth/service.mjs";
import { AppError } from "../src/server/errors.mjs";
const actor = { workspaceId: "ws", user: { id: "user" }, role: "owner" };
const local = {
  id: "p",
  type: "ollama",
  enabled: true,
  config: { defaultModel: "fixture" },
};
const collect = async (iterable) => {
  const output = [];
  for await (const event of iterable) output.push(event);
  return output;
};
test("production public-use defaults are conservative without changing local setup", () => {
  const prod = publicControls({ NODE_ENV: "production" });
  assert.equal(prod.FABRIC_REGISTRATION_MODE, "closed");
  assert.equal(prod.FABRIC_ALLOW_CLOUD_AI, false);
  assert.equal(prod.FABRIC_REQUIRE_EMAIL_VERIFICATION, true);
  assert.equal(prod.FABRIC_AI_USER_DAILY_REQUESTS, 25);
  const dev = publicControls({ NODE_ENV: "development" });
  assert.equal(dev.FABRIC_REGISTRATION_MODE, "open");
  assert.equal(dev.FABRIC_ALLOW_CLOUD_AI, true);
  assert.equal(dev.FABRIC_REQUIRE_EMAIL_VERIFICATION, false);
  assert.equal(
    publicControls({ FABRIC_ALLOW_CLOUD_AI: "false" }).FABRIC_ALLOW_CLOUD_AI,
    false,
  );
});
test("open production signup requires real email configuration and verification", () => {
  assert.throws(
    () =>
      publicControls({
        NODE_ENV: "production",
        FABRIC_REGISTRATION_MODE: "open",
        FABRIC_REQUIRE_EMAIL_VERIFICATION: "false",
      }),
    /verification/,
  );
  assert.throws(
    () =>
      publicControls({
        NODE_ENV: "production",
        FABRIC_REGISTRATION_MODE: "open",
      }),
    /transactional email/,
  );
  assert.equal(
    publicControls({
      NODE_ENV: "production",
      FABRIC_REGISTRATION_MODE: "open",
      FABRIC_SMTP_URL: "smtp://fixture",
      FABRIC_EMAIL_FROM: "fixture@example.test",
    }).FABRIC_REGISTRATION_MODE,
    "open",
  );
});
test("invalid booleans and unbounded limits fail safe without echoing values", () => {
  for (const extra of [
    { FABRIC_ALLOW_CLOUD_AI: "yes" },
    { FABRIC_AI_USER_DAILY_REQUESTS: 0 },
    { FABRIC_AI_WORKSPACE_DAILY_REQUESTS: Infinity },
    { FABRIC_AI_MAX_OUTPUT_TOKENS: 999999 },
  ])
    assert.throws(
      () => publicControls(extra),
      /Invalid public-use configuration/,
    );
});
test("registration closes at the service boundary before hashing or writing", async () => {
  const auth = new AuthService({
    production: true,
    pool: {
      query: () => {
        throw Error("Must not write");
      },
    },
    env: {},
  });
  auth.password = () => {
    throw Error("Must not hash");
  };
  await assert.rejects(auth.register({}), { code: "REGISTRATION_CLOSED" });
  assert.throws(
    () => assertRegistrationAllowed({ FABRIC_REGISTRATION_MODE: "closed" }),
    { code: "REGISTRATION_CLOSED" },
  );
});
test("cloud policy denies provider attempts before quota allocation", async () => {
  let count = 0;
  const policy = new AIRequestPolicy({
    env: { FABRIC_ALLOW_CLOUD_AI: "false" },
    quota: { admit: async () => count++ },
  });
  for (const type of ["openai-compatible", "anthropic", "unknown"])
    await assert.rejects(policy.admit(actor, { ...local, type }), {
      code: "AI_CLOUD_DISABLED",
    });
  assert.equal(count, 0);
  await policy.admit(actor, local);
  assert.equal(count, 1);
});
test("admission requires an actor, enabled provider, live quota and uncancelled request", async () => {
  const policy = new AIRequestPolicy({ env: {} });
  await assert.rejects(policy.admit({}, local), { code: "UNAUTHORIZED" });
  await assert.rejects(policy.admit(actor, { ...local, enabled: false }), {
    code: "PROVIDER_DISABLED",
  });
  await assert.rejects(policy.admit(actor, local), {
    code: "AI_POLICY_UNAVAILABLE",
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(policy.admit(actor, local, controller.signal));
});
test("output limits clamp oversized requests and reject invalid values", () => {
  const policy = new AIRequestPolicy({
    env: { FABRIC_AI_MAX_OUTPUT_TOKENS: 1024 },
  });
  assert.equal(policy.outputLimit(4096), 1024);
  assert.equal(policy.outputLimit(256), 256);
  for (const n of [0, -1, 1.1, NaN])
    assert.throws(() => policy.outputLimit(n), { code: "VALIDATION_ERROR" });
});
function fixture(policy) {
  const ledger = [],
    health = [],
    repo = {
      providers: {
        list: async () => ({ items: [local] }),
        update: async (_ws, _id, value) => health.push(value),
      },
      usage: async (_actor, value) => ledger.push(value),
    };
  const gateway = new AIGateway({ repo, policy, env: {} });
  return { gateway, ledger, health };
}
test("denied chat attempts neither invoke providers nor invent token/cost usage", async () => {
  const f = fixture({
    outputLimit: (n) => n,
    admit: async () => {
      throw new AppError("AI_USER_DAILY_LIMIT", "limit", 429);
    },
  });
  let called = false;
  f.gateway.adapter = () => ({
    getCapabilities: () => ({ contextWindow: 8192, tools: true }),
    async *stream() {
      called = true;
      yield { text: "must not happen" };
    },
  });
  await assert.rejects(collect(f.gateway.stream(actor, { messages: [] })), {
    code: "AI_USER_DAILY_LIMIT",
  });
  assert.equal(called, false);
  assert.equal(f.ledger.length, 0);
  assert.equal(f.health.length, 0);
});
test("every retry has admission and its own truthful usage record", async () => {
  let admissions = 0,
    calls = 0;
  const f = fixture({ outputLimit: (n) => n, admit: async () => admissions++ });
  f.gateway.adapter = () => ({
    getCapabilities: () => ({ contextWindow: 8192, tools: true }),
    async *stream() {
      if (++calls === 1) throw new AppError("PROVIDER_ERROR", "fixture", 502);
      yield { text: "actual protocol fixture" };
      yield { usage: { inputTokens: 7, outputTokens: 3 } };
    },
  });
  await collect(f.gateway.stream(actor, { messages: [], requestId: "req" }));
  assert.equal(admissions, 2);
  assert.equal(f.ledger.length, 2);
  assert.deepEqual(
    f.ledger.map((x) => x.status),
    ["failed", "completed"],
  );
  assert.equal(new Set(f.ledger.map((x) => x.requestId)).size, 2);
  assert.equal(f.ledger[1].estimated, false);
});
test("quota denial on a retry stops rather than falling back around the guard", async () => {
  let admissions = 0,
    calls = 0;
  const f = fixture({
    outputLimit: (n) => n,
    admit: async () => {
      if (++admissions > 1)
        throw new AppError("AI_USER_DAILY_LIMIT", "limit", 429);
    },
  });
  f.gateway.adapter = () => ({
    getCapabilities: () => ({ contextWindow: 8192, tools: true }),
    async *stream() {
      calls++;
      throw new AppError("PROVIDER_ERROR", "fixture", 502);
    },
  });
  await assert.rejects(collect(f.gateway.stream(actor, { messages: [] })), {
    code: "AI_USER_DAILY_LIMIT",
  });
  assert.equal(calls, 1);
  assert.equal(f.ledger.length, 1);
});
test("tool rounds cannot exceed AI policy even when the tool itself is allowed", async () => {
  let count = 0,
    tools = 0;
  const f = fixture({
    outputLimit: (n) => n,
    admit: async () => {
      if (++count > 1)
        throw new AppError("AI_WORKSPACE_DAILY_LIMIT", "limit", 429);
    },
  });
  f.gateway.toolGateway = {
    execute: async () => {
      tools++;
      return { value: 42 };
    },
  };
  f.gateway.adapter = () => ({
    getCapabilities: () => ({ contextWindow: 8192, tools: true }),
    async *stream() {
      yield {
        toolCall: { id: "c", name: "calculator", input: { expression: "6*7" } },
      };
    },
  });
  await assert.rejects(
    collect(f.gateway.stream(actor, { messages: [], tools: [{}] })),
    { code: "AI_WORKSPACE_DAILY_LIMIT" },
  );
  assert.equal(tools, 1);
  assert.equal(f.ledger.length, 1);
});
test("embedding admission occurs before network access and fabricated embedding usage", async () => {
  const f = fixture({
    admit: async () => {
      throw new AppError("EMAIL_VERIFICATION_REQUIRED", "verify", 403);
    },
  });
  let called = false;
  f.gateway.adapter = () => ({
    getCapabilities: () => ({ embeddings: true }),
    embed: async () => {
      called = true;
      return [];
    },
  });
  await assert.rejects(f.gateway.embed(actor, ["private text"]), {
    code: "EMAIL_VERIFICATION_REQUIRED",
  });
  assert.equal(called, false);
  assert.equal(f.ledger.length, 0);
});
test("explicitly disabled embedding provider is never selected", async () => {
  const f = fixture({
    admit: async () => {
      throw Error("must not admit");
    },
  });
  f.gateway.env.FABRIC_EMBEDDING_PROVIDER_ID = "p";
  f.gateway.repo.providers.require = async () => ({ ...local, enabled: false });
  await assert.rejects(f.gateway.embed(actor, ["text"]), {
    code: "EMBEDDING_PROVIDER_REQUIRED",
  });
});
test("production gateway cannot silently run without an admission policy", async () => {
  const f = fixture();
  f.gateway.env.NODE_ENV = "production";
  f.gateway.adapter = () => ({
    getCapabilities: () => ({ contextWindow: 8192, tools: true }),
    async *stream() {
      throw Error("must not run");
    },
  });
  await assert.rejects(collect(f.gateway.stream(actor, { messages: [] })), {
    code: "AI_POLICY_UNAVAILABLE",
  });
  assert.equal(f.ledger.length, 0);
});
test("pricing accepts only explicit finite nonnegative input/output rates", () => {
  for (const pricing of [
    "null",
    "[]",
    '{"x":{"inputPerMillion":-1,"outputPerMillion":0}}',
    '{"x":{"inputPerMillion":"1","outputPerMillion":0}}',
    '{"x":{"version":"missing rates"}}',
  ])
    assert.throws(
      () => new AIGateway({ env: { FABRIC_MODEL_PRICING_JSON: pricing } }),
      /pricing configuration/,
    );
  assert.equal(
    new AIGateway({
      env: {
        FABRIC_MODEL_PRICING_JSON:
          '{"local":{"inputPerMillion":0,"outputPerMillion":0}}',
      },
    }).pricing.local.inputPerMillion,
    0,
  );
});
function quotaFixture({
  role = "member",
  verified = true,
  enabled = true,
  type = "ollama",
  userRoom = true,
  workspaceRoom = true,
} = {}) {
  const calls = [],
    repo = {
      transaction: async (fn) =>
        fn({
          pool: {
            query: async (sql, args) => {
              calls.push({ sql, args });
              if (sql.startsWith("SELECT m.role"))
                return {
                  rows: role
                    ? [
                        {
                          role,
                          email_verified_at: verified ? new Date() : null,
                        },
                      ]
                    : [],
                };
              if (sql.startsWith("SELECT enabled"))
                return { rows: [{ enabled, type }] };
              if (sql.startsWith("UPDATE ai_user"))
                return { rows: userRoom ? [{ request_count: 1 }] : [] };
              if (sql.startsWith("UPDATE ai_workspace"))
                return { rows: workspaceRoom ? [{ request_count: 1 }] : [] };
              return { rows: [] };
            },
          },
        }),
    };
  return { quota: new AIQuotaRepository(repo), calls };
}
test("quota repository rejects stale roles, verification and provider state before increments", async () => {
  for (const [options, code] of [
    [{ role: null }, "FORBIDDEN"],
    [{ role: "viewer" }, "FORBIDDEN"],
    [{ verified: false }, "EMAIL_VERIFICATION_REQUIRED"],
    [{ enabled: false }, "PROVIDER_DISABLED"],
    [{ type: "anthropic" }, "PROVIDER_CONFIGURATION_CHANGED"],
  ]) {
    const f = quotaFixture(options);
    await assert.rejects(
      f.quota.admit(
        actor,
        publicControls({ FABRIC_REQUIRE_EMAIL_VERIFICATION: true }),
        undefined,
        local,
      ),
      { code },
    );
    assert.ok(!f.calls.some((x) => x.sql.startsWith("UPDATE ai_")));
  }
});
test("quota repository uses conditional increments, scoped IDs and database UTC dates", async () => {
  const f = quotaFixture();
  assert.deepEqual(
    await f.quota.admit(actor, publicControls({}), undefined, local),
    { userUsed: 1, workspaceUsed: 1 },
  );
  const updates = f.calls.filter((x) => x.sql.startsWith("UPDATE ai_"));
  assert.equal(updates.length, 2);
  assert.match(updates[0].sql, /request_count<\$2/);
  assert.match(updates[1].sql, /request_count<\$2/);
  assert.ok(updates.every((x) => x.sql.includes("AT TIME ZONE 'UTC'")));
  assert.equal(updates[0].args[0], "user");
  assert.equal(updates[1].args[0], "ws");
});
test("each exhausted quota throws inside the repository transaction", async () => {
  for (const [options, code] of [
    [{ userRoom: false }, "AI_USER_DAILY_LIMIT"],
    [{ workspaceRoom: false }, "AI_WORKSPACE_DAILY_LIMIT"],
  ]) {
    const f = quotaFixture(options);
    await assert.rejects(
      f.quota.admit(actor, publicControls({}), undefined, local),
      { code },
    );
  }
});

test("fallback attempts retain original provider identity in each ledger entry", async () => {
  const other = {
    ...local,
    id: "alternate",
    config: { defaultModel: "other-model" },
  };
  let calls = 0;
  const f = fixture({ outputLimit: (n) => n, admit: async () => {} });
  f.gateway.repo.providers.list = async () => ({ items: [local, other] });
  f.gateway.adapter = (row) => ({
    getCapabilities: () => ({ contextWindow: 8192, tools: true }),
    async *stream() {
      calls++;
      if (row.id === "p") throw new AppError("PROVIDER_ERROR", "fixture", 502);
      yield { text: "alternate response" };
      yield { usage: { inputTokens: 5, outputTokens: 2 } };
    },
  });
  await collect(f.gateway.stream(actor, { messages: [] }));
  assert.equal(calls, 3);
  assert.deepEqual(
    f.ledger.map((x) => x.providerId),
    ["p", "p", "alternate"],
  );
  assert.deepEqual(
    f.ledger.map((x) => x.model),
    ["fixture", "fixture", "other-model"],
  );
});

test("unsafe reported token counts are estimated, not negative or overflowing ledger values", async () => {
  const f = fixture({ outputLimit: (n) => n, admit: async () => {} });
  f.gateway.adapter = () => ({
    getCapabilities: () => ({ contextWindow: 8192, tools: true }),
    async *stream() {
      yield { text: "fixture" };
      yield { usage: { inputTokens: -5, outputTokens: 99999999999999 } };
    },
  });
  await collect(
    f.gateway.stream(actor, { messages: [{ role: "user", content: "hello" }] }),
  );
  assert.equal(f.ledger[0].estimated, true);
  assert.ok(f.ledger[0].inputTokens >= 0);
  assert.ok(f.ledger[0].outputTokens < 1000);
});

test("deployment source passes the same public admission defaults to API and worker", async () => {
  const { readFile } = await import("node:fs/promises");
  const compose = await readFile("docker-compose.production.yml", "utf8");
  for (const [name, value] of Object.entries({
    FABRIC_REGISTRATION_MODE: "closed",
    FABRIC_ALLOW_CLOUD_AI: "false",
    FABRIC_REQUIRE_EMAIL_VERIFICATION: "true",
    FABRIC_AI_USER_DAILY_REQUESTS: "25",
    FABRIC_AI_WORKSPACE_DAILY_REQUESTS: "100",
    FABRIC_AI_MAX_OUTPUT_TOKENS: "4096",
  })) {
    assert.ok(compose.includes(`${name}: \${${name}:-${value}}`));
  }
  assert.equal(
    (compose.match(/environment: \*app-environment/g) || []).length,
    2,
  );
});
