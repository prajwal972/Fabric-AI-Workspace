import test from "node:test";
import assert from "node:assert/strict";
import { postgresClientEnvironment } from "../scripts/postgres-client.mjs";
test("PostgreSQL backup credentials become environment values, not executable arguments", () => {
  const env = postgresClientEnvironment(
    "postgresql://reader:fixture%40password@127.0.0.1:25432/analytics?sslmode=disable",
    { PATH: "/usr/bin" },
  );
  assert.equal(env.PGHOST, "127.0.0.1");
  assert.equal(env.PGPORT, "25432");
  assert.equal(env.PGUSER, "reader");
  assert.equal(env.PGPASSWORD, "fixture@password");
  assert.equal(env.PGDATABASE, "analytics");
  assert.equal(env.PGSSLMODE, "disable");
});
test("PostgreSQL backup parsing refuses unsupported schemes and connection options", () => {
  assert.throws(() =>
    postgresClientEnvironment("https://example.com/database"),
  );
  assert.throws(() =>
    postgresClientEnvironment("postgresql://reader@localhost/db?unsafe=1"),
  );
});
