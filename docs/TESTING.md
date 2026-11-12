# Testing and evidence

## Local component gate

```sh
npm ci
npm run check
npm test
npm run test:evaluation
npm audit --audit-level=high
```

Tests include the preserved deterministic analyst suite, auth/RBAC/local behavior, bounded arithmetic, tool schemas/permissions/approvals, encryption, SSRF boundaries, normalized provider protocols, execution fail-closed behavior, and a fixed component-evaluation corpus.

## Real-service integration

Use dedicated disposable PostgreSQL+pgvector, Redis and encrypted S3-compatible services. Set `NODE_ENV=test`, `DATABASE_URL` and matching `FABRIC_TEST_DATABASE_URL`, storage/Redis/master-key/public-URL configuration. Worker-health integration also requires `FABRIC_TEST_REDIS_URL` exactly matching the disposable `REDIS_URL`. Normal `npm test` does not silently skip integration gates; these are explicit commands requiring their environment.

```sh
npm run test:storage
npm run db:migrate
npm run test:postgres
npm run test:ai-policy
npm run test:worker:health
npm run test:runtime
npm run test:import
npm run test:sandbox:sql
npm run test:redis:failure
npm run test:backup:restore
npm run test:browser:runtime
npm run test:browser
```

A real PostgreSQL schema is created/dropped for migration/import tests. Runtime tests exercise actual HTTP, transactions, durable Redis/BullMQ jobs, encrypted stored bytes, parsing, pgvector SQL and authorization. Runtime/browser model answers and vectors come from an explicitly labelled **test protocol server**. They are not simulated database/storage/jobs, but they also are not a claim of live model accuracy or production embeddings.

Use `FABRIC_TEST_CHROMIUM=/path/to/chromium`, or install Playwright Chromium. Browser traces/screenshots are retained on failure; the original local-mode browser suite remains independent.

## Live release gates

`npm run evaluate:live` requires an existing configured evaluation account/provider and secret environment values `FABRIC_EVAL_EMAIL`, `FABRIC_EVAL_PASSWORD`, `FABRIC_EVAL_PROVIDER_ID`, optional model/report path. It refuses a mock provider. This initial live gate covers arithmetic/tool selection only. Broader semantic retrieval/citation entailment, unsafe-action refusal, planner quality and prompt-injection benchmarks are still required.

`FABRIC_BENCHMARK_URL=http://your-staging-host npm run benchmark` makes 50 bounded liveness requests and reports percentile timings. It does not claim system capacity, AI first-token latency or high-concurrency performance.

Live sandbox, SMTP/OAuth, antivirus, container deployment and all-provider quality gates require the real target services. Missing gates are release blockers, not passing/skipped tests.

The SQL suite provisions a separate disposable analytics database and restricted role, and verifies genuine aggregate results, grants, schema-function shadow rejection, backend cancellation and the 3-second deadline. The Redis fault-injection suite uses the real Redis service behind a local dropping TCP proxy to verify bounded producer failure. These are not live deployment certification.

The database-backup suite requires matching PostgreSQL client tools (PostgreSQL 16 for the supplied test service). It exercises actual custom-format dumps, AES-GCM encrypted archives, relocation/checksums, explicit restore confirmation, atomic pg_restore, restored provenance/migrations, corruption refusal and cleanup on encryption failure. It does not certify S3 recovery or a production disaster-recovery objective. A second PostgreSQL browser journey covers bounded conversation search/list paging, older message loading, regenerated response versions and draft preservation.


## Checkpoint 4 evidence boundary

Current source: **223 unit cases** and **1 local browser journey** pass; the latter tests dismissal and acceptance of file deletion. New unit cases cover permanent/transient failures, attempt bounds, cancellation, membership revocation boundaries, tombstone validation, resource leases, SDK cancellation, interruption/side-effect replay policy, safe startup errors and pool capacity. Test doubles are explicitly unit-only.

The expanded runtime suite includes real PostgreSQL/Redis/S3 deletion, retries, revoked-member cleanup, live-row refusal and RAG/deletion races. It currently fails **at setup** with DATABASE_UNAVAILABLE: the reset machine lacks PostgreSQL/Redis binaries, and package-repository DNS is unavailable. Those new scenarios did not run. Fresh offline installation also fails ENOTCACHED. Do not interpret earlier checkpoint-3 passing integration logs as current-source certification. Restore services without reinitializing their data, complete a fresh registry-backed installation, rerun all explicit real-service/browser gates and then live/target-environment gates. No failing gate was disabled.


## Checkpoint 5 evidence boundary

Current Linux regression source: **266 unit tests passed**, zero failed/skipped, with successful syntax checks. The local browser journey is separately recorded in `reports/upgrade/checkpoint5-local-browser.log`. Unit doubles check quota/gateway/file-policy/heartbeat transitions, not actual PostgreSQL transaction concurrency or Redis Lua execution.

New `test:ai-policy` provisions an isolated schema and tests real transactional user/workspace quota admission, fresh authorization, verification and provider scope. It currently fails setup with ECONNREFUSED because PostgreSQL is unavailable; none of its substantive assertions executed. `test:worker:health` tests actual Redis server-time expiry and multiple worker registrations; current real-service execution remains blocked. The runtime suite additionally checks HTTP readiness before/after real worker startup. These are unverified release gates, not silently skipped tests.

Windows-native backup ACL checks and worker-path behavior have tests plus an included Node 24 Windows CI job. The CI configuration has **not** been executed remotely. Linux backup tests do not certify Windows ACL behavior. Fresh install/audit and target production/live-model gates remain pending under the existing network/service blockers. Preserve the historical checkpoint-3 results as historical only.

The Python transport now additionally rejects unauthenticated Docker TCP endpoints, local sockets and common loopback aliases before launching a client process. This is configuration validation, not successful container execution or proof of physical host separation.


## Checkpoint 6

Current source passes 320 Linux unit cases, syntax and one local browser journey. The expanded real-service runtime fails setup DATABASE_UNAVAILABLE; new source-ID, actual tool-round metadata and scheduling rollback assertions did not run. Fresh offline install fails ENOTCACHED. Migrations 001–007 and dependencies are unchanged this checkpoint.

Bounded evidence/citation bookkeeping, fresh chat/agent/analyst/tool authorization, atomic scheduling/approval, safe links and numerical explanation identity validation are implemented. No semantic entailment, written-out-number/causality/unit proof, arbitrary precision, all chart semantics, live model or production/Windows certification is claimed. Optional explanation failures remain visible while deterministic results are preserved; cancellation/unknown errors are not converted into success. Historical logs remain historical.


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
