import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { selectRuntimeAsset, runtimeDiagnostics } from "./native-assets.mjs";
import { sha256File, verifyFileSha256 } from "./integrity.mjs";

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : "";
};
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.resolve(
  value("--data-dir") || process.env.FABRIC_DATA_DIR || path.join(root, "data"),
);
const nativeDir = path.join(dataDir, "native"),
  downloads = path.join(nativeDir, "downloads"),
  runtimes = path.join(nativeDir, "runtimes"),
  models = path.join(nativeDir, "models");
const statusFile = path.join(nativeDir, "install-status.json"),
  manifestFile = path.join(nativeDir, "manifest.json");
const planOnly = args.includes("--plan") || args.includes("--resolve-only");
const component = ["all", "llm", "voice"].includes(value("--component"))
  ? value("--component")
  : "all";
const platform = value("--platform") || process.platform,
  arch = value("--arch") || os.arch();
const MODEL_URL =
  process.env.FABRIC_NATIVE_MODEL_URL ||
  "https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf?download=true";
const VOICE_MODEL_URL =
  process.env.FABRIC_NATIVE_VOICE_MODEL_URL ||
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin?download=true";
const LLAMA_RELEASES = "https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=20";
const WHISPER_RELEASES = "https://api.github.com/repos/ggerganov/whisper.cpp/releases?per_page=20";
const EXPECTED = {
  llamaRuntime: process.env.FABRIC_NATIVE_RUNTIME_SHA256 || "",
  llamaModel: process.env.FABRIC_NATIVE_MODEL_SHA256 || "",
  whisperRuntime: process.env.FABRIC_NATIVE_VOICE_RUNTIME_SHA256 || "",
  whisperModel: process.env.FABRIC_NATIVE_VOICE_MODEL_SHA256 || "",
};
const MAX_RUNTIME_ARCHIVE = Number(process.env.FABRIC_NATIVE_MAX_RUNTIME_BYTES || 1_500_000_000);
const MAX_MODEL_DOWNLOAD = Number(process.env.FABRIC_NATIVE_MAX_MODEL_BYTES || 10_000_000_000);
let lastWrite = 0;

await Promise.all(
  [nativeDir, downloads, runtimes, models].map((dir) =>
    fs.promises.mkdir(dir, { recursive: true, mode: 0o700 }),
  ),
);
const readJson = async (file) => {
  try {
    return JSON.parse(await fs.promises.readFile(file, "utf8"));
  } catch {
    return null;
  }
};
const transientFileError = (error) =>
  ["EPERM", "EACCES", "EBUSY", "EEXIST"].includes(error?.code) ||
  /operation not permitted|being used by another process|access is denied/i.test(
    String(error?.message || ""),
  );
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function atomicJson(file, value) {
  const payload = JSON.stringify(value, null, 2);
  let last;
  for (let attempt = 0; attempt < 8; attempt++) {
    const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.promises.writeFile(tmp, payload, { mode: 0o600 });
      try {
        await fs.promises.rename(tmp, file);
        return;
      } catch (error) {
        last = error;
        if (!transientFileError(error)) throw error;
        try {
          await fs.promises.writeFile(file, payload, { mode: 0o600 });
          return;
        } catch (directError) {
          last = directError;
          if (!transientFileError(directError)) throw directError;
        }
      }
    } catch (error) {
      last = error;
      if (!transientFileError(error)) throw error;
    } finally {
      await fs.promises.rm(tmp, { force: true }).catch(() => {});
    }
    await sleep(75 * (attempt + 1));
  }
  const error = new Error(
    `Fabric could not update ${path.basename(file)} because Windows or a synchronized folder is locking it.`,
  );
  error.code = "DATA_STORE_LOCKED";
  error.cause = last;
  throw error;
}
async function writeStatus(state, force = false) {
  if (!force && Date.now() - lastWrite < 300) return;
  lastWrite = Date.now();
  await atomicJson(statusFile, { updatedAt: new Date().toISOString(), component, ...state });
}
function safeUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Native assets must use HTTPS");
  return url.toString();
}
async function json(url) {
  const response = await fetch(safeUrl(url), {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "Fabric-Native-Installer/1.9.1",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Release metadata failed (HTTP ${response.status})`);
  return response.json();
}
async function loadReleaseMetadata() {
  const fixture = value("--metadata-file");
  if (fixture) return JSON.parse(await fs.promises.readFile(path.resolve(fixture), "utf8"));
  const [llama, whisper] = await Promise.all([json(LLAMA_RELEASES), json(WHISPER_RELEASES)]);
  return { llama, whisper };
}
function overrideAsset(kind, raw) {
  return raw
    ? {
        asset: {
          name: path.basename(new URL(raw).pathname) || `${kind}.zip`,
          browser_download_url: safeUrl(raw),
        },
        release: "environment override",
        diagnostics: [],
      }
    : null;
}
function select(metadata, kind, override) {
  return (
    overrideAsset(kind, override) || selectRuntimeAsset(metadata[kind], { kind, platform, arch })
  );
}
async function download(
  url,
  destination,
  stage,
  rangeStart,
  rangeEnd,
  preservePartial = true,
  maxBytes = MAX_RUNTIME_ARCHIVE,
) {
  safeUrl(url);
  const partial = destination + ".part";
  let offset = 0;
  try {
    offset = preservePartial ? (await fs.promises.stat(partial)).size : 0;
  } catch {}
  const headers = offset ? { range: `bytes=${offset}-` } : {},
    response = await fetch(url, {
      headers: { ...headers, "user-agent": "Fabric-Native-Installer/1.9.1" },
      redirect: "follow",
      signal: AbortSignal.timeout(15 * 60 * 1000),
    });
  if (!response.ok && response.status !== 206)
    throw new Error(`${stage} download failed (HTTP ${response.status})`);
  if (offset && response.status !== 206) {
    await fs.promises.rm(partial, { force: true });
    offset = 0;
  }
  const remaining = Number(response.headers.get("content-length") || 0),
    total = offset + remaining;
  if (total && total > maxBytes)
    throw new Error(`${stage} exceeds the configured ${maxBytes} byte safety limit`);
  const stream = fs.createWriteStream(partial, { flags: offset ? "a" : "w", mode: 0o600 });
  let current = offset;
  const downloadStartedAt = Date.now();
  for await (const chunk of response.body) {
    if (!stream.write(chunk)) await new Promise((resolve) => stream.once("drain", resolve));
    current += chunk.length;
    if (current > maxBytes) {
      stream.destroy();
      await fs.promises.rm(partial, { force: true }).catch(() => {});
      throw new Error(`${stage} exceeded the configured ${maxBytes} byte safety limit`);
    }
    const fraction = total ? current / total : 0;
    const elapsedSeconds = Math.max(0.25, (Date.now() - downloadStartedAt) / 1000);
    const transferred = Math.max(0, current - offset);
    const bytesPerSecond = Math.round(transferred / elapsedSeconds);
    const etaSeconds =
      bytesPerSecond > 0 && total > current
        ? Math.ceil((total - current) / bytesPerSecond)
        : total && total <= current
          ? 0
          : null;
    await writeStatus({
      state: "installing",
      stage,
      currentFile: path.basename(destination),
      percent: Math.round(rangeStart + (rangeEnd - rangeStart) * fraction),
      downloadedBytes: current,
      totalBytes: total,
      bytesPerSecond,
      etaSeconds,
      downloadStartedAt: new Date(downloadStartedAt).toISOString(),
    });
  }
  await new Promise((resolve, reject) =>
    stream.end((error) => (error ? reject(error) : resolve())),
  );
  await fs.promises.rename(partial, destination);
  return destination;
}
function safeTarget(destination, name) {
  const target = path.resolve(destination, String(name).replace(/\\/g, "/")),
    relative = path.relative(path.resolve(destination), target);
  if (!name || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Unsafe path in runtime archive");
  return target;
}
function findEocd(buffer) {
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--)
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  throw new Error("Invalid ZIP archive");
}
async function unzip(file, destination) {
  const archiveSize = (await fs.promises.stat(file)).size;
  if (archiveSize > MAX_RUNTIME_ARCHIVE) throw new Error("Runtime ZIP exceeds safety limit");
  const buffer = await fs.promises.readFile(file),
    eocd = findEocd(buffer),
    count = buffer.readUInt16LE(eocd + 10),
    offset = buffer.readUInt32LE(eocd + 16);
  if (count > 5000) throw new Error("Runtime ZIP contains too many entries");
  let cursor = offset;
  let expanded = 0;
  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Invalid ZIP directory");
    const method = buffer.readUInt16LE(cursor + 10),
      compressed = buffer.readUInt32LE(cursor + 20),
      uncompressed = buffer.readUInt32LE(cursor + 24),
      nameLength = buffer.readUInt16LE(cursor + 28),
      extraLength = buffer.readUInt16LE(cursor + 30),
      commentLength = buffer.readUInt16LE(cursor + 32),
      localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!name || name.endsWith("/")) continue;
    expanded += uncompressed;
    if (uncompressed > 512_000_000 || expanded > 3_000_000_000)
      throw new Error("Runtime ZIP exceeds decompression safety limits");
    const target = safeTarget(destination, name),
      localName = buffer.readUInt16LE(localOffset + 26),
      localExtra = buffer.readUInt16LE(localOffset + 28),
      start = localOffset + 30 + localName + localExtra,
      raw = buffer.subarray(start, start + compressed),
      data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data) continue;
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, data, { mode: 0o700 });
  }
}
async function untarGz(file, destination) {
  const archiveSize = (await fs.promises.stat(file)).size;
  if (archiveSize > MAX_RUNTIME_ARCHIVE) throw new Error("Runtime archive exceeds safety limit");
  const buffer = zlib.gunzipSync(await fs.promises.readFile(file));
  if (buffer.length > 3_000_000_000) throw new Error("Runtime archive exceeds decompression limit");
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (a, b) => header.subarray(a, b).toString("utf8").replace(/\0.*$/, "").trim();
    const name = [text(345, 500), text(0, 100)].filter(Boolean).join("/"),
      size = parseInt(text(124, 136) || "0", 8) || 0,
      type = text(156, 157);
    offset += 512;
    if (name && type !== "5") {
      const target = safeTarget(destination, name);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, buffer.subarray(offset, offset + size), { mode: 0o700 });
    }
    offset += Math.ceil(size / 512) * 512;
  }
}
async function extract(file, destination) {
  if (/\.tar\.gz$/i.test(file)) return untarGz(file, destination);
  return unzip(file, destination);
}
async function walk(root) {
  const output = [];
  for (const item of await fs.promises.readdir(root, { withFileTypes: true })) {
    const full = path.join(root, item.name);
    if (item.isDirectory()) output.push(...(await walk(full)));
    else output.push(full);
  }
  return output;
}
async function executable(root, names) {
  const files = await walk(root),
    wanted = names.map((name) => name.toLowerCase()),
    found = files.find((file) => wanted.includes(path.basename(file).toLowerCase()));
  if (!found) throw new Error(`Runtime archive does not contain ${names.join(" or ")}`);
  if (process.platform !== "win32") await fs.promises.chmod(found, 0o700);
  return found;
}
async function digest(file) {
  return sha256File(file);
}
async function verifyDigest(file, expected, label) {
  const actual = await digest(file);
  if (!expected) {
    if (process.env.NODE_ENV === "production")
      throw new Error(`${label} requires an approved SHA-256 digest in production`);
    await writeStatus(
      {
        state: "installing",
        stage: `${label} is unverified in development mode`,
        warning: `Configure the corresponding FABRIC_NATIVE_*_SHA256 value as ${actual}`,
      },
      true,
    );
    return actual;
  }
  return verifyFileSha256(file, expected, label);
}
async function installLlm(selection, manifest, start = 2, end = 84) {
  const asset = selection.asset,
    ext = asset.name.toLowerCase().endsWith(".tar.gz") ? ".tar.gz" : ".zip",
    archive = path.join(downloads, "llama-runtime" + ext);
  await fs.promises.rm(archive, { force: true });
  await fs.promises.rm(archive + ".part", { force: true });
  await download(
    asset.browser_download_url,
    archive,
    "Downloading Fabric inference engine",
    start,
    start + 5,
    false,
  );
  manifest.llamaRuntimeSha256 = await verifyDigest(
    archive,
    EXPECTED.llamaRuntime,
    "Fabric inference runtime",
  );
  await writeStatus(
    {
      state: "installing",
      stage: `Installing ${asset.name}`,
      percent: start + 6,
      selectedAsset: asset.name,
    },
    true,
  );
  const runtimeRoot = path.join(runtimes, "llama");
  await fs.promises.rm(runtimeRoot, { recursive: true, force: true });
  await fs.promises.mkdir(runtimeRoot, { recursive: true });
  await extract(archive, runtimeRoot);
  const llmExecutable = await executable(
    runtimeRoot,
    platform === "win32" ? ["llama-server.exe", "server.exe"] : ["llama-server", "server"],
  );
  const modelFile = path.join(models, "fabric-1.0-q4_k_m.gguf");
  if (
    !(await fs.promises.access(modelFile).then(
      () => true,
      () => false,
    ))
  )
    await download(
      MODEL_URL,
      modelFile,
      "Downloading Fabric 1.0 intelligence weights",
      start + 7,
      end,
      true,
      MAX_MODEL_DOWNLOAD,
    );
  manifest.llmExecutable = llmExecutable;
  manifest.llmModel = modelFile;
  manifest.llmModelSource = MODEL_URL;
  manifest.llmModelSha256 = await verifyDigest(
    modelFile,
    EXPECTED.llamaModel,
    "Fabric language model",
  );
  manifest.runtimeSources.llama = asset.browser_download_url;
}
async function installVoice(selection, manifest, start = 85, end = 99) {
  const asset = selection.asset,
    ext = asset.name.toLowerCase().endsWith(".tar.gz") ? ".tar.gz" : ".zip",
    archive = path.join(downloads, "whisper-runtime" + ext);
  await fs.promises.rm(archive, { force: true });
  await fs.promises.rm(archive + ".part", { force: true });
  await download(
    asset.browser_download_url,
    archive,
    "Downloading Fabric Voice engine",
    start,
    Math.min(end, start + 8),
    false,
  );
  manifest.whisperRuntimeSha256 = await verifyDigest(
    archive,
    EXPECTED.whisperRuntime,
    "Fabric voice runtime",
  );
  await writeStatus(
    {
      state: "installing",
      stage: `Installing ${asset.name}`,
      percent: Math.min(end, start + 9),
      selectedAsset: asset.name,
    },
    true,
  );
  const runtimeRoot = path.join(runtimes, "whisper");
  await fs.promises.rm(runtimeRoot, { recursive: true, force: true });
  await fs.promises.mkdir(runtimeRoot, { recursive: true });
  await extract(archive, runtimeRoot);
  const sttExecutable = await executable(
    runtimeRoot,
    platform === "win32" ? ["whisper-server.exe", "server.exe"] : ["whisper-server", "server"],
  );
  const voiceModel = path.join(models, "fabric-voice-base-en.bin");
  if (
    !(await fs.promises.access(voiceModel).then(
      () => true,
      () => false,
    ))
  )
    await download(
      VOICE_MODEL_URL,
      voiceModel,
      "Downloading Fabric Voice model",
      Math.min(end, start + 10),
      end,
      true,
      MAX_MODEL_DOWNLOAD,
    );
  manifest.sttExecutable = sttExecutable;
  manifest.sttModel = voiceModel;
  manifest.sttModelSource = VOICE_MODEL_URL;
  manifest.sttModelSha256 = await verifyDigest(
    voiceModel,
    EXPECTED.whisperModel,
    "Fabric voice model",
  );
  manifest.runtimeSources.whisper = asset.browser_download_url;
}

try {
  await writeStatus(
    {
      state: "installing",
      stage: `Finding compatible ${component === "voice" ? "voice" : component === "llm" ? "language model" : "native"} runtime`,
      percent: 1,
      platform,
      arch,
    },
    true,
  );
  const metadata = await loadReleaseMetadata(),
    llama =
      component !== "voice"
        ? select(metadata, "llama", process.env.FABRIC_NATIVE_RUNTIME_URL)
        : null,
    whisper =
      component !== "llm"
        ? select(metadata, "whisper", process.env.FABRIC_NATIVE_VOICE_RUNTIME_URL)
        : null;
  const diagnostics = [
    llama && runtimeDiagnostics(llama, { kind: "llama", platform, arch }),
    whisper && runtimeDiagnostics(whisper, { kind: "whisper", platform, arch }),
  ].filter(Boolean);
  if (planOnly) {
    console.log(
      JSON.stringify(
        {
          component,
          platform,
          arch,
          modelUrl: MODEL_URL,
          voiceModelUrl: VOICE_MODEL_URL,
          selections: diagnostics,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  let manifest = (await readJson(manifestFile)) || { version: 2, runtimeSources: {} };
  manifest.version = 2;
  manifest.platform = process.platform;
  manifest.arch = os.arch();
  manifest.runtimeSources ||= {};
  manifest.selectionDiagnostics = diagnostics;
  if (component === "voice") await installVoice(whisper, manifest, 2, 99);
  else if (component === "llm") await installLlm(llama, manifest, 2, 99);
  else {
    await installLlm(llama, manifest, 2, 84);
    await installVoice(whisper, manifest, 85, 99);
  }
  manifest.installedAt = new Date().toISOString();
  manifest.license =
    "Fabric orchestration is part of this project. llama.cpp, whisper.cpp, and Qwen2.5 base weights retain their respective upstream licenses; see THIRD_PARTY_MODELS.md.";
  await atomicJson(manifestFile, manifest);
  const llmReady = !!(manifest.llmExecutable && manifest.llmModel),
    voiceReady = !!(manifest.sttExecutable && manifest.sttModel);
  await writeStatus(
    {
      state: "installed",
      stage:
        component === "voice"
          ? "Fabric Voice is ready"
          : component === "llm"
            ? "Fabric 1.0 is ready"
            : "Fabric 1.0 and Fabric Voice are ready",
      percent: 100,
      downloadedBytes: 0,
      totalBytes: 0,
      components: { llm: llmReady, voice: voiceReady },
      diagnostics,
    },
    true,
  );
  console.log(`Fabric native ${component} installation completed.`);
} catch (error) {
  await writeStatus(
    {
      state: "error",
      stage: `${component === "voice" ? "Voice installation" : component === "llm" ? "Model installation" : "Installation"} failed`,
      percent: 0,
      error: String(error?.message || error),
      code: error?.code || "INSTALL_FAILED",
      platform,
      arch,
    },
    true,
  );
  console.error(error);
  process.exit(1);
}
