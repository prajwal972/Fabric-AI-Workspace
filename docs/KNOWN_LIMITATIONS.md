# Release status: checkpoint 10; partially verified, not production-certified

## Blocking release gates

**Current evidence:** 419 Linux unit cases, syntax, 3 existing local browser journeys and 1 genuine encrypted S3 integration pass. Expanded PostgreSQL runtime fails setup DATABASE_UNAVAILABLE; separate fresh offline install fails ENOTCACHED. New PostgreSQL memory UI/locking assertions did not execute. Historical service results are not current-source certification. Native Windows/live AI/secure Python/deployment remain open.

1. Live OpenAI, Anthropic, Ollama and Fabric Native generation have not all been exercised with valid credentials/runtimes. Protocol fixtures verify adapter wiring, not provider quality.
2. The current agent computer cannot enforce Docker CPU/RAM cgroup limits. The Python executor is fail-closed; no successful real isolated Python execution is claimed. Verify on a dedicated full-cgroup executor host.
3. The production Docker image/compose stack has not been built and run here. Compose syntax was validated only. HTTPS ingress, malware scanner updates, least-privilege roles, object-storage recovery and deployment secrets need target-host verification. A real disposable PostgreSQL encrypted backup/restore drill now passes; target recovery objectives and full-system recovery are still unverified.
4. RAG indexing/retrieval mechanics are tested with clearly labelled vector fixtures. Live semantic accuracy, citation entailment and prompt-injection robustness need reviewed model/dataset evaluations.
5. This is not a penetration test or scalability certification. Representative access-control/security tests pass, but the entire attack matrix and realistic load/failure-injection matrix are not complete.

## Remaining implementation and maintenance gaps

- Production providers and the original demo provider implementation still coexist; further shared-protocol extraction is needed without losing the demo task profiles.
- Production feature-route extraction is complete; the central server is about 220 lines and retains only shared transport/security/lifecycle concerns. The preserved legacy/demo server and frontend still have older monolithic structure.
- Agents now resolve typed earlier-step dependencies and bounded string composition, and can replace the unexecuted plan tail after a READ failure without replaying completed actions. Parallel graph execution and sophisticated replanning policies remain limited. Failed writes are not retried automatically. Verification remains model-mediated, not a general formal verifier.
- Streaming tool approval resumes are available via explicit action controls; continuing the exact interrupted chat response automatically is not implemented.
- Regenerated replies now preserve superseded versions with show/hide controls, and conversation/message history is loaded in bounded pages with server-side search. Drafts survive history/version navigation. Older-message branch editing and selecting an older response as the canonical active version remain incomplete; latest-own-message editing is supported.
- Long-term memories are explicit-only. A bounded authorized background backfill is implemented for imported/pending memories; it must be run with the chosen embedding model. Sensitive imported facts are skipped and require user review. Model changes require explicit reindexing.
- Ollama model metadata is inspected with bounded workspace/config-scoped caching; text-only/unknown models do not silently receive native tools. Other providers still use adapter/config capabilities. Exact per-model tokenizers and universal catalogs are incomplete; token counts remain labelled estimates. Reported metadata is not live behavioral verification.
- Fixed 768-dimensional vectors are required; changing embedding provider/model requires reindexing.
- Structured CSV/flat-JSON is bounded at 2 MB, 50,000 data rows and 100 combined columns. XLSX supports compatible-sheet merge within 20 worksheets / 50,000 data rows / 500,000 extracted characters. Actual excess or incompatible schemas fail rather than silently produce partial aggregates. Cached formulas are not recalculated or freshness-verified.
- OCR/Office/PDF/media subprocess paths are implemented, but the complete malicious-document and all-format E2E matrix is not certified. Missing tools fail extraction honestly.
- No new vision-model image encoding, email-sending agent tool, arbitrary browser-action tool, or connector write action is claimed.
- Email recovery templates/challenges/UI are implemented; SMTP deliverability, real OAuth provider callbacks, MFA enrollment and enterprise SSO are not live-tested. MFA/OAuth architecture must not be described as completed MFA/SSO.
- SQL analytics is explicitly bound to one configured workspace and a conservative SELECT/function dialect. Real restricted-role/database/cancellation/deadline checks pass. Deployment-specific grants and multi-tenant analytics credentials/schemas still need review. Wire payloads are now bounded before transmission (up to 100 rows / 10 KB per row / 50 unique columns), with exact bigint/numeric parsing and a 100 KB decoded-output limit. Custom output types are rejected; analytics-server resource limits and reviewed views remain operator responsibilities.
- Sandbox limits are enforced by the executor; actual CPU/RAM consumption sampling and tamper-resistant audit retention remain incomplete.
- Local ClamAV is required in production/staging. Tests use optional scanning; they are not an antivirus certification.
- R2-specific encryption/configuration is not tested. The verified storage path is encrypted S3-compatible storage supporting SSE-S3.
- CI configuration is included, but a remote GitHub CI run and container vulnerability scan have not been executed here.

Historical unfinished workflows were removed rather than maintaining competing workflow engines. The importer preserves historical runs/workflows in an encrypted archive, not as resumable new runs. Original sessions are deliberately revoked on import. Original source data is never deleted by the importer.

Cross-store artifact creation now compensates object writes when metadata insertion fails, with a real PostgreSQL failure/S3 deletion test. Process crashes between the object write and compensation, failed compensating deletion, still need reconciliation/operational controls. New logical file/artifact deletion commits a durable cleanup job; physical cleanup and administrator retry are implemented/unit-tested but require real-service revalidation. Historical tombstones without jobs and object version/retention policies still need reconciliation; no cross-store atomicity guarantee is claimed. Static analytics URL checks reject the same configured application database and common loopback aliases; operators must also review DNS aliases, credential grants and actual target identity.


Worker stalled deliveries now fail closed rather than automatically replaying unknown effects. Deferred-failure recording is best effort during database outages; review/reconcile queue/database state operationally. Non-idempotent notifications/reports do not auto-retry; email deliverability still needs operator review. Required tombstone cleanup cannot be cancelled. Resource leases are bounded and shared between file-producing workers and deletion; target database/pool/resource failure behavior remains unverified at checkpoint 4.


Checkpoint 5 adds migration 007 for atomic daily AI admission, closed-by-default production registration, optional fresh email verification enforcement, cloud-provider admission controls, explicit per-attempt retry/fallback usage, stricter pricing/token validation, Windows-safe worker startup and expiring worker health. Real-service quota/heartbeat/migration tests, Windows ACL execution and latest storage recovery are still pending. Output-token/request bounds do not enforce a monetary budget or control every external service. Admin-configured local-model endpoints are not guaranteed to be cost-free.

The user's ₹0, public, Windows-only/no-local-Docker constraints do not establish a deployable free production environment. The VS Code local profile is supported as a preserved local demo; hosted services and compatible parser/scanner/executor hosts remain required for the full production architecture. No successful secure Python run, full Windows production worker or externally reachable Ollama connection is claimed.

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


## Historical checkpoint 8 — data correctness and chart rendering

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
