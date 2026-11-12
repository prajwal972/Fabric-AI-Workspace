import { verifyPrivatePath } from "../src/security/private-path.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("backup encryption round-trips and rejects tampering", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-backup-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const plain = path.join(dir, "plain.dump");
  const encrypted = path.join(dir, "backup.enc");
  const restored = path.join(dir, "restored.dump");
  const key = path.join(dir, "key");
  await fs.writeFile(plain, "database backup fixture");
  await fs.writeFile(key, Buffer.alloc(48, 7), { mode: 0o600 });
  const run = (...args) =>
    spawnSync(process.execPath, ["scripts/crypt-backup.mjs", ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  assert.equal(run("encrypt", plain, encrypted, key).status, 0);
  assert.equal(run("decrypt", encrypted, restored, key).status, 0);
  assert.equal(await fs.readFile(restored, "utf8"), "database backup fixture");
  const value = await fs.readFile(encrypted);
  value[Math.floor(value.length / 2)] ^= 1;
  await fs.writeFile(encrypted, value);
  assert.notEqual(run("decrypt", encrypted, restored, key).status, 0);
});
test("unauthenticated backup plaintext is never published and existing outputs stay unchanged", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-backup-auth-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, "plain"),
    encrypted = path.join(dir, "encrypted"),
    key = path.join(dir, "key"),
    out = path.join(dir, "output");
  await fs.writeFile(input, "sensitive fixture payload");
  await fs.writeFile(key, Buffer.alloc(48, 4), { mode: 0o600 });
  const run = (...args) =>
    spawnSync(process.execPath, ["scripts/crypt-backup.mjs", ...args], {
      encoding: "utf8",
    });
  assert.equal(run("encrypt", input, encrypted, key).status, 0);
  const bytes = await fs.readFile(encrypted);
  bytes[bytes.length - 1] ^= 1;
  await fs.writeFile(encrypted, bytes);
  await fs.writeFile(out, "original output", { mode: 0o644 });
  assert.notEqual(run("decrypt", encrypted, out, key).status, 0);
  assert.equal(await fs.readFile(out, "utf8"), "original output");
  await fs.rm(out);
  assert.notEqual(run("decrypt", encrypted, out, key).status, 0);
  await assert.rejects(fs.stat(out), { code: "ENOENT" });
  assert.equal(
    (await fs.readdir(dir)).filter((name) => name.startsWith(".fabric-crypto-"))
      .length,
    0,
  );
});
test("valid backup plaintext atomically replaces output with private permissions; truncated archives fail", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-backup-mode-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const plain = path.join(dir, "plain"),
    enc = path.join(dir, "enc"),
    out = path.join(dir, "out"),
    key = path.join(dir, "key");
  await fs.writeFile(plain, "fixture");
  await fs.writeFile(key, Buffer.alloc(48, 9), { mode: 0o600 });
  await fs.writeFile(out, "old", { mode: 0o644 });
  const run = (...args) =>
    spawnSync(process.execPath, ["scripts/crypt-backup.mjs", ...args], {
      encoding: "utf8",
    });
  assert.equal(run("encrypt", plain, enc, key).status, 0);
  assert.equal(run("decrypt", enc, out, key).status, 0);
  // POSIX 0600 on Unix; protected current-user-only NTFS DACL on Windows.
  // Content, tamper refusal, replacement and cleanup assertions still run.
  await verifyPrivatePath(out);
  assert.equal(await fs.readFile(out, "utf8"), "fixture");
  await fs.writeFile(enc, Buffer.from("FABBAK01"));
  assert.notEqual(run("decrypt", enc, out, key).status, 0);
  assert.equal(await fs.readFile(out, "utf8"), "fixture");
  assert.notEqual(run("encrypt", plain, key, key).status, 0);
});
