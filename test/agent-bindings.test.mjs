import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveStepInput,
  validatePlanBindings,
} from "../src/agents/bindings.mjs";
const observations = [
  {
    index: 0,
    result: { value: 42, file: { id: "f1" }, rows: [{ amount: 7 }] },
  },
  { index: 1, error: "FAILED" },
];
test("agent dependencies resolve typed earlier results and string composition without evaluation", () => {
  assert.deepEqual(
    resolveStepInput(
      {
        fileId: { $fromStep: 0, path: ["file", "id"] },
        value: { $fromStep: 0, path: ["rows", 0, "amount"] },
        expression: { $concat: [{ $fromStep: 0, path: ["value"] }, "*2"] },
      },
      observations,
      1,
    ),
    { fileId: "f1", value: 7, expression: "42*2" },
  );
  assert.equal(observations[0].result.value, 42);
});
test("dependency validation rejects future, missing, failed and prototype references", () => {
  for (const input of [
    { $fromStep: 1, path: [] },
    { $fromStep: 0, path: ["missing"] },
    { $fromStep: 0, path: ["constructor"] },
    { $fromStep: 0, path: ["__proto__"] },
    { $fromStep: 0, path: [], extra: true },
    { $concat: [{ $fromStep: 0, path: [] }] },
  ])
    assert.throws(() => resolveStepInput(input, observations, 1), {
      code: "INVALID_PLAN_BINDING",
    });
  assert.throws(
    () => resolveStepInput({ $fromStep: 1, path: [] }, observations, 2),
    { code: "INVALID_PLAN_BINDING" },
  );
});
test("plans reject forward dependencies before execution and bound nesting", () => {
  assert.throws(
    () =>
      validatePlanBindings({ steps: [{ input: { $fromStep: 0, path: [] } }] }),
    { code: "INVALID_PLAN_BINDING" },
  );
  assert.doesNotThrow(() =>
    validatePlanBindings({
      steps: [
        { input: { expression: "42" } },
        {
          input: {
            expression: { $concat: [{ $fromStep: 0, path: ["value"] }, "*2"] },
          },
        },
      ],
    }),
  );
  let deep = {};
  for (let i = 0; i < 30; i++) deep = { nested: deep };
  assert.throws(() => resolveStepInput(deep, [], 0), {
    code: "INVALID_PLAN_BINDING",
  });
});
