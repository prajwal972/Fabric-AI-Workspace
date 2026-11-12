import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadJsonStore, persistSnapshotSafe } from "../src/storage/json-store.mjs";

const blank = () => ({ schemaVersion: 1, users: [], workspaces: [] });

test("a corrupt primary store recovers from backup without discarding evidence", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-store-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "flux.json");
  await fs.writeFile(file, '{"users":');
  await fs.writeFile(`${file}.bak`, JSON.stringify(blank()));
  const loaded = await loadJsonStore(file, blank);
  assert.equal(loaded.source, "backup");
  assert.match(loaded.preserved, /\.corrupt-/);
  assert.equal(await fs.readFile(file, "utf8"), '{"users":');
  assert.equal(await fs.readFile(loaded.preserved, "utf8"), '{"users":');
});

test("startup fails closed when primary and backup are corrupt", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-store-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "flux.json");
  await fs.writeFile(file, "{bad");
  await fs.writeFile(`${file}.bak`, "{also-bad");
  await assert.rejects(() => loadJsonStore(file, blank), { code: "DATA_STORE_CORRUPT" });
  assert.equal(await fs.readFile(file, "utf8"), "{bad");
});

test("safe persistence keeps a last-known-good backup", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-store-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "flux.json");
  await fs.writeFile(file, '{"version":1}');
  await persistSnapshotSafe(file, '{"version":2}');
  assert.equal(await fs.readFile(file, "utf8"), '{"version":2}');
  assert.equal(await fs.readFile(`${file}.bak`, "utf8"), '{"version":1}');
});