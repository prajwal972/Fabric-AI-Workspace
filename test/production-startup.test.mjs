import test from "node:test";
import assert from "node:assert/strict";
import { applicationConfig } from "../src/application/config.mjs";
import { SQLSandbox } from "../src/security/sandbox.mjs";
const base = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://app:fixture@db:5432/fabric",
  REDIS_URL: "rediss://cache:6379",
  S3_ENDPOINT: "https://storage.example.test",
  S3_BUCKET: "private",
  FABRIC_PUBLIC_URL: "https://fabric.example.test",
  FABRIC_MASTER_KEY: "0123456789abcdef".repeat(4),
  FABRIC_METRICS_TOKEN: "abcdef0123456789".repeat(4),
  FABRIC_UPLOAD_SCAN_MODE: "required",
};
test("production startup rejects copied placeholder/repeated secrets and optional scanning", () => {
  for (const FABRIC_MASTER_KEY of [
    "replace-with-at-least-32-random-characters",
    "x".repeat(48),
    "test-master-key-32-characters-long",
  ])
    assert.throws(
      () => applicationConfig({ ...base, FABRIC_MASTER_KEY }),
      /MASTER_KEY/,
    );
  assert.throws(
    () => applicationConfig({ ...base, FABRIC_METRICS_TOKEN: "" }),
    /METRICS_TOKEN/,
  );
  assert.throws(
    () => applicationConfig({ ...base, FABRIC_UPLOAD_SCAN_MODE: "optional" }),
    /scanning/,
  );
  assert.equal(applicationConfig(base).production, true);
});
test("production service URLs use explicit allowed protocols", () => {
  for (const [field, value] of [
    ["DATABASE_URL", "https://not-postgres.example.test"],
    ["REDIS_URL", "file:///tmp/redis"],
    ["S3_ENDPOINT", "file:///tmp/storage"],
    ["FABRIC_PUBLIC_URL", "ftp://example.test"],
  ])
    assert.throws(
      () => applicationConfig({ ...base, [field]: value }),
      new RegExp(field),
    );
});
test("analytics cannot accidentally point at the application database even with another role or loopback alias", () => {
  assert.throws(
    () =>
      new SQLSandbox({
        DATABASE_URL: "postgresql://app:fixture@localhost:5432/fabric",
        FABRIC_ANALYTICS_DATABASE_URL:
          "postgresql://reader:fixture@127.0.0.1/fabric",
      }),
    { code: "SQL_DATABASE_NOT_ISOLATED" },
  );
  assert.throws(
    () =>
      new SQLSandbox({
        DATABASE_URL: "postgresql://app:fixture@db:5432/fabric",
        FABRIC_ANALYTICS_DATABASE_URL: "postgresql://reader:fixture@db/fabric",
      }),
    { code: "SQL_DATABASE_NOT_ISOLATED" },
  );
});
