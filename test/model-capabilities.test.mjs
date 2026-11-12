import test from "node:test";
import assert from "node:assert/strict";
import { OllamaAdapter } from "../src/ai/providers.mjs";
import { ModelCapabilityResolver } from "../src/ai/model-capabilities.mjs";
import { AIGateway } from "../src/ai/gateway.mjs";
const row = {
    id: "p",
    type: "ollama",
    enabled: true,
    config: {
      baseUrl: "http://127.0.0.1:11434",
      defaultModel: "fixture",
      contextWindow: 4096,
    },
  },
  actor = { workspaceId: "ws", user: { id: "u" } };
test("Ollama tools are unknown/disabled until bounded model metadata is inspected", async () => {
  const adapter = new OllamaAdapter(row, { env: { NODE_ENV: "test" } });
  assert.equal(adapter.getCapabilities().tools, false);
  adapter.request = async (path, input) => {
    assert.equal(path, "/api/show");
    assert.deepEqual(input, { model: "fixture", verbose: false });
    return new Response(
      JSON.stringify({
        capabilities: ["completion", "tools", "vision"],
        model_info: { "fixture.context_length": 32000 },
        template: "private fixture template not retained",
      }),
    );
  };
  const caps = await adapter.inspectModel("fixture");
  assert.equal(caps.tools, true);
  assert.equal(caps.contextWindow, 4096);
  assert.equal(caps.capabilitySource, "ollama_show");
  assert.equal(caps.template, undefined);
  assert.equal(caps.embeddings, false);
});
test("text-only and embedding-only models are not treated as tool-enabled chat models", async () => {
  const adapter = new OllamaAdapter(row, { env: { NODE_ENV: "test" } });
  adapter.request = async () =>
    new Response(JSON.stringify({ capabilities: ["completion"] }));
  assert.equal((await adapter.inspectModel("text")).tools, false);
  adapter.request = async () =>
    new Response(JSON.stringify({ capabilities: ["embedding"] }));
  const embedding = await adapter.inspectModel("embed");
  assert.equal(embedding.completion, false);
  assert.equal(embedding.embeddings, true);
});
test("malformed capability metadata fails instead of inventing supported features", async () => {
  const adapter = new OllamaAdapter(row, { env: { NODE_ENV: "test" } });
  for (const data of [
    {},
    { capabilities: [42] },
    { capabilities: Array(33).fill("tools") },
  ]) {
    adapter.request = async () => new Response(JSON.stringify(data));
    await assert.rejects(adapter.inspectModel("fixture"), {
      code: "INVALID_MODEL_METADATA",
    });
  }
});
test("capability cache is bounded and scoped to workspace/model/provider configuration", async () => {
  const resolver = new ModelCapabilityResolver({ maxEntries: 2 });
  let calls = 0;
  const adapter = {
    getCapabilities: () => ({ tools: false, contextWindow: 4096 }),
    inspectModel: async () => {
      calls++;
      return { tools: true, completion: true, contextWindow: 4096 };
    },
  };
  await resolver.resolve(actor, row, "a", adapter);
  await resolver.resolve(actor, row, "a", adapter);
  assert.equal(calls, 1);
  await resolver.resolve({ ...actor, workspaceId: "other" }, row, "a", adapter);
  await resolver.resolve(
    actor,
    { ...row, config: { ...row.config, baseUrl: "http://other.test" } },
    "a",
    adapter,
  );
  assert.equal(calls, 3);
  assert.equal(resolver.entries.size, 2);
  resolver.clear();
  assert.equal(resolver.entries.size, 0);
});
test("metadata failure is an explicit unverified text-only fallback and cancellation is preserved", async () => {
  const resolver = new ModelCapabilityResolver();
  let calls = 0;
  const adapter = {
    getCapabilities: () => ({ tools: true, contextWindow: 4096 }),
    inspectModel: async () => {
      calls++;
      throw new Error("private metadata failure");
    },
  };
  const caps = await resolver.resolve(actor, row, "fixture", adapter);
  assert.equal(caps.tools, false);
  assert.equal(caps.capabilitiesVerified, false);
  assert.equal(caps.capabilitySource, "unavailable");
  assert.equal(caps.message, undefined);
  await resolver.resolve(actor, row, "fixture", adapter);
  assert.equal(calls, 1);
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    resolver.resolve(actor, row, "fixture", adapter, c.signal),
    { name: "AbortError" },
  );
});
test("gateway refuses native tool requests for a discovered text-only model before generation", async () => {
  const gateway = new AIGateway({
    repo: { providers: { list: async () => ({ items: [row] }) } },
    env: { NODE_ENV: "test" },
  });
  let generated = false;
  gateway.adapter = () => ({
    getCapabilities: () => ({ tools: false, contextWindow: 4096 }),
    inspectModel: async () => ({
      tools: false,
      completion: true,
      contextWindow: 4096,
    }),
    async *stream() {
      generated = true;
      yield { text: "must not happen" };
    },
  });
  await assert.rejects(
    (async () => {
      for await (const ignored of gateway.stream(actor, {
        messages: [],
        tools: [{ name: "calculator" }],
      }))
        void ignored;
    })(),
    { code: "TOOLS_UNSUPPORTED" },
  );
  assert.equal(generated, false);
});
test("gateway rejects an embedding-only model as chat without inventing usage", async () => {
  const gateway = new AIGateway({
    repo: { providers: { list: async () => ({ items: [row] }) } },
    env: { NODE_ENV: "test" },
  });
  gateway.adapter = () => ({
    getCapabilities: () => ({ tools: false, contextWindow: 4096 }),
    inspectModel: async () => ({
      tools: false,
      completion: false,
      contextWindow: 4096,
    }),
  });
  await assert.rejects(gateway.generate(actor, { messages: [] }), {
    code: "MODEL_CHAT_UNSUPPORTED",
  });
});

test("model cache rejects invalid bounds rather than becoming unbounded", () => {
  for (const options of [
    { maxEntries: 0 },
    { maxEntries: 1001 },
    { ttlMs: Infinity },
    { ttlMs: 0 },
  ])
    assert.throws(() => new ModelCapabilityResolver(options), TypeError);
});
test("tool schemas consume the estimated context budget before any generation", async () => {
  const gateway = new AIGateway({
    repo: { providers: { list: async () => ({ items: [row] }) } },
    env: { NODE_ENV: "test" },
  });
  let generated = false;
  gateway.adapter = () => ({
    getCapabilities: () => ({ tools: true, contextWindow: 4096 }),
    inspectModel: async () => ({
      tools: true,
      completion: true,
      contextWindow: 4096,
    }),
    async *stream() {
      generated = true;
      yield { text: "must not happen" };
    },
  });
  const tools = [
    {
      name: "large_fixture",
      description: "x".repeat(20000),
      inputSchema: { type: "object" },
    },
  ];
  assert.ok(
    gateway.countTokens([], tools).tokens > gateway.countTokens([]).tokens,
  );
  await assert.rejects(
    gateway.generate(actor, { messages: [], tools, maxTokens: 100 }),
    { code: "CONTEXT_LIMIT" },
  );
  assert.equal(generated, false);
});
