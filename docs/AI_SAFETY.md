# AI safety

Platform and workspace instructions are separated from untrusted evidence. Retrieved pages, files, and plugin output are appended to a user message inside an explicit untrusted-evidence boundary. Tools and external actions are authorized in code, never by model text.

Required production additions: injection/red-team corpus, sensitive-data redaction policy, cost/usage quotas, model fallback policy, circuit breakers, source-attribution checks, destructive-action confirmation, and immutable AI safety events. Deterministic analyst values must continue to come from code with provenance, never model-generated numbers.
