# Fabric v1.10.4 — Foundation checkpoint 1

**Outcome: codebase audited; a working local application with tested Foundation fixes delivered. The eight-phase production upgrade is not complete.** The live runtime still uses local JSON persistence. Staging/production startup now refuses this incomplete configuration instead of treating a database health check as PostgreSQL persistence.

## 1. Problems found
The audit covers frontend/backend, persistence/auth/RBAC, providers/tools/agents, deterministic analyst, files, queue/storage, tests, observability and dead workflows. Details are in `AUDIT-v1.10.4.md`.

Most important: all live routes used the global JSON store; PostgreSQL was only used for readiness. File processing used API-process setImmediate, the worker only handled health probes, agents had a fixed plan, file context was not RAG, memory/cost tracking were incomplete, and workflow execution code was unreachable. Existing Argon2id, CSRF, RBAC, provider adapters, file-security utilities, analyst calculations/provenance and glass UI are worth preserving.

## 2. Problems fixed — before → after
| Before | After |
|---|---|
| PostgreSQL DDL committed before its migration ledger row | DDL and checksum ledger commit together on one connection; failures roll back both. Existing migration files/checksums remain unchanged. |
| Rollback could leave/drop migration ledger inconsistently | Runner removes the rolled-back version transactionally and recreates the historic initial ledger when necessary; rollback/reapply tested. |
| Conversation routes owned CRUD/storage logic | ConversationService validates inputs and checks permissions; LocalConversationRepository implements the current runtime. A real PostgreSQL implementation of the same contract is separately tested. |
| Conversation list returned every record at once | API returns bounded pages with nextOffset; existing client follows those pages. UI appearance is unchanged. True load-more/virtualized client history remains future work. |
| A message could reference a conversation from a different workspace at the database level | New composite foreign key enforces message/conversation workspace consistency, plus tenant/pagination indexes. |
| Production could start with JSON even when DATABASE_URL was configured | Config validates inputs before filesystem writes and blocks staging/production until route migration is complete. This is a safety gate, not completion of PostgreSQL persistence. |
| Some failures omitted request IDs or included upstream bodies/paths | Common HTTP errors include requestId; typed service errors retain status/code; provider/voice raw response bodies are no longer appended; common secret/path/stack patterns are sanitized. |
| Dashboard operations fell through to general workspace.write permission | They now explicitly require analyst.run. |
| Stop button checked empty composer text before aborting | Stop now aborts first, even with an empty composer, and the button resets afterward. |
| Disconnected chat silently lost partial assistant output | Partial output is stored with cancelled status; cancellation is audited; active-generation gauge decrements in finally. |
| Workflow runner remained below unconditional 410 | Verified unreachable create/update/delete/run code removed; 410 compatibility and legacy stored workflow data preserved. |
| Two inherited moderate npm advisories through ExcelJS UUID | Narrow UUID 11.1.1 override, without downgrading ExcelJS; conditional-formatting XLSX write/read compatibility test added. Final npm audit reported zero advisories. |
| Syntax checks covered only selected files; no actual browser suite | Recursive JavaScript checks, PostgreSQL suite, Playwright smoke suite and CI jobs added. |

## 3. Files changed
Full inventory/diff are in `reports/foundation/CHANGED_FILES.md` and `reports/foundation/changes.patch`.

Modified runtime: `src/server.mjs`, `src/security/rbac.mjs`, `public/app.js`, `scripts/migrate.mjs`.

New boundaries: `src/database/{migrations,transaction}.mjs`, `src/repositories/conversation.mjs`, `src/services/conversation.mjs`, `src/server/{config,errors,security-headers}.mjs`.

New schema: `migrations/002_conversation_tenant_integrity.sql` and its down migration.

Tests/config: `test/foundation.test.mjs`, `test/chat-cancellation.test.mjs`, updated file-security/HTTP-header tests, `integration/{postgres.integration,browser.spec}.mjs`, `playwright.config.mjs`, `scripts/check.mjs`, package/lockfile, CI, ignore files, environment example and status documentation.

## 4. New architecture — actual, not proposed
```
Existing Fabric SPA
  → existing HTTP/auth/RBAC
  → ConversationService
  → LocalConversationRepository → guarded JSON (development/testing only)

Separately integration-tested:
ConversationService → PostgresConversationRepository → PostgreSQL
Migration CLI → migration runner → transactional PostgreSQL DDL + ledger
```
The other API features still use the legacy runtime boundaries. The PostgreSQL adapter is deliberately not selected for only conversation routes: authentication, chat/message persistence, dashboard and other dependencies must move together to avoid two conflicting stores. No giant JSON snapshot was moved into PostgreSQL and presented as a completed migration.

## 5. Database changes
- Applied `001_initial.sql` without editing its historical checksum.
- Added `002_conversation_tenant_integrity.sql`: unique `(workspace_id,id)` conversation index, composite message foreign key, and stable workspace/update/id pagination index.
- Existing inconsistent tenant rows make migration fail rather than silently reassigning data.
- Repository queries bind all inputs, scope every read/write by workspace, bound list pages, verify creator membership, and transactionally soft-delete a conversation and delete its messages.
- **No legacy workspace import or complete production data migration has been implemented.**

## 6–9. AI Gateway, agents, RAG and memory
No new AI Gateway, model-planned agent engine, vector RAG pipeline or memory retrieval system is claimed in this checkpoint. Existing provider/agent behavior was preserved; raw provider error disclosures were reduced. Chat cancellation was fixed. The deterministic analyst remains the authoritative calculator and its existing provenance/UI were preserved. Phases 2–6 remain pending after Foundation completion.

## 10. Security changes
Startup fail-closed gate, request-ID/safe-error handling, shared security headers, analyst permission correction, tenant DB constraint, cancellation audit and dependency advisory fix are implemented. Existing Argon2id/legacy-password compatibility, authenticated encryption, CSRF, HttpOnly/SameSite cookies, RBAC, upload controls and native integrity mechanisms remain.

The old production-header HTTP test now exercises the runnable test-mode server; production HSTS is tested directly through the shared header function. New tests separately verify production startup refusal before filesystem changes. No failing tests were disabled. This is not a full penetration test or a guarantee against all secret/prompt leakage paths.

## 11. Testing actually executed
Runtime: Node v24.14.1. PostgreSQL integration used an isolated real PostgreSQL 18.4 server; project CI is configured for PostgreSQL 16 but the hosted CI job has not run here.

| Check | Result |
|---|---|
| Original npm ci / npm test | Install succeeded; 96/96 tests passed |
| Final npm ci | Succeeded from the updated lockfile |
| npm run ci | Passed: syntax, regression, coverage run, dependency audit |
| Final npm test | 108/108 passed, zero failed/skipped |
| npm run test:coverage | Passed; aggregate line 77.45%, branch 65.40%, function 49.88% |
| npm run test:security | Existing security subset: 22/22 passed; audit passed |
| npm run test:postgres | One real-infrastructure suite passed; forward/idempotent migration, DDL and ledger failures, checksum detection, rollback/reapply, tenant isolation, SQL-injection input, membership, pagination, soft deletion and transaction rollback asserted |
| npm run test:browser | One real Chromium smoke scenario passed; registration/login/logout, streamed development-mock chat, persistence after completion, Stop with empty composer, cancelled record, CSV upload, deterministic total 120, files/settings and calculator result 60 |
| Final npm audit | Zero reported vulnerabilities at execution time |
| Visual check | Settled Settings/Security screenshot inspected; existing Fabric glass identity preserved |

Browser chat uses the explicitly labeled existing mock provider for reproducibility; this is not certification of OpenAI/Anthropic/Ollama/native inference. PostgreSQL integration is an explicit separate command requiring a disposable test DB; it fails when the test database is missing rather than silently skipping. Coverage above is the local Node suite, not combined browser/PostgreSQL coverage. Low backend function/branch coverage remains a concern.

The first browser attempts exposed synchronization/assertion issues: provisional streamed text was checked before persistence, direct analyst totals were expected in the dashboard instead of the analyst conversation, and screenshots were captured during the existing fade-in. The final test waits for completion, asserts the actual result location and waits for settled rendering; no application assertions were removed to hide a failure.

## 12. Remaining limitations / production blockers
Phase 1 is still incomplete: users/workspaces/members/sessions, providers/OAuth, chat/messages, files, memories, analyst state, runs/artifacts, usage and audit must migrate to PostgreSQL repositories with coordinated transactions and import/restore rehearsal. The global JSON cache/save architecture remains local-only. Message detail/history remains unbounded, and the client auto-collects conversation pages; scalable history navigation is not finished.

Real Gateway tool calling, LLM agent planning/state/approval/cancellation, pgvector retrieval/citations, memory policies, LLM analyst planning, isolated Python/SQL execution, S3-backed uploads and actual BullMQ handlers remain unimplemented. Redis/S3/live-provider integration, antivirus/OCR/parser container operation, comprehensive security tests, full browser flows, AI evaluations, load tests, production backup/restore and deployment certification have not been executed. Historic native deterministic task responses remain unchanged and are not represented as new model inference.

## 13. Environment variables
Use `.env.example` as the full existing inventory; the server does not automatically load a .env file.

Local run: `NODE_ENV=development`, optional `FABRIC_HOST`, `FABRIC_PORT`, `FABRIC_DATA_DIR`; supply a generated `FABRIC_MASTER_KEY` of at least 32 characters or use the existing local auto-generated key behavior. Protect the local data directory/key. Configure providers in Fabric; do not put API keys in browser code.

Test-only additions: `FABRIC_TEST_DATABASE_URL` must point to a disposable PostgreSQL database with schema/extension privileges. `FABRIC_TEST_CHROMIUM` optionally points to installed Chromium; otherwise install Playwright's Chromium. Test suites use explicit disposable credentials, not production secrets.

Future staging/production requires secure master key, PostgreSQL, HTTPS public URL, Redis, S3/object-storage credentials, malware scanning and native integrity configuration as applicable. Supplying these **does not lift the current production gate**.

## 14. Run / deployment instructions
Local development only:
```sh
npm ci
npm run check
npm test
npm start
```
Open `http://127.0.0.1:8787` with the default host/port. Supply environment variables using your shell or deployment tool, not by committing secrets.

Additional verification:
```sh
npm run test:security
npm run test:coverage
# Set FABRIC_TEST_DATABASE_URL to a disposable PostgreSQL database first.
npm run test:postgres
npx playwright install chromium
npm run test:browser
```
Migration CLI for a properly backed-up database:
```sh
# Set DATABASE_URL (and PGSSLMODE if needed) first.
npm run db:migrate
```
`db:rollback` is destructive and removes the latest migration; do not run it on production data without a reviewed recovery plan. No automatic rollback or legacy import occurs at startup.

**Do not deploy this checkpoint as production.** The production compose remains an infrastructure target and its API intentionally exits until route migration is implemented. Do not remove the guard or label a development-mode deployment production to bypass it.

## 15. Recommended next improvement
Finish Phase 1 before starting the AI Gateway: transactional registration/workspace/session repositories, explicit session/workspace binding, provider/message repositories, coordinated chat/dashboard integration, then file/analyst/agent/artifact/memory/usage/audit mappings and a verified legacy importer. Gate acceptance on fresh migrations, restart persistence, multi-tenant/concurrent writes, import reconciliation and restore tests. The ordered plan is in `IMPLEMENTATION_PLAN.md`.
