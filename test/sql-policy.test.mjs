import test from "node:test";
import assert from "node:assert/strict";
import { validateAnalyticsSQL } from "../src/security/sql-policy.mjs";
for (const query of [
  "SELECT sum(amount) FROM public.revenue WHERE region = 'South'",
  "WITH totals AS (SELECT sum(amount) AS total FROM public.revenue) SELECT total FROM totals",
  "SELECT round(avg(amount),2),count(*) FROM public.revenue",
  "SELECT 'delete; -- text', 'O''Reilly'",
  "SELECT row_number() OVER (ORDER BY amount) FROM public.revenue",
])
  test("safe analytics dialect " + query, () =>
    assert.equal(validateAnalyticsSQL(query), query),
  );
for (const query of [
  "SELECT pg_sleep(1)",
  "SELECT public.sum(amount) FROM public.revenue",
  "SELECT pg_advisory_lock(1)",
  "SELECT pg_notify('topic','data')",
  "SELECT pg_read_file('/etc/passwd')",
  "SELECT 1; SELECT 2",
  "WITH x AS (DELETE FROM public.revenue RETURNING *) SELECT * FROM x",
  'SELECT "pg_sleep"(1)',
  "SELECT $$x$$",
  "SELECT 1::public.customtype",
  "SELECT E'escaped\\\' string'",
  "SELECT x OPERATOR(public.custom) y",
  "SELECT 1 -- comment",
  "SELECT repeat('x',1000000)",
  "SELECT (1",
  "SELECT 1 INTO public.newtable",
  "SELECT public.custom_fn()",
])
  test("unsafe analytics dialect " + query, () =>
    assert.throws(() => validateAnalyticsSQL(query), { code: "UNSAFE_SQL" }),
  );

test("analytics callers cannot read server catalogs or connection metadata", () => {
  for (const query of [
    "SELECT * FROM pg_catalog.pg_settings",
    "SELECT * FROM pg_stat_activity",
    "SELECT * FROM information_schema.tables",
  ])
    assert.throws(() => validateAnalyticsSQL(query), { code: "UNSAFE_SQL" });
});
