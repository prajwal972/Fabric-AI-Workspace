import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileTypeFromFile } from "file-type";

const EXECUTABLE_TYPES = new Set([
  "application/x-msdownload",
  "application/x-executable",
  "application/x-elf",
  "application/x-mach-binary",
  "application/wasm",
]);
const EXECUTABLE_EXTENSIONS = new Set([
  ".exe",
  ".dll",
  ".com",
  ".msi",
  ".scr",
  ".bat",
  ".cmd",
  ".app",
  ".dmg",
  ".so",
  ".bin",
  ".wasm",
]);

export async function inspectUpload(file, { name, declaredMime = "" }) {
  const detected = await fileTypeFromFile(file).catch(() => null);
  const ext = path.extname(name || "").toLowerCase();
  const detectedMime =
    detected?.mime || (declaredMime.startsWith("text/") ? declaredMime : null);
  if (EXECUTABLE_EXTENSIONS.has(ext) || EXECUTABLE_TYPES.has(detectedMime)) {
    throw Object.assign(new Error("Executable uploads are not allowed"), {
      status: 415,
      code: "EXECUTABLE_UPLOAD_BLOCKED",
    });
  }
  const declaredFamily = declaredMime.split("/")[0];
  const detectedFamily = detectedMime?.split("/")[0];
  if (
    detected &&
    ["image", "audio", "video"].includes(declaredFamily) &&
    declaredFamily !== detectedFamily
  ) {
    throw Object.assign(
      new Error("Declared MIME type does not match file contents"),
      {
        status: 415,
        code: "UPLOAD_TYPE_MISMATCH",
      },
    );
  }
  const stat = await fs.stat(file);
  return {
    detectedMime: detectedMime || "application/octet-stream",
    detectedExtension: detected?.ext || null,
    size: stat.size,
  };
}

export function scanUpload(file, env = process.env) {
  const required =
    env.FABRIC_UPLOAD_SCAN_MODE === "required" ||
    ["production", "staging"].includes(env.NODE_ENV);
  const binary = env.FABRIC_CLAMDSCAN_BIN || "clamdscan";
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["--no-summary", "--stream", file], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    const timer = setTimeout(
      () => {
        child.kill("SIGKILL");
        reject(
          Object.assign(new Error("Malware scan timed out"), {
            code: "MALWARE_SCAN_TIMEOUT",
          }),
        );
      },
      Number(env.FABRIC_MALWARE_SCAN_TIMEOUT_MS || 60_000),
    );
    child.stdout.on("data", (chunk) => (output += chunk.toString()));
    child.stderr.on("data", (chunk) => (output += chunk.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      if (!required && error.code === "ENOENT")
        return resolve({ status: "not-configured" });
      reject(
        Object.assign(new Error("Malware scanner is unavailable"), {
          code: "MALWARE_SCANNER_UNAVAILABLE",
        }),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ status: "clean" });
      if (code === 1)
        return reject(
          Object.assign(new Error("Upload was rejected by malware scanning"), {
            status: 422,
            code: "MALWARE_DETECTED",
          }),
        );
      if (!required) return resolve({ status: "scan-error" });
      reject(
        Object.assign(new Error("Malware scan could not complete"), {
          status: 503,
          code: "MALWARE_SCAN_FAILED",
        }),
      );
    });
  });
}
