import { createHash } from "node:crypto";
import { AppError } from "../server/errors.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const invalid = () =>
  new AppError("INVALID_SOURCE", "Retrieved source metadata is invalid.", 502);
const textField = (value, max) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\0\r\n]/.test(value)
  )
    throw invalid();
  return value.trim();
};
// This registry records exactly the excerpts supplied to the model, not every
// retrieved candidate. Limits include JSON framing, labels and source IDs.
export class EvidenceRegistry {
  constructor({ maxCharacters = 20000, maxSources = 48 } = {}) {
    if (
      !Number.isInteger(maxCharacters) ||
      maxCharacters < 256 ||
      maxCharacters > 40000 ||
      !Number.isInteger(maxSources) ||
      maxSources < 1 ||
      maxSources > 100
    )
      throw new TypeError("Invalid evidence bounds");
    this.maxCharacters = maxCharacters;
    this.maxSources = maxSources;
    this.records = [];
    this.sources = [];
    this.keys = new Map();
  }
  render() {
    return JSON.stringify(this.records);
  }
  remaining() {
    return Math.max(0, this.maxCharacters - this.render().length - 1);
  }
  fit(record, content, limit) {
    let lower = 0,
      upper = Math.min(content.length, limit),
      fitted = null;
    while (lower <= upper) {
      const length = Math.floor((lower + upper) / 2);
      let text = content.slice(0, length);
      if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
      const candidate = {
        ...record,
        text,
        truncated: text.length < content.length,
        excerptHash: hash(text),
      };
      if (
        JSON.stringify([...this.records, candidate]).length <=
        this.maxCharacters
      ) {
        fitted = candidate;
        lower = length + 1;
      } else upper = length - 1;
    }
    return fitted?.text.trim() ? fitted : null;
  }
  add(source, { maxText = 8000 } = {}) {
    if (
      !source ||
      typeof source !== "object" ||
      typeof source.text !== "string" ||
      source.text.length > 200000
    )
      throw invalid();
    if (source.readStatus === "unavailable" || !source.text.trim()) return null;
    const rawTitle = source.title || source.name || "Source";
    if (typeof rawTitle !== "string" || rawTitle.length > 10000)
      throw invalid();
    const title =
      rawTitle
        .replace(/[\u0000-\u001f]/g, " ")
        .trim()
        .slice(0, 240) || "Source";
    let url, fileId, chunkId, page, sourceType;
    if (source.fileId) {
      fileId = textField(source.fileId, 200);
      url = "/api/files/" + encodeURIComponent(fileId) + "/download";
      chunkId = source.chunkId ? textField(source.chunkId, 200) : undefined;
      page = source.page ?? source.pageNumber ?? undefined;
      if (
        page !== undefined &&
        page !== null &&
        (!Number.isInteger(page) || page < 1 || page > 1000000)
      )
        throw invalid();
      sourceType = chunkId ? "file_chunk" : "file_excerpt";
    } else {
      try {
        const parsed = new URL(source.url);
        if (
          !["http:", "https:"].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password ||
          parsed.href.length > 4000
        )
          throw invalid();
        url = parsed.href;
      } catch {
        throw invalid();
      }
      sourceType =
        source.readStatus === "snippet" ? "search_snippet" : "web_page";
    }
    const content = source.text.replace(/\0/g, ""),
      key = JSON.stringify([url, chunkId || null, page || null, hash(content)]);
    if (this.keys.has(key)) return this.keys.get(key);
    if (this.sources.length >= this.maxSources) return null;
    if (!Number.isInteger(maxText) || maxText < 1 || maxText > 200000)
      throw new TypeError("Invalid evidence excerpt limit");
    const record = this.fit(
      {
        kind: "source",
        id: this.sources.length + 1,
        title,
        url,
        ...(fileId ? { fileId } : {}),
        ...(chunkId ? { chunkId } : {}),
        ...(page ? { page } : {}),
        sourceType,
      },
      content,
      maxText,
    );
    if (!record) return null;
    this.sources.push(record);
    this.records.push(record);
    this.keys.set(key, record);
    return record;
  }
  addContext(kind, content, maxText = 8000) {
    if (
      !["memory", "connector", "notice"].includes(kind) ||
      typeof content !== "string" ||
      content.length > 200000 ||
      !Number.isInteger(maxText) ||
      maxText < 1 ||
      maxText > 200000
    )
      throw invalid();
    const record = this.fit({ kind }, content.replace(/\0/g, ""), maxText);
    if (record) this.records.push(record);
    return !!record;
  }
  publicSources() {
    return this.sources.map(({ kind, text, ...metadata }) => ({
      ...metadata,
      suppliedCharacters: text.length,
    }));
  }
}
function outsideCode(text) {
  let fence = null;
  const lines = [];
  for (const line of text.split("\n")) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!fence && marker) {
      fence = { character: marker[1][0], length: marker[1].length };
      continue;
    }
    if (fence) {
      if (
        new RegExp(
          "^ {0,3}" + fence.character + "{" + fence.length + ",}\\s*$",
        ).test(line)
      )
        fence = null;
      continue;
    }
    if (/^(?: {4}|\t)/.test(line)) continue;
    lines.push(line);
  }
  const prose = lines.join("\n");
  let cleaned = "",
    position = 0;
  // Exact run-length matching also works for multiline Markdown code spans.
  while (position < prose.length) {
    if (prose[position] !== "`") {
      cleaned += prose[position++];
      continue;
    }
    let end = position;
    while (prose[end] === "`") end++;
    const run = prose.slice(position, end);
    let close = prose.indexOf(run, end);
    while (
      close >= 0 &&
      (prose[close - 1] === "`" || prose[close + run.length] === "`")
    )
      close = prose.indexOf(run, close + run.length);
    if (close < 0) {
      cleaned += run;
      position = end;
    } else {
      cleaned += " ";
      position = close + run.length;
    }
  }
  return cleaned;
}
export function validateCitations(
  text,
  sources,
  { active = sources.length > 0 } = {},
) {
  if (!active)
    return {
      status: "not_applicable",
      usedSourceIds: [],
      semanticSupportVerified: false,
    };
  const allowed = new Map(sources.map((s) => [s.id, s])),
    used = new Set(),
    prose = outsideCode(text);
  const pattern = /\[(\d+(?:\s*(?:,|-)\s*\d+)*)\](?:\(([^\s)]*)\))?/g;
  for (const match of prose.matchAll(pattern)) {
    let slashes = 0;
    for (
      let position = match.index - 1;
      position >= 0 && prose[position] === "\\";
      position--
    )
      slashes++;
    if (slashes % 2) continue;
    const references = [];
    for (const part of match[1].split(",")) {
      const range = part.split("-").map((s) => Number(s.trim()));
      if (range.some((id) => !Number.isSafeInteger(id) || id < 1))
        throw new AppError(
          "INVALID_CITATION",
          "The response contains an invalid source reference.",
          502,
        );
      if (range.length === 2) {
        if (range[1] < range[0] || range[1] - range[0] > 15)
          throw new AppError(
            "INVALID_CITATION",
            "The response contains an invalid source reference.",
            502,
          );
        for (let n = range[0]; n <= range[1]; n++) references.push(n);
      } else references.push(range[0]);
    }
    for (const id of references) {
      const source = allowed.get(id);
      if (
        !Number.isSafeInteger(id) ||
        !source ||
        (match[2] !== undefined && match[2] !== source.url)
      )
        throw new AppError(
          "INVALID_CITATION",
          "The response cited an unavailable source or mismatched source link. Retry with a narrower question.",
          502,
        );
      used.add(id);
    }
  }
  return {
    status: used.size
      ? "valid_source_ids"
      : sources.length
        ? "not_cited"
        : "no_sources",
    usedSourceIds: [...used].sort((a, b) => a - b),
    semanticSupportVerified: false,
  };
}
