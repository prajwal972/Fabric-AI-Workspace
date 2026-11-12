# Fabric v1.10.4 — checkpoint 10 engineering handoff

**Outcome:** continued without GitHub. Memory control/security implementation improved in place; all eight phases remain **not fully accepted or completed**. Current verified source: **419 Linux unit tests**, syntax, **3 existing local browser journeys**, **1 real encrypted S3-compatible integration passed**. Complete runtime fails database setup; separate fresh offline install fails missing dependency cache. New PostgreSQL memory UI/locking tests are not passes.

## 1. Problems found
Memory mutations could trust cached roles. Retrieval lacked opt-out revalidation after embedding. Expiry existed only in storage, list results had no paging controls, nearest memories had no distance cutoff, read-only members could not disable personal memory, and deletion retained embeddings.

## 2. Problems fixed — BEFORE → AFTER
- Cached roles → fresh active membership and current-role checks, conditional settings SQL and transaction-held insert/delete/index policy locks.
- Opt-out during embedding ignored → fresh checks and final authorized retrieval SQL; cancellation preserved.
- Unconditional nearest-five → configurable cosine-distance cutoff, embedding-identity/expiry/conversation checks.
- Fixed latest list → bounded API paging and previous/next/expired-review UI controls.
- No user expiry → optional future expiry within 365 days, saved/indexed with existing schema.
- Viewer cannot opt out → personal preference changes allowed; workspace administration and memory writes remain restricted.
- Retained active vectors after delete → embedding/model cleared with soft deletion and atomic content-free audit.

## 3. Files changed
New memory policy and route/config regression suites; targeted edits to MemoryService, routes, configuration/context, RBAC, settings UI, existing RBAC/runtime/browser tests and .env.example. Complete inventory: docs/engineering/FILES_CHANGED.json; checkpoint-9 delta: reports/upgrade/CHECKPOINT10_CHANGED_FILES.json. Deterministic engine is byte-identical to checkpoint 9.

## 4. Architecture
Memory API/tool → fresh active policy → scoped transaction/job/audit. Indexing checks policy before provider work and again inside vector-write transactions. Retrieval checks opt-out before/after embedding and in the final scoped SQL, returns at most five records within the configured distance. Expired memories are excluded from active retrieval/indexing; review is explicit.

## 5. Database
Existing expires_at/embedding/deleted_at fields are reused. Migrations 001–007 unchanged; no new dependency. Current PostgreSQL transaction/lock/migration validation remains blocked. Offset paging is bounded, not a scale benchmark or snapshot-consistent keyset implementation.

## 6. AI Gateway
Existing gateway/adapters/streaming/tool/usage/capability logic preserved. Matching embedding identity is retained. Distance threshold is a configurable policy, not proof of semantic relevance. Live provider/tokenizer/embedding evaluations remain pending.

## 7. Agents
The approval-controlled remember tool uses the hardened memory service. It cannot bypass current write/admin/opt-out checks; explicit saving and bounded indexing remain unchanged. No automatic indiscriminate memory harvesting. Current full queue/agent/tool integrations remain blocked.

## 8. RAG
File RAG and citation machinery unchanged. Memory retrieval now excludes expired/deleted-conversation context and applies the distance cutoff. Memories are context, not fabricated numbered source citations. Live relevance/entailment/prompt-injection evaluation remains open.

## 9. Memory
Optional expiry; paged review; expired filter; current-role and opt-out checks; embedding/model clearing on delete; transactional audit/job creation; personal opt-out for viewers while workspace controls stay admin-only. These are PostgreSQL runtime features, not retrofitted JSON-demo features.

## 10. Security
Mutation policy holds active membership/user/workspace rows during insert/delete/index transactions. Settings use conditional current-role SQL. Content is excluded from new audit details. Unsupported actors/permissions fail closed; cancellation is not hidden. Soft deletion and expiry do not constitute physical erasure or backup purge. Full penetration/concurrency/Windows certification remains pending.

## 11. Testing results
**419 unit passed / 0 failed / 0 skipped** (27 new versus checkpoint 9); syntax passed. **3 existing local browser journeys passed**: chat/settings/tools/deletion, signed/scatter analysis, ambiguous/valid JSON uploads. **1 genuine encrypted S3 integration passed** with actual round-trip/deletion/metadata/key/cancellation checks. This is not a memory/PostgreSQL/Redis end-to-end pass.

Expanded real runtime: **0 passed / 1 setup failure DATABASE_UNAVAILABLE**. New expiry/paging/stale-role/opt-out/vector-delete and production memory UI scenarios did not execute. Separate fresh offline npm ci: **ENOTCACHED**. Unit doubles test orchestration/contracts, not real locks, SQL syntax, vector relevance or durability. No failing tests were disabled or replaced with fake application behavior.

## 12. Remaining limitations and phase status
All eight phases remain open for full acceptance. Latest clean install, PostgreSQL/Redis/migrations/workers/recovery, Windows, live AI/embedding, safe Python execution, broader security/load and public deployment need actual verification. MFA/OAuth enrollment, advanced graph planning and full statistical/unit/chart semantics remain implementation/evaluation gaps detailed in KNOWN_LIMITATIONS.

Memory default cosine-distance cutoff 0.35 needs model-specific calibration. Expiry excludes context but retains stored content/embeddings; soft deletion clears vectors yet retains content. Physical erasure, backup retention and expiry cleanup need an explicit policy. Paging is bounded offset-based; highly concurrent/large datasets need measured index/keyset work. Production memory UI and transaction locks are not certified. No guaranteed ₹0 public hosting or entirely native-Windows production worker/scanner/executor is promised.

## 13. Environment variables
Optional new FABRIC_MEMORY_MAX_DISTANCE (0..2, default 0.35), startup validated. Existing credentials/provider/database/Redis/storage/embedding/scanner settings remain required for full runtime. No new required secret or package. .env.example documents the setting; never share live keys.

## 14. Deployment instructions
Keep the original installation/data/key backed up and unchanged. Extract separately and open the inner Fabric folder in VS Code. Windows local Ollama demo remains usable without Ubuntu/Docker on the PC; new memory features require the PostgreSQL runtime and genuine external services. No GitHub repository is required. Do not expose local demo/Ollama ports publicly or deploy before acceptance gates pass.

## 15. Recommended next improvements
Restore a real PostgreSQL/Redis test environment and registry access; run expanded runtime and production browser suites. Calibrate memory retrieval with reviewed live embeddings and define expiry/erasure/backup retention policy. Complete Windows/live models/dedicated sandbox/security/load/HTTPS/recovery gates. Keep blocked checks explicit rather than claiming all phases complete.
