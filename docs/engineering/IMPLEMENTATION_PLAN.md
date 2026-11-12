# Ordered implementation plan and checkpoints

Do not advance a phase until its acceptance checks pass. Keep existing deterministic analytics, authentication, RBAC, provider protocols, provenance and glass frontend.

## Original Foundation checkpoint (historical planning record)
1. Record baseline/audit before modifications.
2. Extract migration runner; commit DDL + checksum ledger in the same transaction without changing applied migration checksums; test failed SQL rollback and migration reapply/rollback against real PostgreSQL.
3. Add transaction helper and workspace-scoped PostgreSQL conversation repository. Introduce a compatible local conversation repository and service; wire existing conversation CRUD through it. Do not claim full PostgreSQL migration.
4. Add startup validation and block production JSON runtime until migration is complete; avoid filesystem changes before validation.
5. Centralize safe API errors/request IDs and security headers; protect analyst dashboard-operation permission.
6. Remove only verified unreachable workflow runtime, leaving legacy data and 410 response.
7. Run complete regression tests, real PostgreSQL repository/migration tests, and local browser smoke checks where available. Report separate test categories.

## Original Phase 1 backlog (historical; superseded by checkpoint reports)
- Normalize mappings for every existing record including native providers, OAuth state and analyst versions. Create migrations for missing domains; do not store one giant workspace snapshot in PostgreSQL.
- Transactional user/workspace/member/provider/session registration; session workspace binding and revocation.
- Migrate provider configuration, conversations/messages/chat, files, memory, analyst state, agent/run/tool records, artifacts, usage and append-only audit routes to repositories. Remove global db/add/remove/save from production request handling.
- Build explicit read-only JSON export + transactional import with counts/checksums, ID preservation, encrypted-secret/key handling and object-file reconciliation. Rehearse restart, rollback and restore.
- Add pagination/client history navigation, bounded message context and consistent service/RBAC boundaries. Add production startup success tests only after this is real.

## Phase 2 — AI core
Reuse current adapters behind generate/stream/countTokens/capabilities contracts. Provider errors, usage and cancellation normalize at one Gateway. Add retry only before externally visible output and only when safe; never silently substitute deterministic mock/native-direct responses. Add model capability constraints, timeouts, health/fallback, provider token usage and pricing version ledger. Implement native tool-call frames/results for supported providers, schema validation and bounded loop.

## Phase 3 — Agents
Persist objective/structured plan/steps and state transitions; high-level status only. Tool gateway rechecks actor/workspace and tool permissions on every call; approval binds immutable arguments and actor. Max steps/runtime/timeouts, retries, cancellation, verification and resumability. Integration tests including malicious observations and cross-workspace inputs.

## Phase 4 — RAG
Quarantined object upload + transactional outbox dispatch to BullMQ; scan/parse/OCR/chunk/embed/index in worker. pgvector dimension/model/version schema; tenant/file authorization on retrieval; bounded results, source/page/chunk citations. Test failure recovery, duplicates, malicious archives and citation grounding.

## Phase 5 — Memory
Conversation/user/workspace scope, opt-out and deletion, relevance limits, retention and sensitive-data policy. Semantic embeddings with independent permissions; never inject all records.

## Phase 6 — Analyst
LLM selects a validated allowlisted analysis plan, deterministic engine computes all numbers. Preserve original/cleaned dataset/version provenance. Validate charts/dashboard operations and explanation against executed results; evaluate numerical accuracy.

## Phase 7 — Safe execution
Dedicated sandbox service with non-root container/microVM isolation, no production secrets, no network by default, read-only base and ephemeral mounts, CPU/RAM/pid/output/time limits. SQL uses restricted read-only roles and bounded statements, not arbitrary production credentials. Approval/immutable hash and audit evidence.

## Phase 8 — Production
Actual worker handlers and cancellation/dead-letter/idempotency; necessary metrics/traces, distributed rate limiting, security/Playwright/load tests, real-provider evaluations, clean deployment and restore rehearsal. Certify only tested capabilities. Remaining security blockers must be explicit.


## Historical checkpoint 4 / acceptance gate

Implemented follow-up: durable tombstone/outbox cleanup, restricted admin retry, race-safe RAG publication/resource leases, correct worker permanent/transient/cancelled/interrupted state accounting, side-effect no-replay policy, accurate Delete confirmations/status, and safe startup/pool limits. Unit/local-browser gates pass. Do not advance release approval: real-service revalidation and fresh installation are blocked by missing test executables/cache and unavailable registry DNS. Restore test environment first, rerun all integration/PostgreSQL browser gates, then complete live provider/semantic/sandbox/deployment/security/load verification. See UPGRADE_REPORT.md for authoritative phase completion/remaining gaps rather than this historical initial backlog.


## Historical checkpoint 7

**339 Linux unit tests passed**, zero failed/skipped; syntax and one local browser journey passed. Runtime integration failed setup **DATABASE_UNAVAILABLE**; no substantive real-service assertions executed. A separate fresh offline installation failed **ENOTCACHED**. Native Windows, live providers/embeddings, secure Python and public deployment are not certified. Dependencies and migrations 001–007 are unchanged; the original analyst engine is byte-identical.

Implemented in the PostgreSQL service-backed runtime:
- Bounded workspace/provider/model/config-scoped Ollama `/api/show` metadata discovery; context bounds respect both operator configuration and reported model limits. Tool support is no longer assumed. Metadata failure is explicitly unverified/text-only; user cancellation is preserved. Discovered embedding-only models cannot be used for chat. Reported metadata is not a live behavioral guarantee or universal catalog.
- Chat keeps text generation available when native tools are unsupported and emits a safe high-level status. Actual unsupported native-tool requests fail clearly. Fallback models undergo capability checks. Input tool schemas now count toward estimated context and missing-provider-token usage; estimates remain estimates, not exact tokenizers.
- `list_files`: READ, workspace-scoped, soft-deleted rows excluded, stable bounded pagination; SQL selects only metadata, not extracted documents, object paths or credentials.
- `analyze_data`: READ plus fresh analyst permissions, ready tenant-scoped files, strict allowlisted deterministic plan and typed finite output. Existing general agents can bind discovered file IDs to this tool using earlier-step references; no generated code/LLM arithmetic and no dashboard mutation.
- Actual source hashes/filters/columns/operations; row versus valid-value count modes; Pearson paired-observation count/minimum and population-z-score threshold metadata; explicit grouped/outlier output truncation. More than 50,000 parsed rows, unparsed data, duplicate tool file IDs and nonfinite intermediate statistics fail rather than publishing misleading partial/zero/nonfinite totals. This is bounded Number arithmetic, not arbitrary precision or universal statistical correctness.

Added real-service HTTP/tool-audit/chat-round/agent-binding assertions and an explicitly labelled model protocol fixture. They did **not** execute because the database setup failed; they are not passes or live AI evidence. The new deterministic tools and metadata discovery are not retrofitted into the preserved legacy JSON demo. Full production use still requires configured external infrastructure; Windows local demo remains available without Ubuntu/Docker on the user's PC.


## Current checkpoint 8 — data correctness and chart rendering

**374 Linux unit cases passed**, zero failed/skipped; syntax passed; **2 local browser journeys passed**. Real runtime failed setup DATABASE_UNAVAILABLE; fresh separate offline npm ci failed ENOTCACHED. No substantive PostgreSQL/Redis/S3 assertions executed this checkpoint. Native Windows, live AI, isolated Python and public deployment remain uncertified.

- Shared bounded dataset parser replaces only the old line-splitting delegates in the existing deterministic engine. Quoted newlines, escaped quotes, CRLF/BOM, single-column CSV and inferred delimiters preserve logical rows. Malformed quoting/row widths, duplicate/unsafe/oversized headers, null bytes, invalid UTF-8, excessive individual/combined rows/columns and duplicate selected IDs fail rather than silently changing data. Flat JSON records are supported; nested valid JSON can still be stored for RAG, but requires explicit flattening for analysis.
- XLSX keeps negative numeric cells and multiline values, merges worksheets with identical headers without duplicate header rows, and records worksheet boundaries/row counts and cached-formula provenance. Incompatible sheet schemas and missing cached formula results fail with actionable errors. Exact extraction bounds no longer falsely report truncation; exceeded bounds fail before ready state. Formula results are **cached, not recalculated or freshness-verified**. Formula-like text remains neutralized.
- Signed bar/line/area/horizontal-bar geometry replaces absolute-value plotting. Scatter carries actual X coordinates and explicit first-valid-pair sampling. Missing values create gaps, not invented zeroes. Dates use actual elapsed spacing when ISO dates are supplied; categorical positions are labelled accordingly. Pie refuses incomplete/negative/mean series rather than inventing shares. Single-series stacks/heatmaps are explicitly labelled fallbacks, not fabricated multidimensional plots. Old scatter records without X values require regeneration. Display truncation is visible and rendering does not mutate chart types.
- Explicit percentage strings are fractions (20% → 0.2), avoiding hundred-fold display errors. Constant-axis correlation is undefined instead of falsely reported as zero. PostgreSQL BYTEA file hashes normalize to genuine 64-character hexadecimal provenance; malformed hashes are not invented.
- Safe dataset error codes propagate through the real parser subprocess; failed demo extraction is no longer marked ready. Shared parsing/chart fixes apply to the local demo as well as the PostgreSQL path. New general-agent tools/capability discovery still require the service-backed runtime.

The engine is **not byte-identical in checkpoint 8**: intentionally changed numeric percent interpretation, parser delegates, undefined correlation and scatter data/sampling only. Unrelated engine lines are unchanged versus checkpoint 7; the exact patch is `docs/engineering/ANALYST_ENGINE_PATCH.diff`. The numerical engine remains deterministic and was not replaced with an LLM.

New actual parser-subprocess tests and a full local upload/dashboard browser journey pass. Real queued CSV/XLSX/provenance/permanent-failure integration assertions were added but did not execute. A 10,000-row synthetic CPU microbenchmark runs the real parser/sum/dashboard/renderer and independently checks the sum; it is not a database/model/queue/load or user-PC performance certification. See `reports/upgrade/checkpoint8-analyst-benchmark.json` and `npm run benchmark:analyst`.

Limits: bounded JavaScript Number arithmetic, default 50,000 data rows / 100 distinct columns, XLSX 20 worksheets / 500,000 extracted characters; no arbitrary precision, locale-general numeric parsing, JSON duplicate-key/lossless-number proof, automatic nested flattening, full time-series/stacked/matrix semantics, automatic old-chart repair, formula recalculation, semantic classification or causality certification. These remain explicit review/evaluation work, alongside operational release gates. Migrations/dependency versions are unchanged; one optional benchmark script was added.
