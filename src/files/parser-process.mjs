import { parseUnambiguousJson } from "../security/strict-json.mjs";
import {
  parseStructuredDataset,
  DATASET_ERROR_MESSAGES,
} from "../analyst/dataset.mjs";
import { officeText } from "./office-text.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { readTextBounded, extractXlsxBounded } from "./extractors.mjs";
const binary = (bin, args) =>
  new Promise((resolve, reject) => {
    const executable = process.platform === "linux" ? "prlimit" : bin,
      parameters =
        process.platform === "linux"
          ? ["--cpu=45", "--as=536870912", "--nproc=64", "--", bin, ...args]
          : args;
    const p = spawn(executable, parameters, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH },
    });
    let text = "",
      errors = "";
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error("Parser timed out"));
    }, 45000);
    p.stdout.on("data", (c) => {
      text += c;
      if (text.length > 2e6) p.kill("SIGKILL");
    });
    p.stderr.on("data", (c) => {
      if (errors.length < 1000) errors += c;
    });
    p.on("error", reject);
    p.on("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(text)
        : reject(new Error("Document parser unavailable or failed"));
    });
  });
export async function parseFile(file, name, kind) {
  const ext = path.extname(name).toLowerCase();
  let text, method, dataset;
  if (ext === ".xlsx") {
    const extracted = await extractXlsxBounded(file, { preserveNumeric: true });
    if (extracted.truncated)
      throw Object.assign(
        new Error(
          "Structured dataset exceeds supported limits; split it into complete datasets.",
        ),
        { code: "DATASET_TOO_LARGE" },
      );
    text = extracted.text;
    dataset = {
      worksheets: extracted.sheets,
      cachedFormulaCells: extracted.cachedFormulaCells,
      formulaResults: extracted.formulaResults,
    };
    method = "exceljs";
  } else if (ext === ".pdf") {
    text = await binary("pdftotext", ["-layout", file, "-"]);
    method = "pdftotext";
  } else if (ext === ".docx") {
    text = await binary("python3", [
      "-c",
      "from docx import Document;import sys;d=Document(sys.argv[1]);print('\\n'.join(p.text for p in d.paragraphs));[print('\\n'.join('\\t'.join(c.text for c in r.cells) for r in t.rows)) for t in d.tables]",
      file,
    ]);
    method = "docx";
  } else if (
    [
      ".pptx",
      ".odt",
      ".ods",
      ".odp",
      ".epub",
      ".zip",
      ".jar",
      ".apk",
      ".cbz",
    ].includes(ext)
  ) {
    text = officeText(await fs.readFile(file), ext);
    method = [".zip", ".jar", ".apk", ".cbz"].includes(ext)
      ? "archive-index"
      : "office";
  } else if (kind === "audio" || kind === "video") {
    text =
      "Media metadata:\n" +
      (await binary("ffprobe", [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        file,
      ]));
    method = "media-metadata";
  } else if (kind === "image") {
    text = await binary("tesseract", [file, "stdout"]);
    method = "ocr";
  } else if (
    kind === "text" ||
    [".json", ".jsonl", ".csv", ".tsv", ".md", ".txt"].includes(ext)
  ) {
    if (
      [".csv", ".tsv", ".json", ".jsonl"].includes(ext) &&
      (await fs.stat(file)).size > 2e6
    )
      throw Object.assign(
        new Error(
          "Structured dataset exceeds 2 MB; split it into complete datasets.",
        ),
        { code: "DATASET_TOO_LARGE" },
      );
    text = await readTextBounded(file, 2e6, {
      preserveNul: [".csv", ".tsv", ".json", ".jsonl"].includes(ext),
    });
    method = "text";
  } else {
    return { text: "", pages: [], method: "metadata" };
  }
  if ([".csv", ".tsv", ".xlsx"].includes(ext))
    parseStructuredDataset({ name, text, kind });
  if ([".json", ".jsonl"].includes(ext)) {
    if (text.includes("\0"))
      throw Object.assign(new Error(DATASET_ERROR_MESSAGES.DATASET_NUL), {
        code: "DATASET_NUL",
      });
    try {
      if (ext === ".jsonl")
        text
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .forEach((line) =>
            parseUnambiguousJson(line, { strictNumbers: false }),
          );
      else parseUnambiguousJson(text, { strictNumbers: false });
    } catch (error) {
      if (Object.hasOwn(DATASET_ERROR_MESSAGES, error?.code || "")) throw error;
      throw Object.assign(
        new Error(DATASET_ERROR_MESSAGES.DATASET_JSON_INVALID),
        { code: "DATASET_JSON_INVALID" },
      );
    }
  }
  text = text.slice(0, 2e6).replace(/\0/g, "");
  const pages = text.split("\f").map((value, index) => ({
    text: value,
    pageNumber: ext === ".pdf" ? index + 1 : null,
  }));
  if (dataset && pages.length) pages[0].dataset = dataset;
  return { text, pages, method };
}
if (process.argv[2] === "--parse") {
  try {
    const result = await parseFile(
      process.argv[3],
      process.argv[4],
      process.argv[5],
    );
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stderr.write(
      JSON.stringify({
        code: Object.hasOwn(DATASET_ERROR_MESSAGES, error.code || "")
          ? error.code
          : "PARSER_FAILED",
        message:
          DATASET_ERROR_MESSAGES[error.code] ||
          "Document extraction could not complete.",
      }),
    );
    process.exitCode = 1;
  }
}
