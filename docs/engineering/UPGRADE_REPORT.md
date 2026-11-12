# Fabric v1.10.4 — engineering upgrade report

## Outcome and phase status

The supplied application was upgraded in place, not rebuilt. The original vanilla JavaScript/glass UI, deterministic analyst calculations, local/demo mode and existing authentication/security behavior were retained. A real PostgreSQL runtime now handles production application state, with Redis/BullMQ workers, encrypted S3 storage and pgvector retrieval.

**Checkpoint 10 is partially verified, not completion of all eight phases or production approval.** Current source passes 419 Linux unit cases, syntax, three local browser journeys and one genuine S3 integration. Expanded memory/PostgreSQL/Redis runtime and fresh install remain blocked; Windows/live models/secure Python/deployment are open. Memory controls are implemented and unit-tested, not real-database/production-UI certified. Deterministic engine unchanged from checkpoint 9; dependency versions/migrations 001–007 unchanged.

| Phase | Core implementation (current or earlier evidence) | Still open |
|---|---|---|
| 1 Foundation | Migrated PostgreSQL routes, repositories/services, atomic migrations/import, error contract, regression tests | Migration 007 and latest real-service revalidation; target roles/storage/recovery verification |
| 2 AI core | Normalized adapters, streaming, bounded retries/fallback/tool rounds, durable usage, bounded Ollama model metadata discovery | Live all-provider tests, comprehensive model capability/tokenizer catalog |
| 3 Agents | Durable plan/execute/observe/verify state, approvals, bounds, cancellation | Advanced parallel graph planning, live planner quality and broader failure-injection evaluation |
| 4 RAG | Actual storage/jobs/parser/chunking/vector SQL/source metadata and scoped retrieval | Live embedding quality/citation entailment, all-format/malicious-document matrix |
| 5 Memory | Explicit scoped memory, opt-out/delete/list, bounded semantic queries | Run authorized imported-memory backfill with chosen model; reviewed live relevance evaluation |
| 6 Analyst | Validated LLM plans, preserved deterministic engine, provenance/charts/dashboard path, authorized general-agent deterministic tool | Broader reviewed planner/explanation quality tests |
| 7 Safe execution | Dedicated-container Python gateway and separate read-only SQL gateway; fail-closed tests | Successful isolated Python execution/resource/security tests; target SQL deployment grants review |
| 8 Production | Worker/outbox lifecycle, logs/metrics, browser suites, CI/compose/runbooks; new durable deletion and interruption handling unit-tested | Latest worker/heartbeat/recovery tests, deployment/security/load/restore/Windows CI verification |

## 1. Problems found

The original audit is `AUDIT-v1.10.4.md`; it distinguishes observed code from assumptions. Important findings:

- PostgreSQL existed as schema/health infrastructure, while real routes used `flux.json`.
- One large server combined persistence, routing, providers, agents and parsing.
- Existing provider streams and deterministic analytics worked and were valuable.
- Agents used a fixed/simple plan; tool authorization was not a durable independent boundary.
- Uploaded text was appended to prompts instead of indexed/retrieved RAG.
- Queue/object-storage modules existed but did not power normal file processing.
- Unfinished workflows were unreachable behind an unconditional 410.
- Tests covered important local behavior but lacked actual PostgreSQL/Redis/S3/browser certification.

The baseline actually ran: **96 tests passed**. Password hashing, CSRF, encryption, RBAC, file validation, observability and analyst provenance were preserved, not discarded.

## 2. Problems fixed — BEFORE → AFTER

| Before | After |
|---|---|
| Production routes manipulate a JSON workspace | Production routes use scoped PostgreSQL repositories; staging/production refuse missing DB configuration |
| Database scripts can leave migration/ledger disagreement | Transactional, checksum-verified migrations with advisory locking and tested rollback/reapply |
| Local file bytes and in-process asynchronous extraction | Encrypted S3 bytes, atomic file/job/outbox records, actual BullMQ worker and bounded parser subprocess |
| Independent provider invocation sites | Production AI Gateway with normalized adapters, streaming/tool rounds and usage ledger |
| Tools in prompt/simple deterministic agent | Validated real tool protocol, independent authorization, durable approved executions and model-planned state machine |
| Whole attached text injected into context | Bounded chunks, real embedding adapter, pgvector index/retrieval, file/page/chunk references |
| Placeholder memory collection | Explicit scoped memory, disable/delete controls and bounded semantic retrieval |
| Deterministic intent routing only | Structured LLM analysis plan feeding the existing deterministic engine, not replacing it |
| Unreachable unfinished workflow runner | Removed after reference checks; compatibility 410 retained; historical data archived on import |
| Inconsistent exposed upstream errors | Safe error codes/messages/request IDs with internal structured logging |
| Potential future host code execution | Disabled-by-default dedicated-container gateway; limits are not weakened when the host cannot enforce them |
| Decimal calculator drops leading dot | `.5 + .25` correctly returns `0.75`; malformed decimal/grammar inputs fail with a safe validation error |

## 3. Files changed

`FILES_CHANGED.json` is the complete added/modified/removed inventory against the supplied ZIP. It includes source, tests, migrations, deployment and documentation, excluding dependencies/generated browser output. It is not a guessed list.

Key locations:

- Runtime: `src/start.mjs`, `src/application/{config,context,server}.mjs`.
- Data: `src/database/`, `src/repositories/`, migrations 002–007, migration/import scripts.
- AI/execution: `src/ai/`, `src/agents/`, `src/tools/`, `src/security/`.
- Services: chat, providers, analyst, artifacts, research, connectors, voice, notifications.
- Data pipelines: `src/files/`, `src/rag/`, `src/memory/`, `src/workers/`.
- UI: `public/app.js` and existing styles; no React/Next wholesale migration.
- Tests: `test/`, `integration/`, both Playwright configurations, fixed evaluation corpus.
- Operations: Dockerfile, production compose, CI, `.env.example`, canonical architecture/testing/deployment/limitations documents.

**Through checkpoint 7, the original engine was byte-identical. Checkpoint 8 intentionally applies only audited parser/percentage/scatter/undefined-correlation fixes.** Unrelated engine lines remain unchanged; the exact patch is included. Dependencies are not bundled; install using the lockfile.

## 4. New architecture

Frontend → API → sessions/CSRF/RBAC → services → tenant-scoped repositories → PostgreSQL.

Chat → AI Gateway → provider adapters → validated Tool Gateway → observation → next model turn/final response.

Agent → persisted public plan → bounded execution → observations/repair → verification → terminal status.

File → encrypted S3 → PostgreSQL transactional outbox → Redis/BullMQ → parser → chunks/embeddings → pgvector → scoped cited retrieval.

The legacy runtime remains available for development/demo without `DATABASE_URL`. Production/staging cannot select it. Feature-route extraction is now implemented: the production server shrank from 1,214 to about 220 lines, with 19 feature controllers and explicit public handlers. Demo/production provider implementations still need further consolidation; that remains an explicit maintenance gap.

## 5. Database changes

Migrations 001–006 are unchanged by checkpoint 5; migration 007 adds normalized user/workspace daily AI admission counters and indexes. These counters update atomically and are separate from the usage ledger. Migration 007 has unit/SQL-code review but no real-service execution this checkpoint. Migration 001 is retained. New migrations (002–007) add conversation/message tenant integrity; agents/runs/tool records/approvals; memory/artifact/auth-challenge/outbox/analyst data; usage extensions; fixed 768-dimensional vector indexes; import ledger and cross-workspace foreign keys.

Users, memberships, sessions, conversations/messages, files, providers, memories, agent/tool state, usage, audit, analyst state, artifacts and durable job metadata use PostgreSQL. Redis carries job execution, not authoritative application records. Object bytes live in encrypted S3.

The migration runner uses transactions, checksums and advisory locks. Startup checks applied migrations and rejects unsafe production superuser/BYPASSRLS credentials. Scoped repositories use bounded queries. Real rollback/reapply and tenant-boundary tests passed, including migration 006 context/latest-user indexes.

The dry-run-first importer targets a fresh database, uploads original bytes, re-encrypts credentials and preserves IDs/content/provenance. Old sessions are revoked. Historical workflows/runs are encrypted archival records, not resumable new runs. Source data is not modified. Imported memories can now be indexed using authorized bounded background backfill; operators/users must run it with the chosen model.

## 6. AI Gateway changes

Production adapters cover OpenAI Chat/Responses, Anthropic, Ollama, Fabric Native and explicitly test-only mock behavior. Normalized interfaces expose generation/streaming, capabilities and counting. The gateway enforces deadlines/context/output/step budgets, retries and fallback before visible output or tool effects, and normalized safe failures.

Usage is persisted per admitted provider attempt (including failed retry/fallback attempts) and embeddings with actor/workspace/provider/model/request/tokens/cost/latency. Missing token counts are marked estimates; unknown prices are marked unpriced, not advertised as free. Reviewed pricing is operator configuration.

Protocol fixtures test adapter/tool-stream wiring. **They do not prove live OpenAI/Anthropic/Ollama/Native access or quality.** Automatic complete per-model capability catalogs/tokenizers remain incomplete.

## 7. Agent changes

The planner creates a validated structured plan. State, observations, tool execution records and terminal results are durable. Tool Gateway independently checks current membership/role, input/output schemas, bounds and required approval.

Approval is bound to the user/workspace/run/tool/exact canonical arguments, expires and is consumed once. Rejection cancels a waiting run. Runtime/step/time limits and cancellation are enforced. Public progress shows safe status, not private chain-of-thought.

Tail replanning is bounded. Failed writes are not automatically retried. Interrupted unknown-outcome executions are not silently replayed. Typed earlier-step result references and bounded string composition are now implemented, together with bounded replacement of the unexecuted plan tail after READ failure. Completed actions are not replayed. Advanced parallel graph execution and formal verification remain incomplete. Active runtime accumulates across approval resumes; waiting for approval does not consume the tool-execution budget and later actions need their own approvals. Explicit approval controls exist; automatic continuation of the exact interrupted chat stream remains incomplete.

## 8. RAG changes

Workers process actual uploaded bytes and preserve source metadata. Parsers run outside the API with timeout/output/process/resource bounds. PDF/DOCX/text/structured/OCR paths and original auxiliary format helpers remain supported where runtime binaries are installed.

Chunks and embeddings use real adapter calls and PostgreSQL+pgvector. Retrieval is workspace-scoped, bounded and returns source file/chunk/page references. Vectors include embedding identity; changing model/provider requires reindexing. The schema currently requires 768 dimensions.

Missing embeddings yield `blocked_requires_embedding_provider`, not fake indexing. Oversized structured datasets fail rather than silently yielding partial analytics. Real-service tests exercise vector SQL with explicitly labelled vector fixtures; live semantic/citation accuracy remains a release gate.

## 9. Memory changes

Conversation context is bounded; long-term user/conversation/workspace memories are explicit saves with sensitive-pattern checks, controls and scoped retrieval. Users can list/delete/disable memories. No indiscriminate automatic harvesting is implemented. Imported memories can use the authorized `/api/memory/reindex` background job/UI control. Expiry, ownership, deletion and fresh opt-out are enforced; sensitive imported text is skipped before provider transmission.

## 10. Security changes

Preserved Argon2id/legacy-password upgrade, encrypted credentials, secure cookie sessions, CSRF/origin checks and default-deny RBAC. Added durable hashed sessions/challenges, revocation/device controls and fresh tool-level authorization.

Public network requests resolve/check destinations and pin connections; unsafe/private destinations and redirects are rejected. Private model origins require operator approval, not workspace-admin expansion. Upload validation, encrypted storage and required production ClamAV fail closed.

Python code is transferred through stdin to a digest-pinned, non-root, network-disabled, read-only container with no host bind mounts, dropped capabilities and CPU/RAM/PID/time/output limits. The gateway requires a dedicated executor configuration. **This computer cannot enforce the necessary cgroup limits, so successful sandbox execution is not certified.**

SQL uses separate explicitly workspace-bound analytics credentials, read-only transactions, restricted roles and bounded queries. It does not use the production pool. A real separate PostgreSQL analytics database and restricted login have now passed deterministic SELECT, permissions, function-shadow rejection, cancellation and statement-deadline tests. Target deployment grants still require review. The SQL dialect is deliberately conservative, not arbitrary SQL.

Password recovery/email challenge architecture and UI are implemented; live SMTP, OAuth callbacks and MFA enrollment are not completed/certified. This is not a penetration test.

## 11. Testing results

### Historical checkpoint 6

Linux / Node 24.14.1, with existing installed dependencies:

| Gate | Observed result |
|---|---|
| Syntax checks | Passed |
| `npm test` | **320 passed, 0 failed, 0 skipped**; 54 new unit cases versus checkpoint 5 |
| Local Playwright journey | **1 passed**; original auth/chat/analyst/settings/tools/deletion |
| Fresh separate offline `npm ci` | **Failed ENOTCACHED**; missing registry tarballs |
| Expanded real-service runtime | **0 passed, 1 failed at setup: DATABASE_UNAVAILABLE**; new citation/tool-ID/atomic-scheduling assertions did not execute |
| Latest complete PostgreSQL/Redis/S3/browser gates | Not passed; services unavailable |
| Native Windows / remote CI / live providers / isolated Python / public deployment | Not certified |

New tests cover service-level fresh permissions, chat lease cleanup, bounded evidence and provenance, source-ID validation outside Markdown code, safe source links, atomic scheduling/approval via labelled transaction doubles, strict tool inputs, numerical explanation identity/format validation, optional explanation failures, and non-finite structured-analysis result rejection. Doubles/protocol fixtures are not evidence of a real database, live model, malware scanner or isolated executor.

The real runtime suite includes actual PostgreSQL rollback under explicit outbox failure injection, authoritative IDs across actual knowledge/read-file tool rounds and persisted source metadata privacy. It cannot currently reach the database. No failing test was disabled or reported as passing/skipped.

All historical results remain labelled in their original checkpoint sections/logs. Existing service data was not deleted/reinitialized. Current failure logs, syntax/unit/browser logs and the verification manifest are packaged.

### Historical checkpoint 3 (unchanged evidence, not current-source certification)

- Unit tests: 202 passed, 0 failed/skipped.
- Real-service integration: PostgreSQL 1, runtime 14, legacy import 1, isolated SQL 6, Redis failure 1, encrypted backup/restore 4 — **27 total**, all passed.
- Browser: PostgreSQL 2 scenarios and preserved local mode 1 scenario — **3 total**, all passed.
- Online clean install and separate fresh offline install passed earlier with the unchanged dependency lockfile.
- Last successful npm audit reported 0 vulnerabilities; later DNS-blocked rechecks are not passes.
- Production compose syntax passed; no production image build/deployment certification.

Historical logs are retained with a checkpoint-3 prefix. Checkpoint-5 unit/browser logs and failed fresh-install/integration setup logs are separately labelled. No failing tests were disabled and no missing external gate is counted as passing or skipped.

A 50-request local **liveness-only** sample measured p50 2.11 ms / p95 21.28 ms / max 123.52 ms. These are not AI first-token timings or capacity/load certification.

Runtime provider answers/plans/vectors use an explicitly labelled HTTP protocol fixture. PostgreSQL, Redis, object storage and processing workers are real. Component provider tests use protocol fixtures/mocks; no live provider success is inferred. Test totals do not count missing external gates as passing/skipped tests.

## 12. Remaining limitations

See `../KNOWN_LIMITATIONS.md` for the full release-blocking and implementation list. In particular:

- Dedicated full-cgroup Python executor is not available/tested here. SQL isolation is now verified using a disposable restricted database; target production analytics grants still need review.
- Live all-provider tests, semantic retrieval/citation entailment and reviewed planner/safety evaluations remain open.
- Actual production image build/start, HTTPS ingress, least-privilege grants, scanner updates, backup restore and deployment secrets need target verification.
- Full security attack matrix, malicious-file suite, realistic load/failure injection and remote CI have not passed here.
- Provider deduplication, advanced parallel planning, older-message branching and choosing a prior response as the canonical version remain engineering work. Route decomposition and bounded history/version viewing are implemented. Imported-memory backfill is implemented but must be run with the chosen embedding model.
- Actual resource-consumption sampling, tamper-resistant audit retention, enterprise SSO/MFA and multi-tenant analytics credentials remain incomplete.

No secrets, configured deployment credentials, node_modules, user data or test service state are included in the source package.

## 13. Required environment variables

Production API/worker core: `NODE_ENV=production`, HTTPS `FABRIC_PUBLIC_URL`, random `FABRIC_MASTER_KEY`, non-superuser `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, scoped `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`, `FABRIC_METRICS_TOKEN`, `FABRIC_UPLOAD_SCAN_MODE=required`.

Provision migration credentials separately (`FABRIC_MIGRATION_DATABASE_URL`). Configure reviewed provider credentials in Settings, embedding provider/model, trusted private model origins and pricing. Enforce `MAX_AGENT_STEPS`, `MAX_TOOL_EXECUTION_TIME`, `MAX_TOTAL_RUNTIME` and worker limits.

Optional integrations require their own SMTP/voice/OAuth secrets. Python needs explicit dedicated-host acknowledgement, TLS Docker endpoint and digest-pinned sandbox image. SQL needs separate read-only `FABRIC_ANALYTICS_DATABASE_URL` and `FABRIC_ANALYTICS_WORKSPACE_ID`.

Public safeguards: `FABRIC_REGISTRATION_MODE`, `FABRIC_ALLOW_CLOUD_AI`, `FABRIC_REQUIRE_EMAIL_VERIFICATION`, `FABRIC_AI_USER_DAILY_REQUESTS`, `FABRIC_AI_WORKSPACE_DAILY_REQUESTS`, `FABRIC_AI_MAX_OUTPUT_TOKENS`. Production defaults are closed registration, cloud AI disabled and verification required. Opening registration requires SMTP. Request/token bounds are not a monetary budget.

The included `.env.example` contains placeholders and the supported configuration; never commit real values. Compose also requires reviewed immutable service images and bootstrap credentials. Do not reuse placeholder keys.

## 14. Deployment instructions

Follow `../PRODUCTION_SETUP.md` rather than historical release documents.

1. Provision PostgreSQL+pgvector, Redis, encrypted private S3 and current ClamAV on private networks; configure HTTPS ingress and secret manager.
2. `npm ci`, `npm run check`, `npm test`, `npm audit --audit-level=high`.
3. Apply migrations using the migration role; grant restricted application DML/sequence/schema access and migration-ledger SELECT. Start only with safe application credentials.
4. For existing data: stop legacy writes, verify backups, dry-run the importer against a fresh migrated DB, review, then apply; keep originals and expect session revocation.
5. Start `npm start` and `npm run worker`. `/api/live` is independent; `/api/ready` additionally requires a recent worker heartbeat. Verify protected metrics and actual job completion; heartbeat alone does not prove successful processing.
6. Validate/build/start the supplied production compose on the target host. Do not expose DB/Redis/storage ports or mount the production Docker socket.
7. Run integration/browser/live-provider/security/sandbox/restore/load gates. Do not approve production until blockers are resolved.

Rollback requires an operational backup/restore plan, not just running down migrations against live data. No target production system was modified during this upgrade.

## 15. Recommended next improvements

First complete dedicated executor and deployment verification; then live provider/embedding/citation/safety gates. Continue shared provider consolidation and richer agent replanning with regression tests before adding new frameworks. Add reviewed broader E2E/security/failure-injection evaluations, restore drills and real AI latency measurements. Run the implemented imported-memory backfill and implement older-message branch/version navigation as a separately tested feature.

**Acceptance:** the core upgrade and regression-tested follow-up source are delivered, with pending integration revalidation explicitly recorded. The exhaustive master-prompt definition of done is not yet met, and this report must not be interpreted as approval for an internet-facing production launch.

## Follow-up checkpoint: execution correctness and indexing

- **Before:** repository JSON serialization followed a global property name. **After:** it follows each actual table/column type; agent objective/answer TEXT stays text while job JSONB stays JSON. New unit and real agent tests caught and verified this correction. Earlier checkpoint agent text may retain extra JSON quotation; original bytes are preserved rather than heuristically stripping legitimate user quotation.
- **Before:** plans could not use earlier typed results and READ repair only replaced one input. **After:** safe bounded references/string composition and validated replacement of the unexecuted tail; completed actions never replay.
- **Before:** approval waits used an execution count and resume approval could carry into later actions. **After:** no count is consumed by waiting and each successive write action requires its own approval. Runtime is cumulative across resumes.
- **Before:** SQL only checked cancellation before starting and accepted many side-effecting SELECT functions. **After:** conservative function/dialect policy, pg_catalog resolution, real backend cancellation, row/byte bounds and deadline failures, verified with real restricted credentials.
- **Before:** imported/pending memories had no backfill path and synchronous embedding failures could leave a saved fact behind an error response. **After:** atomic memory/job creation and authorized bounded background reindexing, with fresh opt-out and deletion checks and sensitive-text exclusion before transmission.
- **Before:** producer Redis commands could wait indefinitely. **After:** bounded command timeout/retries, verified against a real Redis connection whose proxy drops responses.

These are implemented follow-up fixes, not replacement of the preserved analyst/UI or evidence that the remaining external release gates have passed.

## Follow-up checkpoint 3: maintainability, history and recovery

- **Before:** all production feature handlers shared a 1,214-line module. **After:** 19 route/controller modules, explicit public dispatch and shared HTTP helpers; the 220-line central server retains authentication/CSRF/RBAC/rate limits/error/connection lifecycle. Existing routes and browser journeys passed after extraction. Provider-list duplicate queries were reduced to one bounded read.
- **Before:** conversation loading eagerly fetched all pages, older messages had no navigation, and regeneration produced multiple active replies. **After:** bounded list/search/message pages, explicit load-more controls, preserved drafts, transactional response version links, show/hide previous replies and active-context filtering before the limit. Microsecond ordering stays inside PostgreSQL. Migration 006 supplies corresponding indexes.
- **Before:** backup encryption failure could leave a plaintext dump, decryption could publish unauthenticated plaintext and dump credentials appeared in process arguments. **After:** unique/private dump files with failure traps, authenticated atomic publication/private permissions, environment-only credentials, confirmation and single-transaction restore. A real disposable PostgreSQL dump/encrypt/relocate/restore/tamper drill passed. This is not full object-store or target-production disaster-recovery certification.
- **Before:** oversized SQL cells crossed the wire before the byte check. **After:** server-side payload bounds, bounded standard output types and exact OID-based bigint/numeric decoding. Real oversized-cell and precision checks passed.
- **Before:** weak copied secret placeholders and an analytics URL pointing to the application database could pass configuration checks. **After:** explicit protocol/placeholder/scanning safeguards and a same-database/common-loopback-alias rejection. These checks do not prove secret entropy or resolve every DNS alias; target identity remains an operator gate.
- **Before:** streaming schema failures could appear as generic internal errors, and failed artifact metadata writes left object bytes behind. **After:** consistent safe validation errors and compensating S3 deletion with real database failure injection. Failed compensation/crash reconciliation remains documented, not silently certified.

The preserved deterministic analyst remains byte-identical to the supplied ZIP. No framework migration, wholesale UI redesign, disabled failing tests or relaxed sandbox limits were used.


## Follow-up checkpoint 4: durable deletion and worker recovery

- **Before:** soft deletion followed by best-effort S3 removal could strand bytes with no retryable record. **After:** the scoped tombstone, file-chunk removal, file-job cancellation request, cleanup job/outbox and audit are committed in one PostgreSQL transaction. Physical deletion is an idempotent worker operation, not a success claimed before S3 responds. Repeat deletion returns its existing cleanup job.
- **Before:** worker membership/handler failures happened outside failure accounting, and SQL/Redis retry budgets disagreed. **After:** authorization, handler validation and execution share consistent persisted attempts, permanent-error dead-letter handling, safe errors and cancellation states; queue dispatch uses the persisted retry limit.
- **Before:** a deleted user's file bytes could remain when cleanup lost workspace membership. **After:** only the internal tombstone-checked `storage-delete` capability can continue maintenance after membership revocation. Ordinary jobs still require fresh membership and fail closed. A live or foreign-scoped row cannot authorize S3 deletion.
- **Before:** background retry/stall recovery could repeat external notification/report effects of unknown outcome. **After:** non-idempotent job types have one attempt and no automatic retry; stalled deliveries fail for review rather than replaying handlers, with `JOB_INTERRUPTED_OUTCOME_UNKNOWN` recorded when Redis reports deferred failure. This is not a general exactly-once guarantee; database/Redis outage reconciliation remains an operational gate.
- **Before:** file processing could produce extracted bytes or indexed chunks concurrently with deletion. **After:** file processing/physical cleanup share a bounded PostgreSQL session lease, indexing rechecks/locks the live file before publishing chunks, and storage operations receive cancellation signals. Failed unlock connections are destroyed instead of returned with an outstanding lock.
- **Before:** file/artifact deletion had no UI confirmation or distinction between removal and physical cleanup. **After:** existing Delete buttons confirm the action and show queued/failed/completed cleanup honestly. The destructive tool result includes its cleanup job/status, while retaining explicit tool approval.
- **Before:** an unavailable database was reported as missing migrations; worker configuration could consume every pool connection with leases. **After:** safe startup error codes distinguish those cases, timeout/lock values are bounded, and the pool must leave at least two shared connections beyond worker concurrency. Agent lease cleanup also destroys connections after unlock failure.

No migration 001–006 was changed; existing jobs/outbox/tombstone columns are reused. New service/helper: `src/services/storage-cleanup.mjs`, `src/infrastructure/resource-lease.mjs`; new unit suite: `test/storage-recovery.test.mjs`. The application composition, worker, repositories, tools, file/RAG/artifact services and two Delete handlers were updated in place.

**Verification boundary:** 223 unit tests and the local browser journey pass. Actual new cleanup/stall/lease behavior against PostgreSQL/Redis/S3 remains unverified because test services cannot currently be restored. Keep checkpoint 3 as the earlier real-service-tested baseline. Do not deploy checkpoint 4 until the real-service/browser gates pass.

**Remaining cross-store gap:** creation compensation is still best effort. Process crashes after a successful object PUT but before metadata commit, failed compensating deletion, historical tombstones without cleanup jobs, hard outage during deferred-failure recording and full S3 retention/recovery need operator reconciliation. Administrator retries are supported only for failed/dead-letter idempotent cleanup jobs, never arbitrary agent/tool writes.


## Follow-up checkpoint 5: public admission, Windows compatibility and readiness

| BEFORE | AFTER |
|---|---|
| Production registration open by default; no shared per-user/workspace AI admission | Closed-by-default registration; verified email when required; migration 007 atomic UTC daily attempt counters and output-token ceiling |
| Individual gateway calls could ignore an operator-wide cloud policy | Shared policy before generation/planning/tool rounds/retries/embeddings; cloud AI disabled by default in production |
| Retry/fallback aggregate could mix failed provider usage with a later provider | Each attempt records its own provider/model/status/request identity; unknown prices remain unpriced and token estimates explicit |
| Invalid pricing/token values could taint cost accounting | Bounded explicit numeric pricing validation and bounded nonnegative reported-token validation |
| Ready-but-unindexed files returned early on retry | Retry can actually index parsed files; admission failures preserve parsed readiness with explicit `blocked_ai_policy`, not fake vectors |
| Quota exhaustion could trigger redundant background retry | Daily quota denials are permanent for that job; they do not repeatedly consume processing until UTC reset |
| Windows compared Unix mode bits; worker CLI path match assumed POSIX | Native protected current-user-only ACLs and platform-aware executable URL/path comparison |
| VS Code launch could select the wrong directory or inherit production DB/key | Inner-folder profiles/tasks; local profile binds loopback, clears production service/key values and disables test mock flag; explicit PostgreSQL profile refuses missing DB |
| API readiness could be green with no workers | Expiring random worker heartbeat after BullMQ connection; Redis server time removes stale registrations; HTTP readiness stays 503 without a live registration |
| Dedicated-host acknowledgement could still select an insecure/local Docker endpoint | Remote TCP + verified TLS/client certificates required; local sockets, loopback aliases, embedded URL credentials and unauthenticated transports rejected before process spawn |

Production usage UI now shows the actual admission limits and UTC accounting; verified-email controls and closed-registration UI are explicit. Remote speech is governed by the cloud flag in the voice service, while browser/device recognition retains its own behavior. The policy is not a universal external-egress or hosting-cost control. Provider attempts/embedding batches count, including admitted failures; tools/retries may consume more than one daily request for one user message. Quotas do not represent paid credits or guarantee ₹0 hosting.

`docs/WINDOWS_VSCODE.md` explains the no-local-Docker Windows demo and external-service-backed profiles. Full production processing/execution still requires compatible parser/scanner/executor hosts. No local-data overwrite, framework migration, failing-test suppression, live cloud provider certification or successful Python sandbox execution is claimed.

**Files:** See the machine-generated inventory against the original archive and `reports/upgrade/CHECKPOINT5_CHANGED_FILES.json` against checkpoint 4. New key files are the public policy/quota repository, migration 007, Windows entrypoint/private-path helper, worker heartbeat, explicit PostgreSQL entry script, VS Code configs, admission/file/Windows/heartbeat/sandbox tests and Windows runbook.

**Outstanding gates remain real work:** restore actual test services and run migration/quota/worker/storage/browser gates; run native Windows CI/ACL checks; configure and evaluate live Ollama/embedding/provider behavior; verify parser/malware/security/load/recovery; provision and test a genuinely isolated executor and target HTTPS deployment. MFA/SSO, full resource-consumption sampling, advanced planner quality and other documented gaps remain. The exhaustive definition of done is not met.

Deployment source now passes public/email/quota/embedding/worker settings through one API/worker environment anchor. YAML parsing and a source-contract regression pass; Docker Compose interpolation/startup was not reverified. Container/source-control exclusions cover environment secrets, executor certificates and backups; source packages also exclude user data and dependencies.


## Follow-up checkpoint 6: grounding, permission boundaries and atomic execution

| BEFORE | AFTER |
|---|---|
| Chat could return an advisory-lock connection after failed unlock | Failed unlock destroys the leased connection; competing claims and handler failures are unit-tested |
| Chat/agent/analyst service calls depended on outer HTTP permissions | Fresh nondeleted user/workspace membership and role checks before service work; stale admin cancellation claims cannot stop other users' runs |
| Sources were declared before global prompt slicing; direct attachments had no citation IDs | One bounded evidence registry assigns IDs only to supplied excerpts, including explicitly labelled direct-file fallback; metadata records excerpt hash/page/chunk/type/truncation without full text |
| Tool retrievals reused citation IDs; failed research URLs could look like read pages | Current-turn IDs are shared by initial evidence and knowledge/read-file tool results; unavailable pages omitted, search snippets labelled separately |
| Regex citation checks could mistake code arrays for references or accept missing evidence | Markdown-code-aware ID/range/link checking; historical IDs require fresh evidence; unsafe source links are not clickable; numerical range parsing is bounded |
| Available links could imply automatic factual verification | UI distinguishes available/uncited sources and explicitly states that matching IDs do not prove entailment |
| Agent run creation and queue insertion could leave an orphan after failure | Run/job/outbox creation shares one PostgreSQL transaction; strict task schema rejects object coercion and oversized goals |
| Approval commit could be stranded before resume scheduling | Approval/resume job/outbox commit together; current waiting-action and fresh tool permission checked; stale rejection cannot cancel another current action |
| Analyst explanation whitelist included numbers in file IDs, column names and timestamps | Only actual computed numbers/counts/numeric group values with deterministic display rounding; scientific notation, sign, grouping and magnitudes validated as whole values |
| Optional explanation outage discarded already computed facts | Known quota/provider/internal explanation-timeout failure preserves deterministic results and reports the limitation; user cancellation/unknown errors are not hidden |
| Non-finite structured result could serialize as null or invalid data | Explicit NUMERIC_RANGE rejection before publishing non-finite structured results; original analyst engine untouched |

New key modules: `src/rag/evidence.mjs`, `src/analytics/numeric-grounding.mjs`; changed chat/research/agent/analyst/tool services and existing UI; new regression suites and expanded real-runtime tests. Source inventory and checkpoint-6 delta are machine-generated. No migration or environment-variable change is required beyond the checkpoint-5 migration 007/configuration.

**Limits of validation:** reference IDs/hashes prove provenance bookkeeping, not factual entailment. The numerical checker recognizes configured decimal/grouped/scientific/magnitude formats and deterministic rounding, not written-out quantities, causality, units, operation intent or arbitrary linguistic claims. Unsupported compact/digit formats conservatively retain the computed result. Standard Number arithmetic is not high-precision financial certification; extreme numeric stability, all dashboard/chart semantics, broad evaluated model quality and live operational verification remain open.

Agent arithmetic/typed bindings are not a replacement for the specialized analyst. General agent access to a dedicated deterministic analysis tool, shared provider consolidation/model capability discovery and the remaining documented maintenance gaps are still future work. Successful Python isolation and public deployment remain blocked. The exhaustive definition of done is **not** met.


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
