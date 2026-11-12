import test from "node:test";
import assert from "node:assert/strict";
import { validateNumericExplanation } from "../src/analytics/numeric-grounding.mjs";
const facts = {
  value: 120,
  provenance: {
    fileIds: ["fil_99999999"],
    columns: ["Revenue2024"],
    rowsIncluded: 2,
    validValues: 2,
    calculatedAt: "2026-10-10T08:57:37Z",
  },
};
test("numeric explanation accepts computed values/counts but not digits harvested from provenance", () => {
  assert.equal(
    validateNumericExplanation("Total 120 from 2 rows.", facts).valid,
    true,
  );
  for (const value of [99999999, 2024, 2026, 57, 37])
    assert.equal(
      validateNumericExplanation("The total is " + value + ".", facts).valid,
      false,
    );
});
test("scientific notation and magnitude suffixes are values, not disconnected allowed digits", () => {
  for (const answer of ["Total 1.2e2.", "Total 0.12k."])
    assert.equal(validateNumericExplanation(answer, facts).valid, true);
  for (const answer of [
    "Total 120k.",
    "Total 120 million.",
    "Total 1e999.",
    "Total 1.2e3.",
  ])
    assert.equal(validateNumericExplanation(answer, facts).valid, false);
});
test("Unicode minus and financial parentheses preserve negative numerical meaning", () => {
  assert.equal(validateNumericExplanation("Total −120.", facts).valid, false);
  assert.equal(validateNumericExplanation("Total (₹120).", facts).valid, false);
  const negative = { ...facts, value: -120 };
  assert.equal(validateNumericExplanation("Total −120.", negative).valid, true);
  assert.equal(
    validateNumericExplanation("Total (₹120).", negative).valid,
    true,
  );
});
test("currency grouping, Indian grouping and bounded display rounding are deterministic", () => {
  assert.equal(
    validateNumericExplanation("Total ₹1,200,000.", { value: 1200000 }).valid,
    true,
  );
  assert.equal(
    validateNumericExplanation("Total ₹12,00,000.", { value: 1200000 }).valid,
    true,
  );
  assert.equal(
    validateNumericExplanation("Total 12,34.", { value: 1234 }).valid,
    false,
  );
  assert.equal(
    validateNumericExplanation("Mean 0.33.", { value: 1 / 3 }).valid,
    true,
  );
  assert.equal(
    validateNumericExplanation("Mean 0.34.", { value: 1 / 3 }).valid,
    false,
  );
});
test("numeric group labels can be described without allowing arbitrary text-label digits", () => {
  const groups = {
    value: [
      { label: "2024", value: 120, rows: 2 },
      { label: "Store99999", value: 70, rows: 1 },
    ],
  };
  assert.equal(
    validateNumericExplanation("In 2024 the sum was 120 from 2 rows.", groups)
      .valid,
    true,
  );
  assert.equal(
    validateNumericExplanation("The sum was 99999.", groups).valid,
    false,
  );
});
test("compact unsupported numeric syntax cannot bypass validation", () => {
  for (const answer of ["Total 0xFF.", "Total 120n.", "Total 120USD."])
    assert.equal(validateNumericExplanation(answer, facts).valid, false);
});
test("numeric checks do not claim semantic proof or use explanation values as data", () => {
  const before = JSON.stringify(facts),
    result = validateNumericExplanation("Total 120.", facts);
  assert.equal(result.semanticSupportVerified, false);
  assert.equal(result.checkedNumericClaims, 1);
  assert.equal(JSON.stringify(facts), before);
  assert.equal(
    validateNumericExplanation("Qualitative description.", facts).valid,
    true,
  );
});

test("unsupported separators/digits fail closed while standard Unicode grouping is normalized", () => {
  assert.equal(
    validateNumericExplanation("Total 1_000.", { value: 120 }).valid,
    false,
  );
  assert.equal(
    validateNumericExplanation("Total १२०.", { value: 120 }).valid,
    false,
  );
  assert.equal(
    validateNumericExplanation("Total 1\u202f000.", { value: 1000 }).valid,
    true,
  );
});
