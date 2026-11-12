import fs from "node:fs";
import crypto from "node:crypto";

export async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifyFileSha256(file, expected, label = "Downloaded artifact") {
  if (!/^[a-f0-9]{64}$/i.test(String(expected || ""))) {
    throw Object.assign(new Error(`${label} requires a valid approved SHA-256 digest`), {
      code: "INTEGRITY_DIGEST_REQUIRED",
    });
  }
  const actual = await sha256File(file);
  if (!crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"))) {
    throw Object.assign(new Error(`${label} failed SHA-256 verification`), {
      code: "INTEGRITY_CHECK_FAILED",
      expected: expected.toLowerCase(),
      actual,
    });
  }
  return actual;
}