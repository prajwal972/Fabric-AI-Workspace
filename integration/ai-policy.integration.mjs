import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import { runMigrations } from "../src/database/migrations.mjs";
import { WorkspaceRepository } from "../src/repositories/workspace.mjs";
import { AIQuotaRepository } from "../src/repositories/ai-quota.mjs";
import { AIRequestPolicy } from "../src/security/public-policy.mjs";
const url = process.env.FABRIC_TEST_DATABASE_URL;
if (process.env.NODE_ENV !== "test" || !url || process.env.DATABASE_URL !== url)
  throw new Error(
    "Explicit matching disposable PostgreSQL test configuration is required.",
  );
test(
  "real PostgreSQL AI admission is atomic across users, workspaces, retries and fresh permissions",
  { timeout: 30000 },
  async (t) => {
    const schema = "fabric_quota_" + crypto.randomUUID().replaceAll("-", "");
    const admin = new pg.Pool({ connectionString: url, max: 2 });
    let pool;
    t.after(async () => {
      if (pool) await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({
      connectionString: url,
      max: 10,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations({ pool, directory: "migrations" });
    await pool.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES('q1','q1@example.test','Fixture one','not-a-login-hash'),('q2','q2@example.test','Fixture two','not-a-login-hash')",
    );
    await pool.query(
      "INSERT INTO workspaces(id,name) VALUES('w1','Fixture workspace'),('w2','Other fixture workspace')",
    );
    await pool.query(
      "INSERT INTO memberships(workspace_id,user_id,role) VALUES('w1','q1','owner'),('w1','q2','member'),('w2','q1','owner')",
    );
    await pool.query(
      "INSERT INTO providers(id,workspace_id,type,name,config) VALUES('p1','w1','ollama','Quota fixture, no model request','{}'),('p2','w2','ollama','Other quota fixture','{}')",
    );
    const repo = new WorkspaceRepository(pool),
      quota = new AIQuotaRepository(repo);
    const env = {
      NODE_ENV: "test",
      FABRIC_AI_USER_DAILY_REQUESTS: 2,
      FABRIC_AI_WORKSPACE_DAILY_REQUESTS: 3,
      FABRIC_REQUIRE_EMAIL_VERIFICATION: false,
      FABRIC_ALLOW_CLOUD_AI: false,
    };
    const policy = new AIRequestPolicy({ quota, env }),
      a = { workspaceId: "w1", user: { id: "q1" }, role: "owner" },
      b = { workspaceId: "w1", user: { id: "q2" }, role: "owner" },
      p = { id: "p1", type: "ollama", enabled: true };
    await t.test(
      "simultaneous requests cannot overdraw a daily user quota",
      async () => {
        const outcomes = await Promise.allSettled(
          Array.from({ length: 8 }, () => policy.admit(a, p)),
        );
        assert.equal(
          outcomes.filter((x) => x.status === "fulfilled").length,
          2,
        );
        assert.ok(
          outcomes
            .filter((x) => x.status === "rejected")
            .every((x) => x.reason.code === "AI_USER_DAILY_LIMIT"),
        );
        assert.deepEqual(await quota.status(a), {
          userUsed: 2,
          workspaceUsed: 2,
        });
      },
    );
    await t.test(
      "workspace exhaustion rolls back the rejected user increment",
      async () => {
        await policy.admit(b, p);
        await assert.rejects(policy.admit(b, p), {
          code: "AI_WORKSPACE_DAILY_LIMIT",
        });
        assert.deepEqual(await quota.status(b), {
          userUsed: 1,
          workspaceUsed: 3,
        });
      },
    );
    await t.test(
      "the user cap follows the user across workspaces",
      async () => {
        await assert.rejects(
          policy.admit({ ...a, workspaceId: "w2" }, { ...p, id: "p2" }),
          { code: "AI_USER_DAILY_LIMIT" },
        );
        assert.equal(
          (await quota.status({ ...a, workspaceId: "w2" })).workspaceUsed,
          0,
        );
      },
    );
    await t.test(
      "revocation and viewer demotion override stale owner roles",
      async () => {
        await pool.query(
          "UPDATE memberships SET role='viewer' WHERE workspace_id='w1' AND user_id='q2'",
        );
        await assert.rejects(policy.admit(b, p), { code: "FORBIDDEN" });
        await pool.query(
          "DELETE FROM memberships WHERE workspace_id='w1' AND user_id='q2'",
        );
        await assert.rejects(policy.admit(b, p), { code: "FORBIDDEN" });
        await pool.query(
          "INSERT INTO memberships(workspace_id,user_id,role) VALUES('w1','q2','member')",
        );
      },
    );
    await t.test(
      "email verification is checked afresh before admission",
      async () => {
        const guarded = new AIRequestPolicy({
          quota,
          env: {
            ...env,
            FABRIC_REQUIRE_EMAIL_VERIFICATION: true,
            FABRIC_AI_USER_DAILY_REQUESTS: 10,
            FABRIC_AI_WORKSPACE_DAILY_REQUESTS: 10,
          },
        });
        await assert.rejects(guarded.admit(b, p), {
          code: "EMAIL_VERIFICATION_REQUIRED",
        });
        await pool.query(
          "UPDATE users SET email_verified_at=now() WHERE id='q2'",
        );
        await guarded.admit(b, p);
      },
    );
    await t.test(
      "disabled or foreign providers cannot authorize model attempts",
      async () => {
        const roomy = new AIRequestPolicy({
          quota,
          env: {
            ...env,
            FABRIC_AI_USER_DAILY_REQUESTS: 10,
            FABRIC_AI_WORKSPACE_DAILY_REQUESTS: 10,
          },
        });
        await pool.query("UPDATE providers SET enabled=false WHERE id='p1'");
        await assert.rejects(roomy.admit(b, p), { code: "PROVIDER_DISABLED" });
        await pool.query("UPDATE providers SET enabled=true WHERE id='p1'");
        await assert.rejects(roomy.admit(b, { ...p, id: "p2" }), {
          code: "PROVIDER_DISABLED",
        });
      },
    );
    await t.test("only current UTC-day counters are incremented", async () => {
      await pool.query(
        "INSERT INTO ai_user_daily(user_id,quota_day,request_count) VALUES('q2',(now() AT TIME ZONE 'UTC')::date-1,999)",
      );
      const roomy = new AIRequestPolicy({
        quota,
        env: {
          ...env,
          FABRIC_AI_USER_DAILY_REQUESTS: 10,
          FABRIC_AI_WORKSPACE_DAILY_REQUESTS: 10,
        },
      });
      await roomy.admit(b, p);
      const yesterday = (
        await pool.query(
          "SELECT request_count FROM ai_user_daily WHERE user_id='q2' AND quota_day=(now() AT TIME ZONE 'UTC')::date-1",
        )
      ).rows[0];
      assert.equal(yesterday.request_count, 999);
    });
  },
);
