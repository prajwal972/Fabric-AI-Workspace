import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseFile } from "../src/files/parser-process.mjs";
import { FileService } from "../src/files/service.mjs";
async function local(t, name, text) {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "fabric-parser-correct-"),
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const p = path.join(dir, name);
  await fs.writeFile(p, text);
  return p;
}
test("real parser subprocess preserves canonical CSV errors without submitted content or paths", async (t) => {
  const p = await local(t, "bad.csv", 'SecretLabel,Value\n"secret invalid,2');
  const files = new FileService({});
  await assert.rejects(
    files.parse(p, { name: "bad.csv", kind: "text" }),
    (error) => {
      assert.equal(error.code, "DATASET_CSV_INVALID");
      assert.doesNotMatch(
        error.message,
        /SecretLabel|secret invalid|fabric-parser|\/tmp/,
      );
      return true;
    },
  );
});
test("structured CSV null bytes and duplicate headers fail before ready text is returned", async (t) => {
  for (const [text, code] of [
    ["A,B\n1\0,2", "DATASET_NUL"],
    ["A,A\n1,2", "DATASET_COLUMNS"],
  ]) {
    const p = await local(t, "bad.csv", text);
    await assert.rejects(parseFile(p, "bad.csv", "text"), { code });
  }
});
test("invalid JSON is not promoted to extracted valid data; nested valid JSON remains available to document RAG", async (t) => {
  const bad = await local(t, "bad.json", '{"missing":');
  await assert.rejects(parseFile(bad, "bad.json", "text"), {
    code: "DATASET_JSON_INVALID",
  });
  const valid = await local(t, "valid.json", '{"nested":{"value":1}}');
  assert.equal(
    (await parseFile(valid, "valid.json", "text")).text,
    '{"nested":{"value":1}}',
  );
});

test("malformed UTF-8 structured files are rejected instead of silently changing cell values", async (t) => {
  const p = await local(
    t,
    "invalid.csv",
    Buffer.from([65, 44, 66, 10, 49, 44, 0xff]),
  );
  await assert.rejects(parseFile(p, "invalid.csv", "text"), {
    code: "DATASET_ENCODING",
  });
});

test("real parser subprocess preserves duplicate JSON errors without exposing private field labels", async (t) => {
  const p = await local(
    t,
    "private.json",
    '{"PrivateCustomerField":1,"PrivateCustomerField":2}',
  );
  await assert.rejects(
    new FileService({}).parse(p, { name: "private.json", kind: "text" }),
    (error) => {
      assert.equal(error.code, "DATASET_JSON_DUPLICATE_KEY");
      assert.doesNotMatch(
        error.message,
        /PrivateCustomerField|fabric-parser|\/tmp/,
      );
      return true;
    },
  );
});
