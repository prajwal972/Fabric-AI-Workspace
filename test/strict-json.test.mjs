import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  parseUnambiguousJson,
  checkedJsonNumber,
} from "../src/security/strict-json.mjs";
import { parseStructuredDataset } from "../src/analyst/dataset.mjs";
import { parseFile } from "../src/files/parser-process.mjs";
import { executePlan } from "../src/services/analyst.mjs";
const file = (text) => ({ id: "f", name: "data.json", text, status: "ready" });
test("JSON rejects duplicate decoded fields at every nesting level", () => {
  for (const raw of [
    '{"Value":1,"Value":2}',
    '{"Value":1,"\\u0056alue":2}',
    '[{"a":{"x":1,"x":2}}]',
    '{"a\\\"b":1,"a\\u0022b":2}',
  ]) {
    assert.throws(() => parseUnambiguousJson(raw), {
      code: "DATASET_JSON_DUPLICATE_KEY",
    });
    assert.throws(() => parseStructuredDataset(file(raw)), {
      code: "DATASET_JSON_DUPLICATE_KEY",
    });
  }
});
test("repeated fields in different objects are valid and strings do not confuse token parsing", () => {
  const raw =
    '[{"a":"a,b:{\\\"hello\\\"}","b":true,"c":null},{"a":"\\u2603","b":false,"c":-0}]';
  assert.deepEqual(parseUnambiguousJson(raw), JSON.parse(raw));
});
test("JSON numbers reject unsafe integers, infinity, silent decimal rounding and underflow", () => {
  for (const token of [
    "9007199254740992",
    "9007199254740993",
    "-9007199254740993",
    "1e309",
  ])
    assert.throws(() => checkedJsonNumber(token), { code: "NUMERIC_RANGE" });
  for (const token of [
    "0.10000000000000001",
    "1.0000000000000001",
    "1e-400",
    "123456789012345.6789",
  ])
    assert.throws(
      () => parseStructuredDataset(file('[{"Value":' + token + "}]")),
      { code: "NUMERIC_PRECISION" },
    );
});
test("ordinary decimals, negative values, exponents and insignificant zeros retain valid calculations", () => {
  for (const token of [
    "0.1",
    "1.0000000000000000",
    "-0",
    "1.25e2",
    "-2.5e-1",
    "9007199254740991",
    "5e-324",
  ])
    assert.equal(checkedJsonNumber(token), Number(token));
  const result = executePlan([file('[{"Value":1.25e2},{"Value":-2.5e-1}]')], {
    action: "sum",
    columns: ["Value"],
  });
  assert.equal(result.value, 124.75);
});
test("large identifiers exported as strings retain their original spelling", () => {
  const raw = '[{"ID":"9007199254740993","Value":3}]';
  const rows = parseStructuredDataset(file(raw));
  assert.equal(rows[0].ID, "9007199254740993");
  assert.equal(
    executePlan([file(raw)], { action: "sum", columns: ["Value"] }).value,
    3,
  );
});
test("JSONL uses the same ambiguity and precision policy instead of collapsing errors", () => {
  assert.throws(
    () =>
      parseStructuredDataset({
        name: "data.jsonl",
        text: '{"A":1}\n{"A":2,"A":3}',
      }),
    { code: "DATASET_JSON_DUPLICATE_KEY" },
  );
  assert.throws(
    () =>
      parseStructuredDataset({
        name: "data.jsonl",
        text: '{"A":1}\n{"A":9007199254740993}',
      }),
    { code: "NUMERIC_RANGE" },
  );
});
test("grammar errors are normalized without exposing raw document contents", () => {
  for (const raw of [
    "",
    " ",
    "{",
    "[1,]",
    '{"a":1,}',
    '{"a":01}',
    '{"a":+1}',
    '{"a":.1}',
    '{"a":1.}',
    '{"a":1e}',
    '{"a":true false}',
    '"\\x20"',
    '"\\u00ZZ"',
    '"raw\nnewline"',
    '{"a":undefined}',
  ]) {
    assert.throws(
      () => parseUnambiguousJson(raw),
      (error) =>
        error.code === "DATASET_JSON_INVALID" &&
        error.message ===
          "Dataset JSON is invalid. Export valid JSON before uploading.",
    );
  }
});
test("depth and byte limits fail explicitly before unsafe recursion; boundary remains usable", () => {
  const nested = (n) => "[".repeat(n) + "0" + "]".repeat(n);
  assert.deepEqual(parseUnambiguousJson(nested(64)), JSON.parse(nested(64)));
  assert.throws(() => parseUnambiguousJson(nested(65)), {
    code: "DATASET_JSON_DEPTH",
  });
  assert.throws(() => parseUnambiguousJson('"' + "a".repeat(2000000) + '"'), {
    code: "DATASET_TOO_LARGE",
  });
  assert.throws(() => parseUnambiguousJson("{}", { maxDepth: 100 }), TypeError);
});
test("generic knowledge documents keep raw numeric text but reject ambiguous JSON", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-json-"));
  try {
    const target = path.join(dir, "knowledge.json"),
      text = '{"nested":{"id":9007199254740993}}';
    await fs.writeFile(target, text);
    assert.equal(
      (await parseFile(target, "knowledge.json", "text")).text,
      text,
    );
    await fs.writeFile(target, '{"nested":{"id":1,"id":2}}');
    await assert.rejects(parseFile(target, "knowledge.json", "text"), {
      code: "DATASET_JSON_DUPLICATE_KEY",
    });
    await fs.writeFile(target, '{"a":1}\n{"a":2,"a":3}');
    await assert.rejects(parseFile(target, "knowledge.jsonl", "text"), {
      code: "DATASET_JSON_DUPLICATE_KEY",
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("reserved JSON fields never modify prototypes and remain rejected for analyst columns", () => {
  const raw = '{"__proto__":{"polluted":true}}';
  assert.equal(Object.hasOwn(parseUnambiguousJson(raw), "__proto__"), true);
  assert.equal({}.polluted, undefined);
  assert.throws(() => parseStructuredDataset(file(raw)), {
    code: "DATASET_COLUMNS",
  });
});
