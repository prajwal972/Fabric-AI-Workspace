import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("HTTP responses carry centralized security headers", async (t) => {
  const port = 22600 + Math.floor(Math.random() * 200);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-headers-"));
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FABRIC_PORT: String(port),
      FABRIC_DATA_DIR: dir,
      FABRIC_MASTER_KEY: "header-test-master-key-32-characters!!",
      NODE_ENV: "test",
    },
    stdio: "ignore",
  });
  t.after(() => {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let response;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) break;
    } catch {}
    await sleep(50);
  }
  assert.ok(response?.ok);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(response.headers.get("strict-transport-security"), null);
  assert.ok(response.headers.get("x-request-id"));
});