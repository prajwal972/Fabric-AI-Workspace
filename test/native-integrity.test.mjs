import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sha256File, verifyFileSha256 } from "../scripts/integrity.mjs";

test("native artifacts require an approved SHA-256 digest", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-integrity-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "runtime.bin");
  await fs.writeFile(file, "trusted fixture");
  const digest = await sha256File(file);
  assert.equal(await verifyFileSha256(file, digest, "Fixture"), digest);
  await assert.rejects(() => verifyFileSha256(file, "", "Fixture"), {
    code: "INTEGRITY_DIGEST_REQUIRED",
  });
  await assert.rejects(() => verifyFileSha256(file, "0".repeat(64), "Fixture"), {
    code: "INTEGRITY_CHECK_FAILED",
  });
});