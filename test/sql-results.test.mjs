import test from "node:test";
import assert from "node:assert/strict";
import {
  boundedSQLProjection,
  decodeSQLRows,
} from "../src/security/sql-results.mjs";
test("SQL wire decoding preserves bigint and numeric precision while retaining native scalar types", () => {
  const fields = [
    { name: "total", dataTypeID: 20 },
    { name: "amount", dataTypeID: 1700 },
    { name: "n", dataTypeID: 23 },
    { name: "active", dataTypeID: 16 },
    { name: "data", dataTypeID: 3802 },
  ];
  const rows = [
    {
      payload: {
        total: "9223372036854775807",
        amount: "0.1234567890123456789",
        n: "42",
        active: "t",
        data: '{"ok":true}',
      },
    },
  ];
  assert.deepEqual(decodeSQLRows(rows, fields), [
    {
      total: "9223372036854775807",
      amount: "0.1234567890123456789",
      n: 42,
      active: true,
      data: { ok: true },
    },
  ]);
});
test("SQL projection bounds wire bytes and refuses ambiguous or unsupported output types", () => {
  const projection = boundedSQLProjection("SELECT 1 AS x", [
    { name: "x", dataTypeID: 23 },
  ]);
  assert.match(projection, /octet_length\(payload::text\)<=10000/);
  assert.match(projection, /LIMIT 100/);
  assert.throws(
    () => boundedSQLProjection("SELECT 1", [{ name: "x", dataTypeID: 999999 }]),
    { code: "SQL_UNSUPPORTED_TYPE" },
  );
  assert.throws(
    () =>
      boundedSQLProjection("SELECT 1", [
        { name: "x", dataTypeID: 23 },
        { name: "x", dataTypeID: 23 },
      ]),
    { code: "SQL_OUTPUT_SCHEMA" },
  );
  assert.throws(
    () => decodeSQLRows([{ payload: null }], [{ name: "x", dataTypeID: 23 }]),
    { code: "SQL_OUTPUT_LIMIT" },
  );
});
