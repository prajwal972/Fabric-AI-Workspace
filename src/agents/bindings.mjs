import { AppError } from "../server/errors.mjs";
const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);
const invalid = () =>
  new AppError(
    "INVALID_PLAN_BINDING",
    "An agent dependency must reference a successful earlier step and a valid result path.",
    422,
  );
function reference(value, index) {
  const keys = Object.keys(value);
  if (
    keys.some((k) => !["$fromStep", "path"].includes(k)) ||
    !Number.isInteger(value.$fromStep) ||
    value.$fromStep < 0 ||
    value.$fromStep >= index ||
    !Array.isArray(value.path) ||
    value.path.length > 8 ||
    value.path.some(
      (k) =>
        !(
          typeof k === "string" &&
          k.length > 0 &&
          k.length <= 100 &&
          !unsafeKeys.has(k)
        ) && !(Number.isInteger(k) && k >= 0 && k <= 100000),
    )
  )
    throw invalid();
}
function transform(input, observations, index, validateOnly = false) {
  let nodes = 0;
  function visit(value, depth = 0) {
    if (++nodes > 2000 || depth > 20) throw invalid();
    if (value === null || typeof value !== "object") return value;
    if (Object.hasOwn(value, "$fromStep")) {
      reference(value, index);
      if (validateOnly) return null;
      const observation = observations.findLast(
        (o) => o.index === value.$fromStep && Object.hasOwn(o, "result"),
      );
      if (!observation) throw invalid();
      let result = observation.result;
      for (const key of value.path) {
        if (
          result === null ||
          typeof result !== "object" ||
          !Object.hasOwn(result, key)
        )
          throw invalid();
        result = result[key];
      }
      return structuredClone(result);
    }
    if (Object.hasOwn(value, "$concat")) {
      if (
        Object.keys(value).length !== 1 ||
        !Array.isArray(value.$concat) ||
        value.$concat.length < 1 ||
        value.$concat.length > 20
      )
        throw invalid();
      const parts = value.$concat.map((p) => visit(p, depth + 1));
      if (
        parts.some(
          (p) => (typeof p === "object" && p !== null) || p === undefined,
        )
      )
        throw invalid();
      const text = parts.map((p) => String(p)).join("");
      if (Buffer.byteLength(text) > 20000) throw invalid();
      return text;
    }
    if (Array.isArray(value)) return value.map((v) => visit(v, depth + 1));
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => {
        if (unsafeKeys.has(k)) throw invalid();
        return [k, visit(v, depth + 1)];
      }),
    );
  }
  const resolved = visit(input);
  if (Buffer.byteLength(JSON.stringify(resolved)) > 200000) throw invalid();
  return resolved;
}
export function validatePlanBindings(plan) {
  for (let index = 0; index < plan.steps.length; index++)
    transform(plan.steps[index].input, [], index, true);
  return plan;
}
export function resolveStepInput(input, observations, index) {
  return transform(input, observations, index);
}
export const bindingInstructions =
  'To use an earlier successful tool result, put {"$fromStep":0,"path":["field"]} at the exact input value. Step indices are zero-based and must be earlier than the current step. Empty path references the entire result. For a string formed from values, use {"$concat":["literal",{"$fromStep":0,"path":["field"]}]}. No JavaScript, expression evaluation, prototype paths, forward references or private reasoning. Inputs are validated again after dependency resolution.';
