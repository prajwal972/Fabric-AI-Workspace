# Fabric architecture — production-runtime upgrade

## Two explicit runtime modes

- `src/start.mjs` chooses the PostgreSQL application when `DATABASE_URL` is present.
- Without it, development/testing can use the original single-process local/demo server.
- Production/staging cannot fall back to `flux.json`. Missing service configuration or migrations stops startup.
- The legacy UI and deterministic analyst engine are preserved, not rebuilt.

## Canonical production path

Frontend → HTTP API → session/CSRF/RBAC → services → scoped repositories → PostgreSQL.

Chat → AI Gateway → normalized provider adapter → bounded tool rounds → Tool Gateway.

Agent → durable state machine → validated public plan → typed earlier-result dependencies → authorized tool executions → observations → bounded replacement of the unexecuted tail when READ operations fail → verification.

Upload → encrypted S3 → PostgreSQL file/job/outbox transaction → BullMQ/Redis → bounded parser subprocess → embedding adapter → pgvector → authorized retrieval with file/chunk/page references.

Memory is explicitly saved, scoped to user/conversation/workspace, opt-out capable, and retrieved in bounded semantic queries. Saves atomically create real embedding jobs; authorized imported/pending-memory backfill runs in bounded batches. Sensitive imported facts are excluded from embedding, and deletion/opt-out is checked again before vector writes. No automatic indiscriminate harvesting.

Analysis → validated LLM plan when a real provider is configured → deterministic analytics → provenance → optional explanation checked against computed numeric facts.

Python → dedicated executor Docker client → digest-pinned container, stdin-only code transfer, no host mounts, network disabled, read-only root, non-root UID, dropped capabilities, CPU/memory/PID/time/output limits. It is disabled without explicit isolated-host configuration.

SQL → separately configured analytics database → bound workspace check → non-privileged role → conservative analytics dialect and pg_catalog-only function resolution → read-only transaction, actual backend cancellation, statement timeout and bounded result set. It never uses the application's production pool.

## Responsibilities

| Directory | Responsibility |
|---|---|
| `application/` | Runtime composition, validated configuration, shared HTTP/security/lifecycle boundary |
| `routes/`, `server/http.mjs` | Feature HTTP controllers, explicit public/authenticated dispatch and bounded transport helpers |
| `auth/`, `security/` | Sessions, password/challenge policies, RBAC, network and execution boundaries |
| `repositories/`, `database/` | Scoped CRUD, transactions, migrations, legacy import |
| `services/` | Chat, deterministic analyst orchestration, providers, artifacts, research, connectors, voice, notifications |
| `ai/` | Provider protocols, routing, bounded tool rounds, usage accounting |
| `agents/`, `tools/` | Durable agent state and independent tool authorization/approvals |
| `files/`, `rag/`, `memory/` | Parsing, indexing, source retrieval, memory policies |
| `workers/` | One canonical durable job implementation and outbox dispatcher |
| `observability/` | Redacted structured logs and bounded-label Prometheus metrics |

The previous 1,214-line production server has been reduced to about 220 lines, with 19 authenticated feature controllers and explicit public authentication/OAuth landing handlers. Authentication, CSRF, RBAC, rate limits, error normalization and streaming cancellation remain in the shared boundary. Shared demo/production provider consolidation is not complete. React/Next migration was deliberately avoided to preserve working behavior.

## Failure semantics

- Approval is scoped to user, workspace, run, tool and canonical arguments; expiration and single consumption are enforced in SQL. Waiting for approval does not spend a tool execution, approvals are not reused for later actions, and active runtime accumulates across resumes.
- Interrupted agent executions are not blindly replayed. A lost process lease marks the run interrupted to avoid repeating unknown-outcome writes.
- Provider retries/fallback occur before output/tool effects; partial streams fail rather than silently completing.
- Jobs are idempotent by actor/type/workspace/key/input; terminal failure is persisted as dead-letter state. Producers have bounded command waits; worker connections retain BullMQ-required retry behavior.
- A missing embedding provider yields an honest `blocked_requires_embedding_provider` file state, not fake indexing.
- Unpriced model requests are recorded as unpriced; displayed zero known cost is not a claim that the provider was free.

## Message history and operational consistency

Message history uses scoped keyset pages. Active model context excludes superseded replies before applying the context limit. Successful regeneration transactionally archives prior complete replies and links the new reply to its user turn/previous response; a failed attempt leaves the prior completed reply intact. Turn ordering compares native PostgreSQL timestamps rather than millisecond-truncated JavaScript dates. Migration 006 indexes current context and latest-user-turn queries.

Backups use real pg_dump/pg_restore with environment-based credentials, private temporary files, authenticated AES-GCM publication and transactional restore. These are database backups, not a replacement for object-store protection. Artifact persistence compensates storage writes on metadata failure; crash reconciliation remains an operational gap.


## Durable deletion and interrupted jobs (checkpoint 4)

Logical deletion → one PostgreSQL transaction (tombstone/chunks/cancellation/audit/job/outbox) → bounded BullMQ worker → tombstone-checked idempotent S3 deletion → completed job. File-producing workers and deletion share a bounded per-resource session lease, and RAG publication checks the live file under row lock. Cleanup can run after membership revocation only for existing scoped tombstones. Administrator retries are restricted to failed cleanup jobs.

Worker authorization/handler errors are recorded inside the same failure-accounting path as execution. Dispatch uses persisted retry budgets. Non-idempotent notification/report effects and stalled unknown outcomes are not automatically replayed. Deferred-failure state recording is best effort during a database outage; no exactly-once claim. Creation crash windows and historical-object reconciliation remain open. These changes have unit/local-browser coverage; real-service revalidation is blocked at checkpoint 4.


## Checkpoint 5: admission and operational readiness

Production AIGateway → AIRequestPolicy → transactional AIQuotaRepository → provider adapter. Fresh membership/email/provider checks precede provider attempts; user/workspace UTC counters are normalized in migration 007. Request/output-token limits are not monetary caps. Retry/fallback attempts retain their own provider/model/usage status. Parsed files can remain ready with indexing blocked by policy, and retry can actually index a previously parsed file when permitted.

Production worker → bounded producer Redis commands → random expiring heartbeat registered only after BullMQ readiness. API `/api/ready` combines infrastructure checks with a Redis-server-time fresh-worker check; `/api/live` remains independent. Expiry bounds stale process visibility; it does not prove any particular handler completed. Windows worker entry uses decoded module URL/drive-path matching instead of POSIX-only URL.pathname comparison. Native Windows backup publication uses protected verified DACLs; Unix private permissions remain enforced.


## Checkpoint 6: grounding and transactional execution

Chat → fresh membership → bounded evidence registry → actual supplied excerpt IDs/hash/provenance → gateway/tools → shared source IDs → reference-ID validation → persisted reply/public metadata (no full source text). Memory/connector snippets share the untrusted-context budget. Numeric identity checking only uses computed facts/counts/labels, not file/column/timestamp digits; semantic correctness remains an evaluated-model gate.

Agent run + job + outbox, and approval decision + resume job + outbox, now commit in one repository transaction. Service/tool boundaries refresh membership/role and bind approvals to the currently waiting action. Existing safe-execution boundaries are unchanged.


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


## Checkpoint 9 — genuine storage verification and unambiguous numeric inputs

**392 Linux unit cases passed**, zero failed/skipped; syntax passed; **3 local browser journeys passed**. **1 genuine encrypted S3-compatible integration passed** against SeaweedFS, not a storage mock. Complete PostgreSQL/Redis/worker runtime still fails setup DATABASE_UNAVAILABLE. Separate fresh offline npm ci fails ENOTCACHED. Windows/live AI/isolated Python/public deployment remain uncertified.

BEFORE → AFTER:
- Native JSON.parse silently kept the last duplicate key → bounded preflight rejects duplicate decoded keys, including escaped aliases and nested duplicates, before parsing. JSON and JSONL share grammar/2 MB/depth 64/token limits. Known safe error codes survive the actual parser subprocess.
- JSON rounded unsafe integers/overprecise literals → analyst JSON rejects unsafe integers, nonfinite values, underflow and decimal spellings changed by Number round-trip. Ordinary decimal inputs remain accepted; this is an input policy, **not exact decimal arithmetic**.
- Service/dashboard numeric parsing disagreed, accepted invalid comma grouping or omitted scientific notation → shared numeric conversion supports explicit scientific/accounting/currency/percent syntax and Western/Indian comma grouping. Malformed inputs are not numeric evidence. Selected deterministic operations reject precision/range loss; dashboard inference treats unsupported numeric strings as nonnumeric. Identifier strings retain their original spelling. Aggregation remains bounded JavaScript Number arithmetic, not arbitrary precision; every unsafe aggregate/intermediate and financial-unit semantic is not certified.
- Currency display discarded cents ($124.75 became $125) → at most two fractional currency digits, retaining existing integer display. Currency/unit inference is still heuristic; sub-cent rounding and arbitrary precision are not solved.
- Object storage had no current-source integration pass → real encrypted put/get/metadata, key namespace separation, cancellation, list/delete and new-bucket cleanup verified. The disposable test service uses 64 MB volumes rather than 30 GB defaults, avoiding test-machine capacity failure. Provider-reported AES256 headers were checked; disk ciphertext, IAM/application authorization, R2/KMS, production TLS, recovery and durability are **not** certified by this test.

Generic nested JSON remains available as unchanged knowledge text; strict numeric conversion is applied when analyzing it, not silently rewriting its literal contents. No generated formulas/code were executed. UI identity, unrelated deterministic engine lines, migrations 001–007 and dependency versions were preserved. Exact checkpoint-8→9 engine patch: `docs/engineering/ANALYST_ENGINE_CHECKPOINT9.diff`.

The new local browser journey uploads ambiguous JSON/JSONL and verifies failed status, explicitly deselects failed sources, then uploads/analyzes valid JSON. Existing chat/settings/tools/deletion and signed/scatter dashboard journeys also pass. Existing tests were not disabled; new failures were resolved, including a selection-rerender wait and actual lost-cents display bug. New numeric/count regressions protect valid-value versus row-count semantics.

A fresh current-source synthetic 10,000-row CPU benchmark independently checks the sum; see `reports/upgrade/checkpoint9-analyst-benchmark.json`. It is not real-service/model/load or user-device capacity certification.

Included CI now runs `npm run test:storage` with explicit disposable `FABRIC_TEST_S3_ENDPOINT` matching `S3_ENDPOINT`. No new production variable/dependency is required. CI has not been remotely executed; a repository and actual service/executor/model environments are still needed. No public deployment or all-phases-complete claim is made.


## Checkpoint 10 — memory permissions, expiry and review controls

Current source: **419 Linux unit tests passed**, zero failed/skipped; syntax passed; **3 existing local browser journeys passed**; **1 real encrypted S3-compatible integration passed**. Expanded PostgreSQL runtime fails setup DATABASE_UNAVAILABLE; separate fresh offline npm ci fails ENOTCACHED. New production memory UI/SQL/concurrency assertions did **not** execute. Unit repository/vector doubles are explicitly labelled, not fake persistence or live semantic proof.

BEFORE → AFTER:
- Cached roles could govern memory operations → fresh active-user/workspace/membership checks in read/write services, current roles on every mutation, and transaction-held share locks for memory insert/delete/index. Settings mutations also use conditional current-role SQL. Missing actors/memberships fail closed.
- Opt-out/revocation could occur during embedding → fresh checks after embedding plus final retrieval SQL opt-out/membership/expiry guards. Cancellation is preserved before/after embedding and after the final read. No universal instantaneous-revocation guarantee across external providers is claimed.
- Every nearest memory could enter context regardless of distance → configurable cosine-distance cutoff, matching embedding identity, active conversation checks and at most five returned records. Default 0.35 is an operator starting policy, not reviewed semantic relevance; calibrate with the chosen embedding model.
- Fixed latest 100 records with no review controls → strict bounded API paging (limit 1–100; offset 0–100,000), stable ordering, nextOffset and expiry metadata. UI uses 50-record pages, previous/next and an explicit expired-memory review filter.
- expires_at existed but users could not set it → optional validated expiry within 365 days, UI local-date input converted to ISO time, active-list/retrieval/indexing expiry exclusion. Expiry does not physically erase retained content/vectors; storage retention is still an operational/privacy policy gap.
- Read-only members could not control personal opt-out → PATCH /api/memory permits current read membership for personal settings only. Workspace changes remain current-admin-only; POST/delete/reindex remain write-permission operations. Unit tests exercise this boundary.
- Soft deletion left vectors active on disk → deletion now clears embedding/model fields with a soft-delete marker and audit in one transaction. Soft-deleted content is still retained; this is **not physical erasure** or backup purge.
- Memory creation/settings audit not atomic with mutations → content-free audit records and indexing job are committed in the same repository transaction. Actual PostgreSQL lock/rollback behavior awaits real-service execution.

Optional production setting: `FABRIC_MEMORY_MAX_DISTANCE=0.35`, bounded 0..2, validated before infrastructure allocation and passed explicitly to MemoryService. No new dependencies or migrations; 001–007 unchanged. Existing deterministic engine is byte-identical to checkpoint 9, and UI identity is retained with targeted memory controls only. These changes apply to the service-backed runtime, not the preserved local JSON demo.

New tests include 22 policy cases, 4 route/config cases and 1 RBAC case (27 added). Real runtime assertions cover expiry, paged review, stale admin roles, opt-out during embedding and vector removal; real PostgreSQL browser assertions cover the new controls. They remain **unexecuted** because setup failed. The three passing local journeys do not certify the production memory UI.

GitHub is not required to continue editing or run the tests; no repository was created or uploaded. Current environment still lacks PostgreSQL/Redis executables and registry connectivity. All eight phases are not accepted: fresh installation, full service-backed/Windows/live-model/embedding/sandbox/security/load/recovery/public-deployment gates remain open. No secrets or personal data are bundled.
