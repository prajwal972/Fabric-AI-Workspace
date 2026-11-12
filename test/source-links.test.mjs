import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
const source = await fs.readFile("public/app.js", "utf8"),
  lines = source.split("\n");
const functions = lines
  .filter(
    (line) =>
      line.startsWith("function sourceHref(") ||
      line.startsWith("function sourceLinks("),
  )
  .join("\n");
assert.equal(functions.split("\n").length, 2);
const esc =
  source.slice(
    source.indexOf("const esc="),
    source.indexOf(";function toast"),
  ) + ";";
const context = vm.createContext({ URL });
vm.runInContext(esc + functions, context);
test("source links refuse executable, credentialed and protocol-relative URLs", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///private/master.key",
    "https://user:secret@example.test",
    "//evil.test/path",
    "/api/files/x/download?token=secret",
    null,
    "/api/files/bad\nID/download",
  ])
    assert.equal(context.sourceHref(value), "");
  assert.equal(
    context.sourceHref("/api/files/f1/download"),
    "/api/files/f1/download",
  );
  assert.equal(
    context.sourceHref("https://example.test/report"),
    "https://example.test/report",
  );
});
test("source UI escapes labels and distinguishes available from verified evidence", () => {
  const html = context.sourceLinks(
    [
      {
        id: 1,
        title: "<img src=x onerror=alert(1)>",
        url: "javascript:alert(1)",
        sourceType: "search_snippet",
        truncated: true,
      },
    ],
    { status: "valid_source_ids" },
  );
  assert.match(html, /Available sources/);
  assert.match(html, /search snippet/);
  assert.match(html, /truncated excerpt/);
  assert.match(html, /link unavailable/);
  assert.doesNotMatch(html, /<img|href="javascript:/);
  assert.match(html, /factual support is not automatically verified/);
});
test("source UI preserves safe links/page provenance and explains uncited evidence", () => {
  const html = context.sourceLinks(
    [
      {
        id: 1,
        title: "Fixture",
        url: "/api/files/f1/download",
        page: 2,
        sourceType: "file_excerpt",
      },
    ],
    { status: "not_cited" },
  );
  assert.match(html, /href="\/api\/files\/f1\/download"/);
  assert.match(html, /page 2/);
  assert.match(html, /file excerpt/);
  assert.match(html, /no numbered source references/);
  assert.match(html, /noopener noreferrer/);
  assert.equal(context.sourceLinks([], {}), "");
});

test("analyst UI makes optional explanation failures and rejections visible without leaking HTML", () => {
  const helper = lines.find((line) =>
    line.startsWith("function analystLimitations("),
  );
  assert.ok(helper);
  vm.runInContext(helper, context);
  const html = context.analystLimitations({
    validation: {
      explanationUnavailable: "<img onerror=x>",
      explanationRejected: "unverified_numbers",
    },
  });
  assert.match(html, /Calculated figures are preserved/);
  assert.match(html, /optional AI explanation is unavailable/);
  assert.match(html, /Showing the deterministic result/);
  assert.doesNotMatch(html, /<img/);
  assert.equal(context.analystLimitations({}), "");
});
