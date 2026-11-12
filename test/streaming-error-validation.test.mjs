import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { publicError } from "../src/server/errors.mjs";
test("streaming boundaries normalize schema errors without leaking submitted values", () => {
  let error;
  try {
    z.object({ limit: z.number().int().min(1).max(100) }).parse({
      limit: "fixture-private-value",
    });
  } catch (e) {
    error = e;
  }
  const result = publicError(error, "request-fixture");
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, "VALIDATION_ERROR");
  assert.equal(result.body.error.requestId, "request-fixture");
  assert.ok(!JSON.stringify(result).includes("fixture-private-value"));
});
