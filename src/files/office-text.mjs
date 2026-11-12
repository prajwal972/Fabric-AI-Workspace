import zlib from "node:zlib";
function decodeEntities(x) {
  return x
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}
function zipEntries(buf) {
  let e = -1;
  for (let i = Math.max(0, buf.length - 65557); i <= buf.length - 22; i++)
    if (buf.readUInt32LE(i) === 0x06054b50) e = i;
  if (e < 0) throw Error("Invalid ZIP container");
  const count = Math.min(buf.readUInt16LE(e + 10), 800),
    offset = buf.readUInt32LE(e + 16),
    out = new Map();
  let p = offset,
    total = 0;
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10),
      compressed = buf.readUInt32LE(p + 20),
      uncompressed = buf.readUInt32LE(p + 24),
      nl = buf.readUInt16LE(p + 28),
      xl = buf.readUInt16LE(p + 30),
      cl = buf.readUInt16LE(p + 32),
      local = buf.readUInt32LE(p + 42),
      name = buf.subarray(p + 46, p + 46 + nl).toString("utf8");
    p += 46 + nl + xl + cl;
    if (
      !name ||
      name.endsWith("/") ||
      uncompressed > 8e6 ||
      total + uncompressed > 20e6
    )
      continue;
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50)
      continue;
    const lnl = buf.readUInt16LE(local + 26),
      lxl = buf.readUInt16LE(local + 28),
      start = local + 30 + lnl + lxl,
      raw = buf.subarray(start, start + compressed);
    try {
      const data =
        method === 0
          ? raw
          : method === 8
            ? zlib.inflateRawSync(raw, { maxOutputLength: 8e6 })
            : null;
      if (data) {
        out.set(name, data);
        total += data.length;
      }
    } catch {}
  }
  return out;
}
function xmlText(value) {
  return decodeEntities(
    String(value || "")
      .replace(/<w:tab[^>]*\/>/g, "\t")
      .replace(/<\/(?:w:p|a:p|text:p|row)>/g, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .trim(),
  );
}
function officeText(buf, ext) {
  const entries = zipEntries(buf),
    parts = [];
  if (ext === ".docx" && entries.has("word/document.xml"))
    parts.push(xmlText(entries.get("word/document.xml")));
  else if (ext === ".pptx") {
    for (const [k, v] of [...entries]
      .filter(([k]) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
      .sort())
      parts.push(xmlText(v));
  } else if (ext === ".xlsx") {
    for (const [k, v] of entries)
      if (
        k === "xl/sharedStrings.xml" ||
        /^xl\/worksheets\/sheet\d+\.xml$/.test(k)
      )
        parts.push(xmlText(v));
  } else if (
    [".odt", ".ods", ".odp"].includes(ext) &&
    entries.has("content.xml")
  )
    parts.push(xmlText(entries.get("content.xml")));
  else if (ext === ".epub") {
    for (const [k, v] of entries)
      if (/\.(xhtml|html|htm)$/i.test(k)) parts.push(xmlText(v));
  } else
    parts.push(
      "Archive contents:\n" + [...entries.keys()].slice(0, 500).join("\n"),
    );
  return parts.join("\n\n").slice(0, 500000);
}

export { officeText };
