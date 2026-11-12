import test from "node:test";
import assert from "node:assert/strict";
import { PythonSandbox } from "../src/security/sandbox.mjs";
const base = {
  FABRIC_SANDBOX_IMAGE: "python@sha256:" + "a".repeat(64),
  FABRIC_SANDBOX_DEDICATED_HOST: "1",
  FABRIC_CONTAINER_BIN: "must-never-spawn",
  FABRIC_SANDBOX_DOCKER_HOST: "tcp://executor.example.test:2376",
  DOCKER_TLS_VERIFY: "1",
  DOCKER_CERT_PATH: "/private/executor-certs",
};
const invoke = (env) =>
  new PythonSandbox(env).execute(
    { code: "print(42)" },
    { executionId: "transport-test" },
  );
test("dedicated sandbox still rejects missing or disabled verified TLS", async () => {
  for (const value of [undefined, "0", "false", "yes"])
    await assert.rejects(invoke({ ...base, DOCKER_TLS_VERIFY: value }), {
      code: "SANDBOX_TRANSPORT_UNSAFE",
    });
  await assert.rejects(invoke({ ...base, DOCKER_CERT_PATH: "" }), {
    code: "SANDBOX_TRANSPORT_UNSAFE",
  });
});
test("sandbox refuses local sockets and loopback executor endpoints", async () => {
  for (const host of [
    "unix:///var/run/docker.sock",
    "npipe:////./pipe/docker_engine",
    "tcp://localhost:2376",
    "tcp://127.0.0.1:2376",
    "tcp://[::1]:2376",
    "tcp://0.0.0.0:2376",
    "tcp://127.1:2376",
    "tcp://127.0.0.2:2376",
    "tcp://localhost.:2376",
    "tcp://worker.localhost:2376",
    "tcp://2130706433:2376",
    "tcp://[::ffff:127.0.0.1]:2376",
  ])
    await assert.rejects(
      invoke({ ...base, FABRIC_SANDBOX_DOCKER_HOST: host }),
      { code: "SANDBOX_TRANSPORT_UNSAFE" },
    );
});
test("sandbox transport refuses ambiguous URL credentials, paths and protocols", async () => {
  for (const host of [
    "bad-url",
    "http://executor.example.test:2376",
    "tcp://user:secret@executor.example.test:2376",
    "tcp://executor.example.test:2376/docker",
    "tcp://executor.example.test:2376?tls=false",
    "tcp://executor.example.test:2376#fragment",
    "tcp://executor.example.test",
  ])
    await assert.rejects(
      invoke({ ...base, FABRIC_SANDBOX_DOCKER_HOST: host }),
      { code: "SANDBOX_TRANSPORT_UNSAFE" },
    );
});
test("valid transport configuration does not bypass cancellation or dedicated-host requirement", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    new PythonSandbox(base).execute(
      { code: "print(42)" },
      { signal: controller.signal, executionId: "cancelled" },
    ),
    { name: "AbortError" },
  );
  await assert.rejects(
    invoke({ ...base, FABRIC_SANDBOX_DEDICATED_HOST: "0" }),
    { code: "SANDBOX_UNAVAILABLE" },
  );
});
