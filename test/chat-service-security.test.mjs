import test from "node:test";
import assert from "node:assert/strict";
import { ChatService } from "../src/services/chat.mjs";
const actor = { workspaceId: "ws", user: { id: "user" }, role: "owner" };
test("chat destroys a leased connection after failed advisory unlock", async () => {
  let released;
  const client = {
    query: async (sql) => {
      if (sql.includes("try_advisory")) return { rows: [{ locked: true }] };
      throw new Error("unlock failure");
    },
    release: (broken) => {
      released = broken;
    },
  };
  const service = new ChatService({
    repo: { pool: { connect: async () => client } },
  });
  service.streamClaimed = async () => 42;
  assert.equal(
    await service.stream(actor, { conversationId: "c" }, () => {}),
    42,
  );
  assert.equal(released, true);
});
test("chat releases normally after handler failure and refuses competing claims", async () => {
  let released;
  const client = {
    query: async (sql) => ({
      rows: [
        sql.includes("try_advisory") ? { locked: true } : { unlocked: true },
      ],
    }),
    release: (broken) => (released = broken),
  };
  const service = new ChatService({
    repo: { pool: { connect: async () => client } },
  });
  service.streamClaimed = async () => {
    throw new Error("handler failure");
  };
  await assert.rejects(
    service.stream(actor, { conversationId: "c" }, () => {}),
    /handler failure/,
  );
  assert.equal(released, false);
  client.query = async () => ({ rows: [{ locked: false }] });
  await assert.rejects(
    service.stream(actor, { conversationId: "c" }, () => {}),
    { code: "CONVERSATION_BUSY" },
  );
  assert.equal(released, false);
});
test("chat checks fresh membership before accessing conversation or saving messages", async () => {
  for (const member of [undefined, { role: "viewer" }, { role: "unknown" }]) {
    let accessed = false;
    const queries = [];
    const service = new ChatService({
      repo: {
        pool: {
          query: async (sql, params) => {
            queries.push({ sql, params });
            return { rows: member ? [member] : [] };
          },
        },
        createMessage: async () => {
          accessed = true;
        },
      },
      conversations: {
        get: async () => {
          accessed = true;
        },
      },
    });
    await assert.rejects(
      service.streamClaimed(actor, { conversationId: "c" }, () => {}),
      { code: "FORBIDDEN" },
    );
    assert.equal(accessed, false);
    assert.deepEqual(queries[0].params, ["ws", "user"]);
    assert.match(queries[0].sql, /deleted_at IS NULL/);
  }
});
test("chat refuses missing actor before performing membership SQL", async () => {
  let queried = false;
  const service = new ChatService({
    repo: {
      pool: {
        query: async () => {
          queried = true;
        },
      },
    },
  });
  for (const a of [null, {}, { workspaceId: "ws", user: {} }])
    await assert.rejects(
      service.streamClaimed(a, {}, () => {}),
      { code: "UNAUTHORIZED" },
    );
  assert.equal(queried, false);
});
