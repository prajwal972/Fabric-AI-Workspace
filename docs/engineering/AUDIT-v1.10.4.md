# Fabric v1.10.4 source audit

Scope: the supplied Fabric-v1.10.4-full-height-chat.zip. No external repository or production system was inspected. This is a Foundation checkpoint, not completion of the master prompt.

## Baseline actually executed
- Node v24.14.1; npm ci succeeded with the existing lockfile.
- npm test: 96 passed, zero failed/skipped (7.2 seconds).
- npm audit: two moderate advisories, zero high/critical. Do not force-upgrade ExcelJS without compatibility tests.

## Architecture and preservation inventory
| Area | Existing implementation | Finding / preserve or replace |
|---|---|---|
| Frontend | public/app.js, index.html, glass/chat/analyst styles | Framework-free SPA; preserve appearance, voice, composer, history and analyst UX. Do not migrate frameworks yet. |
| Backend | src/server.mjs: 117,580 bytes in 124 minified lines | Authentication, providers, tools, routes and persistence share a global db object. Extract by feature, not wholesale rewrite. |
| Persistence | src/storage/json-store.mjs; flux.json | Atomic write, backup recovery and Windows fallback are valuable for local mode. All live route data still uses it. DATABASE_URL only creates a health-check pool. |
| PostgreSQL | migrations/001_initial.sql, scripts/migrate.mjs | Useful normalized tables/constraints. Missing memory/vector, agents/runs/tool execution and artifacts. Migration SQL and ledger were committed separately; rollback ledger cleanup is inconsistent. |
| Authentication | server.mjs hashPass/checkPass/setSession/auth | Argon2id already exists (legacy scrypt compatibility), encrypted provider secrets, HttpOnly/SameSite cookies, CSRF, rate limits. Preserve. Membership selects first match; identity/session/workspace migration requires explicit selection. Recovery/MFA/email verification not complete. |
| RBAC | src/security/rbac.mjs | Default deny, four roles, route-level enforcement. Dashboard-operation route misses analyst-specific permission; fix it. Tool-level policies are not yet centralized. |
| Providers | Mock/OpenAI/Anthropic/Ollama/FabricNative in server.mjs | Actual HTTP streaming adapters exist. Centralized adapter selector, but no complete Gateway with retry/fallback/context/cost ledger. Preserve compatibility. Fabric direct mode includes deterministic response logic; distinguish it from actual neural inference, never certify it as full model support. |
| Tools | tools/runTool/calc in server.mjs | Calculator, clock and public GET execute real handlers. Input/output schemas, per-tool authorization, approval and durable execution records are missing. |
| Agents | /api/agents/run | Fixed plan and regex calculator choice, then one model response. Not a model-planned state machine; no resumable approval/cancellation. |
| Analyst | src/analyst/engine.mjs and analyst routes | Deterministic semantic modeling, cleaning, KPIs, correlation/outliers, dashboards, provenance, undo/state. Preserve calculations. Intent routing is deterministic, not LLM planning. File parsing limits and provenance need separate edge-case coverage. |
| Files | server extractStoredFile; files/security.mjs, extractors.mjs | Real local disk uploads, signature checks, antivirus hook and bounded text/XLSX parsers. setImmediate is not a background worker; synchronous office extraction/decompression remains in API. |
| Redis/BullMQ | infrastructure/queue.mjs; src/worker.mjs | Queue primitives exist, API does not dispatch them. Worker only registers health-probe. BullMQ timeout job option is not a hard execution deadline; active-job cancellation is not implemented. |
| Object storage | infrastructure/object-store.mjs | S3 put/get/delete adapter exists; main upload/download routes use local filesystem. No object/DB consistency recovery pipeline. |
| RAG | attached text appended to prompt | Not chunking/embedding/retrieval. No pgvector migration or citation-grounding evaluation. |
| Memory | memories collection, workspace memoryEnabled | Persistence placeholders, no bounded relevant memory policies/retrieval/management workflow. |
| Usage | message usage fields; usage_ledger table | Provider usage sometimes recorded with messages; no uniform durable per-request ledger/cost analytics. |
| Workflow | /api/workflows returns 410; runner code below it | Runner/create/update/delete are unreachable. Choose removal of unfinished runtime, preserve legacy data for migration/export. |
| Sandbox | runBinary for document and voice utilities | No arbitrary Python tool implemented. Do not add code execution to API; isolated execution remains a later phase. Parser subprocesses are not a general code sandbox. |
| Observability | observability/index.mjs | Pino, Prometheus, request IDs, latency, active generation and failure counters already exist; preserve. Some errors bypass shared logging/sanitization. No distributed AI tracing yet. |
| Tests | 26 existing test files | 96 baseline tests include HTTP integration and source-text UI assertions. test/e2e.test.mjs uses fetch, not browser Playwright. No live PostgreSQL/Redis/provider certification in baseline. |
| Deployment | Dockerfile, compose production, runbooks | Dependencies present; scanner/parser binaries and full services not operationally verified. Production compose cannot certify persistence merely by setting DATABASE_URL. |

## Verified risk / duplicate / dead-code inventory
- Unreachable workflow implementation behind an unconditional 410; runtime removal is safe because no request can reach it. Keep existing 410 compatibility contract.
- API conversation routes directly manipulate db alongside chat/dashboard; migrate one boundary at a time, preserving shared local state until PostgreSQL migration is complete.
- Multiple provider invocation sites (stream/compare/agent/dead workflows), not interchangeable duplicated adapters. Reuse adapters in Phase 2.
- Existing docs claim different historic versions and stages. Add checkpoint documents rather than rewriting prior release evidence.
- Explicit fail calls may expose upstream response text/paths and often omit requestId. Centralize safe responses while keeping useful public validation errors.
- read-all collections, global mutable state, serialized JSON writes and in-memory rate limits prevent safe multi-replica deployment.
- SSRF DNS checks do not pin socket addresses. Prompt instructions alone are not tool authorization. Production requires independent enforcement.

## Production decision
**Not production-ready.** Production startup must fail closed while live routes still rely on JSON. New PostgreSQL repositories must not be portrayed as migrated production flows until every dependent route and transaction is switched and verified.
