import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import { SQLSandbox } from "../src/security/sandbox.mjs";
const source = process.env.FABRIC_TEST_DATABASE_URL;
if (process.env.NODE_ENV !== "test" || !source)
  throw new Error(
    "An explicit disposable PostgreSQL test configuration is required",
  );

test(
  "real isolated analytics database, restricted role, cancellation and deadlines",
  { timeout: 30000 },
  async (t) => {
    const suffix = crypto.randomUUID().replaceAll("-", ""),
      database = "fabric_analytics_" + suffix,
      role = "fabric_reader_" + suffix,
      password = crypto.randomBytes(24).toString("hex");
    const admin = new pg.Pool({ connectionString: source, max: 2 });
    let analyticsAdmin,
      sandbox,
      unsafe,
      dbCreated = false,
      roleCreated = false;
    t.after(async () => {
      await sandbox?.close();
      await unsafe?.close();
      await analyticsAdmin?.end();
      if (dbCreated)
        await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
      if (roleCreated) await admin.query(`DROP ROLE "${role}"`);
      await admin.end();
    });
    await admin.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
    );
    roleCreated = true;
    await admin.query(`CREATE DATABASE "${database}"`);
    dbCreated = true;
    const adminURL = new URL(source);
    adminURL.pathname = "/" + database;
    analyticsAdmin = new pg.Pool({
      connectionString: adminURL.toString(),
      max: 1,
    });
    await analyticsAdmin.query(
      "CREATE TABLE public.revenue(region text,amount integer); INSERT INTO public.revenue VALUES ('South',50),('South',70),('North',30)",
    );
    await analyticsAdmin.query(
      "CREATE TABLE public.private_data(secret text); INSERT INTO public.private_data VALUES ('not allowed')",
    );
    await analyticsAdmin.query(
      "CREATE TABLE public.large_fixture(n integer); INSERT INTO public.large_fixture SELECT generate_series(1,10000)",
    );
    await analyticsAdmin.query(
      "CREATE TABLE public.output_fixture(bigtext text,exact_value numeric); INSERT INTO public.output_fixture VALUES(repeat('x',120000),'1234567890123456789012345.123456789012345')",
    );
    // Ensure a same-named user function cannot override an allowed builtin.
    await analyticsAdmin.query(
      "CREATE FUNCTION public.sum(integer) RETURNS bigint LANGUAGE SQL IMMUTABLE AS $$ SELECT 999::bigint $$",
    );
    await analyticsAdmin.query(
      `GRANT USAGE ON SCHEMA public TO "${role}"; GRANT SELECT ON public.revenue,public.large_fixture,public.output_fixture TO "${role}"`,
    );
    const readerURL = new URL(adminURL);
    readerURL.username = role;
    readerURL.password = password;
    const env = {
      FABRIC_ANALYTICS_DATABASE_URL: readerURL.toString(),
      FABRIC_ANALYTICS_WORKSPACE_ID: "analytics-workspace",
    };
    sandbox = new SQLSandbox(env);
    const context = { actor: { workspaceId: "analytics-workspace" } };
    await t.test(
      "real restricted SELECT uses builtin aggregate and correct deterministic result",
      async () => {
        assert.deepEqual(
          await sandbox.execute(
            {
              query:
                "SELECT sum(amount) AS total FROM public.revenue WHERE region='South'",
            },
            context,
          ),
          { rows: [{ total: "120" }] },
        );
        assert.equal(
          (
            await sandbox.execute(
              { query: "SELECT n FROM public.large_fixture" },
              context,
            )
          ).rows.length,
          100,
        );
      },
    );
    await t.test(
      "workspace, role and database grants deny unauthorized access",
      async () => {
        await assert.rejects(
          sandbox.execute(
            { query: "SELECT 1" },
            { actor: { workspaceId: "other" } },
          ),
          { code: "SQL_WORKSPACE_DENIED" },
        );
        await assert.rejects(
          sandbox.execute(
            { query: "SELECT * FROM public.private_data" },
            context,
          ),
          { code: "SQL_QUERY_FAILED" },
        );
        await assert.rejects(
          sandbox.execute({ query: "DELETE FROM public.revenue" }, context),
          { code: "UNSAFE_SQL" },
        );
        await assert.rejects(
          sandbox.execute({ query: "SELECT public.sum(1)" }, context),
          { code: "UNSAFE_SQL" },
        );
        unsafe = new SQLSandbox({
          ...env,
          FABRIC_ANALYTICS_DATABASE_URL: adminURL.toString(),
        });
        await assert.rejects(unsafe.execute({ query: "SELECT 1" }, context), {
          code: "UNSAFE_SQL_ROLE",
        });
        assert.equal(
          (await analyticsAdmin.query("SELECT count(*) FROM public.revenue"))
            .rows[0].count,
          "3",
        );
      },
    );
    await t.test(
      "server-side output bounds preserve exact decimal types and reject oversized rows",
      async () => {
        assert.deepEqual(
          await sandbox.execute(
            { query: "SELECT exact_value FROM public.output_fixture" },
            context,
          ),
          {
            rows: [
              { exact_value: "1234567890123456789012345.123456789012345" },
            ],
          },
        );
        await assert.rejects(
          sandbox.execute(
            { query: "SELECT bigtext FROM public.output_fixture" },
            context,
          ),
          { code: "SQL_OUTPUT_LIMIT" },
        );
        await assert.rejects(
          sandbox.execute({ query: "SELECT 1 AS x,2 AS x" }, context),
          { code: "SQL_OUTPUT_SCHEMA" },
        );
      },
    );
    const expensive =
      "SELECT count(*) FROM public.large_fixture a CROSS JOIN public.large_fixture b CROSS JOIN public.large_fixture c";
    await t.test(
      "cancellation stops a real running backend and leaves the next query healthy",
      async () => {
        const controller = new AbortController(),
          started = Date.now();
        const running = sandbox.execute(
          { query: expensive },
          { ...context, signal: controller.signal },
        );
        const timer = setTimeout(() => controller.abort(), 150);
        try {
          await assert.rejects(running, { code: "SQL_CANCELLED" });
        } finally {
          clearTimeout(timer);
        }
        assert.ok(
          Date.now() - started < 2500,
          "Cancellation should not wait for the 3-second query deadline",
        );
        assert.deepEqual(
          await sandbox.execute({ query: "SELECT 42 AS value" }, context),
          { rows: [{ value: 42 }] },
        );
        const active = await analyticsAdmin.query(
          "SELECT count(*) FROM pg_stat_activity WHERE usename=$1 AND state='active'",
          [role],
        );
        assert.equal(active.rows[0].count, "0");
      },
    );
    await t.test(
      "actual PostgreSQL statement deadline fails safely rather than hanging",
      async () => {
        const started = Date.now();
        await assert.rejects(sandbox.execute({ query: expensive }, context), {
          code: "SQL_TIMEOUT",
        });
        assert.ok(Date.now() - started < 6000);
      },
    );
  },
);
