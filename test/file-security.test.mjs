import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { inspectUpload } from "../src/files/security.mjs";
import { extractXlsxBounded, readTextBounded } from "../src/files/extractors.mjs";

test("text extraction is bounded", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-file-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "large.txt");
  await fs.writeFile(file, "a".repeat(20_000));
  assert.equal((await readTextBounded(file, 1_024)).length, 1_024);
});

test("Excel extraction streams rows and neutralizes formula-like values", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-xlsx-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "sample.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Data");
  sheet.addRow(["Name", "Revenue", "Comment"]);
  sheet.addRow(["West", 70, "=HYPERLINK(\"https://invalid.example\")"]);
  sheet.addRow(["East", 50, "verified"]);
  await workbook.xlsx.writeFile(file);
  const extracted = await extractXlsxBounded(file);
  assert.equal(extracted.rows, 3);
  assert.match(extracted.text, /Name,Revenue,Comment/);
  assert.match(extracted.text, /West,70,"'=HYPERLINK/);
});

test("executable extensions are rejected before parsing", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-file-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "payload.exe");
  await fs.writeFile(file, Buffer.from("MZfake"));
  await assert.rejects(
    () => inspectUpload(file, { name: "payload.exe", declaredMime: "application/octet-stream" }),
    { code: "EXECUTABLE_UPLOAD_BLOCKED" },
  );
});
test('ExcelJS conditional-formatting UUID generation remains compatible after the security override', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Compatibility');
  sheet.addRow([10]); sheet.addRow([20]);
  sheet.addConditionalFormatting({ ref: 'A1:A2', rules: [{ type: 'dataBar', cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: 'FF638EC6' }, negativeFillColor: { argb: 'FFFF0000' } }] });
  const bytes = await workbook.xlsx.writeBuffer();
  assert.ok(bytes.length > 0);
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(bytes);
  assert.equal(restored.getWorksheet('Compatibility').getCell('A1').value, 10);
  assert.equal(restored.getWorksheet('Compatibility').getCell('A2').value, 20);
});
