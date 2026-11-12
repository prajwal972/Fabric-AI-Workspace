import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isMainModule } from "../src/utils/entrypoint.mjs";
import { voiceService } from "../src/services/voice.mjs";
test("worker entrypoint recognizes Windows drive paths, spaces and case", () => {
  assert.equal(
    isMainModule(
      "file:///C:/Projects/Fabric%20AI/src/workers/production.mjs",
      ["node", "C:\\Projects\\Fabric AI\\src\\workers\\production.mjs"],
      "win32",
    ),
    true,
  );
  assert.equal(
    isMainModule(
      "file:///C:/Projects/Fabric/src/workers/production.mjs",
      ["node", "c:\\projects\\fabric\\src\\workers\\production.mjs"],
      "win32",
    ),
    true,
  );
  assert.equal(
    isMainModule(
      "file:///C:/Projects/Fabric/src/workers/production.mjs",
      ["node", "C:\\Projects\\Fabric\\src\\other.mjs"],
      "win32",
    ),
    false,
  );
});
test("worker entrypoint does not start on imports or invalid module URLs", () => {
  assert.equal(
    isMainModule(
      "file:///data/worker.mjs",
      ["node", "/data/worker.mjs"],
      "linux",
    ),
    true,
  );
  assert.equal(
    isMainModule("file:///data/worker.mjs", ["node"], "linux"),
    false,
  );
  assert.equal(
    isMainModule(
      "https://example.com/worker.mjs",
      ["node", "/data/worker.mjs"],
      "linux",
    ),
    false,
  );
});
test("VS Code local launch is loopback-only and does not connect to inherited production services", async () => {
  const file = JSON.parse(await fs.readFile(".vscode/launch.json", "utf8"));
  const local = file.configurations[0];
  assert.equal(local.env.FABRIC_HOST, "127.0.0.1");
  assert.equal(local.env.DATABASE_URL, "");
  assert.equal(local.env.FABRIC_MASTER_KEY, "");
  assert.equal(local.env.FABRIC_TEST_MOCK, "0");
  assert.equal(local.env.REDIS_URL, "");
  assert.equal(local.env.S3_ENDPOINT, "");
  assert.equal(local.env.FABRIC_DATA_DIR, "${workspaceFolder}/data");
  const postgres = file.configurations[1];
  assert.match(postgres.program, /scripts\/start-postgres.mjs$/);
  assert.match(postgres.envFile, /LOCALAPPDATA/);
  assert.ok(!postgres.env?.FABRIC_MASTER_KEY);
});
test("explicit PostgreSQL entry refuses missing DATABASE_URL before creating data", () => {
  const run = spawnSync(process.execPath, ["scripts/start-postgres.mjs"], {
    env: { ...process.env, DATABASE_URL: "" },
    encoding: "utf8",
    timeout: 10000,
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /DATABASE_URL is required/);
  assert.doesNotMatch(run.stderr, /fabric.started/);
});
test("cloud speech configuration obeys the same explicit disable switch", async () => {
  const service = voiceService({
    nativeRuntime: {},
    DIR: process.cwd(),
    env: {
      FABRIC_ALLOW_CLOUD_AI: false,
      AZURE_SPEECH_KEY: "explicit-unit-fixture",
      AZURE_SPEECH_REGION: "eastus",
    },
  });
  assert.equal(service.azureReady, false);
  assert.equal(service.cloudEnabled, false);
  await assert.rejects(service.synthesize("fixture", "en-IN"), { status: 503 });
  const enabled = voiceService({
    nativeRuntime: {},
    DIR: process.cwd(),
    env: {
      FABRIC_ALLOW_CLOUD_AI: true,
      AZURE_SPEECH_KEY: "explicit-unit-fixture",
      AZURE_SPEECH_REGION: "eastus",
    },
  });
  assert.equal(enabled.azureReady, true);
});

test("container build context excludes environment secrets, certificates and backups", async () => {
  const ignore = await fs.readFile(".dockerignore", "utf8");
  for (const pattern of [
    ".env.*",
    "*.env",
    "*.key",
    "*.pem",
    "*.p12",
    "*.pfx",
    "*.dump",
    "*.backup",
    "*.enc",
  ])
    assert.ok(ignore.split("\n").includes(pattern), pattern);
  assert.ok(ignore.split("\n").includes("!.env.example"));
});
