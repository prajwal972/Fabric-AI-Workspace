const clean = (v, n = 10000) =>
  String(v ?? "")
    .replace(/\0/g, "")
    .slice(0, n);
function artifactPath(raw, index = 1) {
  let p = String(raw || "")
    .replace(/\\/g, "/")
    .replace(/^[A-Za-z]:/, "")
    .split("/")
    .filter((x) => x && x !== "." && x !== "..")
    .map((x) => x.replace(/[^\w. @()+\-]/g, "_"))
    .join("/")
    .slice(0, 220);
  return p || "file-" + index + ".txt";
}
function projectFiles(markdown) {
  const out = [],
    re =
      /```file\s+path=(?:"([^"]+)"|'([^']+)'|([^\s\n]+))\s*\n([\s\S]*?)```/gi;
  let m;
  while ((m = re.exec(String(markdown || ""))) && out.length < 50) {
    const content = m[4].replace(/\n$/, "");
    if (content.length)
      out.push({
        path: artifactPath(m[1] || m[2] || m[3], out.length + 1),
        content: content.slice(0, 500000),
      });
  }
  return out.length
    ? out
    : [
        {
          path: "output.md",
          content: String(markdown || "").slice(0, 1000000),
        },
      ];
}
const CRC_TABLE = (() => {
  const a = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    a[n] = c >>> 0;
  }
  return a;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(files) {
  const locals = [],
    centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(artifactPath(f.path), "utf8"),
      data = Buffer.from(String(f.content), "utf8"),
      crc = crc32(data),
      local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

export { artifactPath, projectFiles, zipStore };
