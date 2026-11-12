import test from "node:test";
import assert from "node:assert/strict";
import { ChatService } from "../src/services/chat.mjs";
import { AppError } from "../src/server/errors.mjs";
// Unit service doubles; real PostgreSQL/model/browser integration remains separate.
const actor = { workspaceId: "ws", user: { id: "u" }, role: "owner" };
function fixture({
  sources = [],
  fallback = false,
  toolEvents = [],
  answer = "Fixture answer [1].",
  history = [],
} = {}) {
  const events = [],
    saved = [],
    requests = [];
  const files = {
    f1: {
      id: "f1",
      status: "ready",
      name: "fixture.txt",
      text: "Real fixture file excerpt",
    },
  };
  const repo = {
    pool: { query: async () => ({ rows: [{ role: "member" }] }) },
    files: {
      require: async (ws, id) => {
        assert.equal(ws, "ws");
        return (
          files[id] || {
            id,
            status: "ready",
            name: id + ".txt",
            text: "Fixture text",
          }
        );
      },
    },
    createMessage: async (a, c, record) => {
      saved.push(record);
      return { id: "user-message", ...record };
    },
    activeMessages: async () => [
      ...history,
      { role: "user", status: "complete", content: "Fixture question" },
    ],
    completeAssistantReply: async (a, c, record) => {
      saved.push(record);
      return { id: "reply", ...record };
    },
    providers: { require: async () => ({ id: "p" }) },
  };
  const provider = {
    id: "p",
    name: "Protocol unit fixture",
    config: { defaultModel: "fixture" },
  };
  const ai = {
    choose: async () => provider,
    getCapabilities: () => ({ tools: false }),
    async *stream(a, options) {
      assert.equal(a.role, "member");
      requests.push(options);
      for (const event of toolEvents) await options.onEvent(event);
      yield { text: answer };
      yield { usage: { providerId: "p", model: "fixture" } };
    },
  };
  const chat = new ChatService({
    repo,
    conversations: {
      get: async () => ({
        id: "c",
        title: "Fixture chat",
        systemInstructions: "",
      }),
    },
    ai,
    rag: {
      retrieve: async () => {
        if (fallback)
          throw new AppError(
            "EMBEDDING_PROVIDER_REQUIRED",
            "Embedding not configured",
            409,
          );
        return sources;
      },
    },
    memory: { retrieve: async () => [] },
    research: { bundle: async () => sources },
    connectors: {},
  });
  const run = (input = {}) =>
    chat.streamClaimed(
      actor,
      { conversationId: "c", content: "Fixture question", ...input },
      async (type, data) => events.push({ type, data }),
    );
  return { run, events, saved, requests };
}
const source = (id = 1, text = "Fixture chunk text") => ({
  id: 1,
  fileId: "f" + id,
  chunkId: "chunk" + id,
  title: "File " + id,
  page: 1,
  text,
});
test("RAG chat persists source hashes and citation-ID validation without full excerpt metadata", async () => {
  const f = fixture({ sources: [source()] });
  const reply = await f.run({ includeFileContext: true, fileIds: ["f1"] });
  assert.equal(reply.metadata.citationValidation.status, "valid_source_ids");
  assert.equal(
    reply.metadata.citationValidation.semanticSupportVerified,
    false,
  );
  assert.equal(reply.metadata.sources[0].text, undefined);
  assert.match(reply.metadata.sources[0].excerptHash, /^[a-f0-9]{64}$/);
  assert.equal(
    f.events.find((e) => e.type === "meta").data.sources[0].text,
    undefined,
  );
  assert.match(f.requests[0].messages.at(-1).content, /Fixture chunk text/);
});
test("explicit attachment fallback receives real file provenance instead of uncitable prompt text", async () => {
  const f = fixture({ fallback: true });
  const reply = await f.run({ includeFileContext: true, fileIds: ["f1"] });
  assert.equal(reply.metadata.sources[0].sourceType, "file_excerpt");
  assert.equal(reply.metadata.sources[0].url, "/api/files/f1/download");
  assert.match(
    f.requests[0].messages.at(-1).content,
    /Real fixture file excerpt/,
  );
});
test("budget-omitted sources cannot be cited as successfully supplied evidence", async () => {
  const f = fixture({
    sources: Array.from({ length: 6 }, (_, i) =>
      source(i + 1, "x".repeat(12000)),
    ),
    answer: "Unsupported claim [6].",
  });
  await assert.rejects(
    f.run({ includeFileContext: true, fileIds: ["f1"], performance: "fast" }),
    { code: "INVALID_CITATION" },
  );
  assert.equal(f.saved.at(-1).status, "error");
  assert.equal(f.saved.at(-1).error, "INVALID_CITATION");
  assert.ok(f.events.find((e) => e.type === "meta").data.sources.length < 6);
  assert.equal(
    f.events.some((e) => e.type === "done"),
    false,
  );
});
test("successive knowledge tools share stable current-turn source IDs visible to the model", async () => {
  const first = {
      name: "search_knowledge",
      status: "completed",
      result: { sources: [source(1)] },
    },
    second = {
      name: "search_knowledge",
      status: "completed",
      result: { sources: [source(2)] },
    };
  const f = fixture({
    toolEvents: [first, second],
    answer: "Second source [2].",
  });
  const reply = await f.run();
  assert.deepEqual(
    reply.metadata.sources.map((s) => s.id),
    [1, 2],
  );
  assert.equal(first.result.sources[0].id, 1);
  assert.equal(second.result.sources[0].id, 2);
  assert.equal(second.result.sources[0].text, "Fixture chunk text");
});
test("read-file tool receives a bounded excerpt and authoritative citation ID", async () => {
  const tool = {
    name: "read_file",
    status: "completed",
    result: { fileId: "f1", name: "fixture.txt", text: "a".repeat(50000) },
  };
  const f = fixture({ toolEvents: [tool] });
  const reply = await f.run();
  assert.equal(tool.result.citationSourceId, 1);
  assert.ok(tool.result.text.length <= 8000);
  assert.equal(tool.result.evidenceTruncated, true);
  assert.equal(reply.metadata.sources[0].sourceType, "file_excerpt");
});
test("failed research pages are not declared read evidence and false citations fail", async () => {
  const f = fixture({
    sources: [
      {
        url: "https://example.test/failed",
        title: "Failed page",
        text: "placeholder",
        readStatus: "unavailable",
      },
    ],
  });
  await assert.rejects(f.run({ mode: "research" }), {
    code: "INVALID_CITATION",
  });
  assert.deepEqual(f.events.find((e) => e.type === "meta").data.sources, []);
  assert.match(
    f.requests[0].messages.at(-1).content,
    /No readable research evidence/,
  );
});
test("source-less general code examples remain compatible and historical IDs need fresh evidence", async () => {
  const general = fixture({ answer: "Example array [99]." });
  assert.equal(
    (await general.run()).metadata.citationValidation.status,
    "not_applicable",
  );
  const historical = fixture({
    history: [
      {
        role: "assistant",
        status: "complete",
        content: "Earlier fact [1].",
        sources: [{ id: 1, url: "/api/files/old/download" }],
      },
    ],
  });
  await assert.rejects(historical.run(), { code: "INVALID_CITATION" });
});
test("supplied but uncited evidence does not acquire a false semantic-verification label", async () => {
  const f = fixture({
    sources: [source()],
    answer: "No numbered citations in this fixture.",
  });
  const reply = await f.run({ includeFileContext: true, fileIds: ["f1"] });
  assert.equal(reply.metadata.citationValidation.status, "not_cited");
  assert.deepEqual(reply.metadata.citationValidation.usedSourceIds, []);
  assert.equal(
    reply.metadata.citationValidation.semanticSupportVerified,
    false,
  );
});
