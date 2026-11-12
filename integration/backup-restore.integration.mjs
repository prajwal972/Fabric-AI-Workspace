import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runMigrations } from "../src/database/migrations.mjs";
const run = promisify(execFile),
  url = process.env.FABRIC_TEST_DATABASE_URL;
if (process.env.NODE_ENV !== "test" || !url)
  throw new Error(
    "An explicit disposable PostgreSQL test configuration is required",
  );
test(
  "real PostgreSQL encrypted backup/restore drill is transactional and fail-closed",
  { timeout: 60000 },
  async (t) => {
    const suffix = crypto.randomUUID().replaceAll("-", ""),
      source = "fabric_backup_" + suffix,
      target = "fabric_restore_" + suffix;
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    let sourcePool, targetPool;
    const databases = [];
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "fabric-db-drill-"),
    );
    t.after(async () => {
      await sourcePool?.end();
      await targetPool?.end();
      for (const name of databases)
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.end();
      await fs.rm(directory, { recursive: true, force: true });
    });
    for (const name of [source, target]) {
      await admin.query(`CREATE DATABASE "${name}"`);
      databases.push(name);
    }
    const sourceURL = new URL(url),
      targetURL = new URL(url);
    sourceURL.pathname = "/" + source;
    targetURL.pathname = "/" + target;
    sourcePool = new pg.Pool({
      connectionString: sourceURL.toString(),
      max: 1,
    });
    targetPool = new pg.Pool({
      connectionString: targetURL.toString(),
      max: 1,
    });
    await runMigrations({ pool: sourcePool,directory:"migrations" });
    await sourcePool.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES('drill-user','drill@example.test','Restore fixture','explicitly-not-a-real-password-hash'); INSERT INTO workspaces(id,name) VALUES('drill-workspace','Restored workspace'); INSERT INTO memberships(workspace_id,user_id,role) VALUES('drill-workspace','drill-user','owner'); INSERT INTO conversations(id,workspace_id,created_by,title) VALUES('drill-conversation','drill-workspace','drill-user','Verified restore'); INSERT INTO messages(id,workspace_id,conversation_id,user_id,role,content,metadata) VALUES('drill-message','drill-workspace','drill-conversation','drill-user','assistant','Deterministic fixture result: 84','{\"provenance\":{\"operation\":\"multiply\",\"inputs\":[42,2],\"result\":84}}')",
    );
    const key = path.join(directory, "key");
    await fs.writeFile(key, crypto.randomBytes(48), { mode: 0o600 });
    const backups = path.join(directory, "backups");
    const env = {
      ...process.env,
      DATABASE_URL: sourceURL.toString(),
      BACKUP_DIR: backups,
      FABRIC_BACKUP_ENCRYPTION_KEY_FILE: key,
      S3_BACKUP_URI: "",
    };
    await t.test(
      "actual pg_dump creates only encrypted output and no leaked plaintext temporary",
      async () => {
        await run("bash", ["scripts/backup.sh"], { env, timeout: 30000 });
        const files = await fs.readdir(backups);
        assert.equal(files.filter((n) => n.endsWith(".dump.enc")).length, 1);
        assert.equal(files.filter((n) => n.endsWith(".dump")).length, 0);
      },
    );
    const name = (await fs.readdir(backups)).find((n) =>
        n.endsWith(".dump.enc"),
      ),
      original = path.join(backups, name),
      moved = path.join(directory, "relocated");
    await fs.mkdir(moved);
    const backup = path.join(moved, name);
    await fs.copyFile(original, backup);
    await fs.copyFile(original + ".sha256", backup + ".sha256");
    const restoreEnv = {
      ...env,
      DATABASE_URL: targetURL.toString(),
      FABRIC_RESTORE_CONFIRM: "",
    };
    await t.test(
      "restore requires explicit confirmation and accepts relocated checksum files safely",
      async () => {
        await assert.rejects(
          run("bash", ["scripts/restore.sh", backup], {
            env: restoreEnv,
            timeout: 30000,
          }),
        );
        assert.equal(
          (
            await targetPool.query(
              "SELECT count(*) FROM pg_tables WHERE schemaname='public'",
            )
          ).rows[0].count,
          "0",
        );
        await run("bash", ["scripts/restore.sh", backup], {
          env: { ...restoreEnv, FABRIC_RESTORE_CONFIRM: "RESTORE" },
          timeout: 30000,
        });
        const row = (
          await targetPool.query(
            "SELECT content,metadata FROM messages WHERE id='drill-message'",
          )
        ).rows[0];
        assert.equal(row.content, "Deterministic fixture result: 84");
        assert.equal(row.metadata.provenance.result, 84);
        assert.deepEqual(await runMigrations({ pool: targetPool,directory:"migrations" }), []);
        assert.equal(
          (
            await targetPool.query(
              "SELECT count(*) FROM memberships WHERE workspace_id='drill-workspace'",
            )
          ).rows[0].count,
          "1",
        );
      },
    );
    await t.test(
      "tampering fails before target modification; failed encryption cleans plaintext dumps",
      async () => {
        const bytes = await fs.readFile(backup);
        bytes[Math.floor(bytes.length / 2)] ^= 1;
        await fs.writeFile(backup, bytes);
        await assert.rejects(
          run("bash", ["scripts/restore.sh", backup], {
            env: { ...restoreEnv, FABRIC_RESTORE_CONFIRM: "RESTORE" },
            timeout: 30000,
          }),
        );
        assert.equal(
          (
            await targetPool.query(
              "SELECT metadata FROM messages WHERE id='drill-message'",
            )
          ).rows[0].metadata.provenance.result,
          84,
        );
        const badKey = path.join(directory, "bad-key");
        await fs.writeFile(badKey, "x");
        const failed = path.join(directory, "failed-backup");
        await assert.rejects(
          run("bash", ["scripts/backup.sh"], {
            env: {
              ...env,
              BACKUP_DIR: failed,
              FABRIC_BACKUP_ENCRYPTION_KEY_FILE: badKey,
            },
            timeout: 30000,
          }),
        );
        assert.deepEqual(await fs.readdir(failed), []);
      },
    );
  },
);
