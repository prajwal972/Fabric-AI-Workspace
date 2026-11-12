import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EvidenceRegistry, validateCitations } from "../src/rag/evidence.mjs";
const file = (i = 1, text = "Verified fixture excerpt") => ({
  fileId: "f" + i,
  chunkId: "chunk" + i,
  title: "File " + i,
  page: 1,
  text,
});
const sha = (text) => createHash("sha256").update(text).digest("hex");
test("evidence JSON includes framing in its bound and declares only supplied excerpts", () => {
  const registry = new EvidenceRegistry({ maxCharacters: 1200 });
  for (let i = 0; i < 20; i++)
    registry.add(file(i, 'quote " ' + i + "\n".repeat(300) + "x".repeat(4000)));
  assert.ok(registry.render().length <= 1200);
  assert.ok(registry.sources.length < 20);
  assert.deepEqual(
    registry.sources.map((s) => s.id),
    registry.sources.map((s, i) => i + 1),
  );
  assert.ok(registry.sources.every((s) => s.text && s.truncated));
});
test("source snapshots deduplicate exact evidence but not changed contents", () => {
  const registry = new EvidenceRegistry();
  const first = registry.add(file());
  assert.equal(registry.add(file()), first);
  const changed = registry.add(file(1, "Changed fixture excerpt"));
  assert.equal(changed.id, 2);
  assert.notEqual(first.excerptHash, changed.excerptHash);
});
test("public source metadata contains provenance/hash but not full excerpt text", () => {
  const registry = new EvidenceRegistry();
  const source = registry.add(file());
  const publicSource = registry.publicSources()[0];
  assert.equal(publicSource.url, "/api/files/f1/download");
  assert.equal(publicSource.excerptHash, sha(source.text));
  assert.equal(publicSource.suppliedCharacters, source.text.length);
  assert.equal(publicSource.page, 1);
  assert.equal(publicSource.text, undefined);
  assert.equal(publicSource.kind, undefined);
  publicSource.title = "Client modification";
  assert.equal(registry.sources[0].title, "File 1");
});
test("direct file excerpts and successfully read pages differ from search snippets", () => {
  const registry = new EvidenceRegistry();
  assert.equal(
    registry.add({ fileId: "f", title: "Direct file", text: "real text" })
      .sourceType,
    "file_excerpt",
  );
  assert.equal(
    registry.add({
      url: "https://example.test/page",
      title: "Page",
      text: "read page",
      readStatus: "page",
    }).sourceType,
    "web_page",
  );
  assert.equal(
    registry.add({
      url: "https://example.test/snippet",
      title: "Snippet",
      text: "search snippet",
      readStatus: "snippet",
    }).sourceType,
    "search_snippet",
  );
  assert.equal(
    registry.add({
      url: "https://example.test/failed",
      title: "Failed",
      text: "Source could not be read",
      readStatus: "unavailable",
    }),
    null,
  );
  assert.equal(registry.sources.length, 3);
});
test("source metadata refuses executable URLs, credentials and malformed provenance", () => {
  for (const source of [
    { url: "javascript:alert(1)", text: "x" },
    { url: "https://user:secret@example.test", text: "x" },
    { ...file(), page: -1 },
    { ...file(), page: 1.5 },
    { ...file(), fileId: "bad\nID" },
    { ...file(), chunkId: "bad\0ID" },
    { ...file(), text: { instruction: "wrong type" } },
  ])
    assert.throws(() => new EvidenceRegistry().add(source), {
      code: "INVALID_SOURCE",
    });
  const registry = new EvidenceRegistry();
  assert.equal(
    registry.add({ ...file(), title: "Multiline\nname" }).title,
    "Multiline name",
  );
});
test("all evidence/context classes share one character and source-count budget", () => {
  const registry = new EvidenceRegistry({ maxCharacters: 1000, maxSources: 1 });
  assert.ok(
    registry.addContext("memory", "Saved fixture preference".repeat(8)),
  );
  assert.ok(registry.add(file(1, "x".repeat(2000))));
  assert.equal(registry.add(file(2)), null);
  registry.addContext("connector", "y".repeat(2000));
  assert.ok(registry.render().length <= 1000);
  assert.throws(() => registry.addContext("system", "malicious role"), {
    code: "INVALID_SOURCE",
  });
  for (const options of [
    { maxCharacters: 0 },
    { maxCharacters: 40001 },
    { maxSources: 101 },
  ])
    assert.throws(
      () => new EvidenceRegistry(options),
      /Invalid evidence bounds/,
    );
});
test("excerpt truncation preserves Unicode pairs and hashes exactly the supplied string", () => {
  const registry = new EvidenceRegistry({ maxCharacters: 650 });
  const source = registry.add(file(1, "🧵".repeat(1000)));
  assert.ok(source);
  assert.doesNotMatch(source.text, /[\uD800-\uDBFF]$/);
  assert.equal(source.excerptHash, sha(source.text));
  assert.ok(registry.render().length <= 650);
});
test("known citation IDs and bounded ranges validate without claiming entailment", () => {
  const sources = [1, 2, 3].map((id) => ({
    id,
    url: "/api/files/f" + id + "/download",
  }));
  assert.deepEqual(validateCitations("Facts [1], [2, 3], [1-3].", sources), {
    status: "valid_source_ids",
    usedSourceIds: [1, 2, 3],
    semanticSupportVerified: false,
  });
  assert.equal(validateCitations("No references", sources).status, "not_cited");
});
test("unavailable IDs, absent sources, invalid ranges and substituted numbered links fail", () => {
  const sources = [{ id: 1, url: "https://example.test/provenance" }];
  for (const answer of [
    "Claim [2]",
    "Claim [0]",
    "Claim [1-99]",
    "Claim [3-1]",
    "Claim [1](https://evil.test)",
    "Claim [999999999999999999999999999]",
    "Claim [99999999999999999999999-99999999999999999999999]",
  ])
    assert.throws(() => validateCitations(answer, sources), {
      code: "INVALID_CITATION",
    });
  assert.throws(() => validateCitations("Claim [1]", [], { active: true }), {
    code: "INVALID_CITATION",
  });
  assert.equal(
    validateCitations("Claim [1](https://example.test/provenance)", sources)
      .status,
    "valid_source_ids",
  );
});
test("Markdown code arrays and escaped literals are not mistaken for citations", () => {
  const answer =
    "Supported [1].\n```js\nconst x=[99];\n```\n~~~txt\n[88]\n~~~\n    [77]\nInline `[66]` and ```[55] ` literal``` and `multi\n[44] line`. Literal \\[33].";
  assert.deepEqual(
    validateCitations(answer, [{ id: 1, url: "/api/files/f/download" }])
      .usedSourceIds,
    [1],
  );
  assert.equal(
    validateCitations("General literal [42]", []).status,
    "not_applicable",
  );
});

test("citation escaping follows even/odd backslash parity", () => {
  const sources = [{ id: 1, url: "/api/files/f/download" }];
  assert.equal(
    validateCitations("Literal " + "\\" + "[99]", sources).status,
    "not_cited",
  );
  assert.throws(() => validateCitations("Claim " + "\\\\" + "[99]", sources), {
    code: "INVALID_CITATION",
  });
});
