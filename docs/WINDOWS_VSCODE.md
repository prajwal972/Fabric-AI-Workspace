# Windows 11 + VS Code: local use and service-backed use

This upgrade preserves Fabric's interface and local data. You do not need Ubuntu or Docker installed on your PC to launch the **local demo**. Local mode is not the PostgreSQL production runtime: it does not provide the production queues, quota admission, indexed RAG or durable agent engine.

## Protect the existing installation first

1. Stop Fabric with Ctrl+C and close any running debugger.
2. Back up the complete existing `fabric/data` directory, including its private `master.key`, if present. Do not share that backup or upload the key. Keep the original installation unchanged until migration is verified.
3. Extract the new source into a separate directory such as `C:\Projects\Fabric-upgrade`. Avoid OneDrive for credentials, plaintext backups and keys: local Windows ACLs do not protect cloud copies.
4. Open the inner **Fabric** directory in VS Code. Its `package.json`, `src`, `public` and `.vscode` must be directly visible. Do not run npm from the outer ZIP/extraction directory.
5. Dependencies are not bundled. In VS Code's PowerShell terminal, run:

```powershell
node --version
npm.cmd ci
npm.cmd run check
npm.cmd test
```

Node 24 is recommended. `npm ci` requires registry connectivity. A successful syntax check does not mean all tests or production features passed.

## Local Ollama demo: no Docker on your PC

- After backing up and stopping the original installation, copy your existing `data` directory into the new inner Fabric directory **once**, without merging or overwriting a new workspace. Include its original key; changing the key can make saved encrypted credentials unreadable. Keep the original backup.
- Choose **Run and Debug → Fabric — Local Windows (demo only)** and press F5.
- Open `http://127.0.0.1:8787` in your browser. The launch profile intentionally clears inherited database/Redis/storage values and binds only to your PC.
- Keep Ollama running. Use the existing Settings/Studio model connection and a model actually installed in Ollama. `ollama list` shows installed names. Your existing `qwen2.5-coder:3b` can be selected if it appears there; its quality/tool capabilities need actual evaluation.
- This starts the original local workspace behavior, **not** a public server. Do not expose port 8787 or Ollama's port to the internet, configure router forwarding, or use local mode as a multi-user production deployment.

The source package contains no personal conversations/files. Without copying your backed-up data or importing it, a separate source folder will not automatically find your original workspace.

## PostgreSQL runtime: external services still required

No Docker installation is required on your PC just to run the Node API/worker. However, these services must genuinely exist and be reachable:

- PostgreSQL with pgvector, a migration role and a restricted application login;
- Redis for BullMQ (a TCP Redis service, not an unrelated REST-only endpoint);
- a private S3-compatible bucket supporting the configured AES256 encryption;
- production malware scanning and the parser binaries needed for the uploaded formats;
- SMTP if verification/public registration or recovery is enabled;
- an appropriate embedding model returning exactly 768 dimensions for indexed RAG.

The full production parser/process-limit and isolated Python executor paths require a compatible secured worker/executor host. They are **not certified as entirely native Windows/Home functionality**. Missing safety controls must not be bypassed. Arbitrary Python execution stays disabled unless the existing dedicated executor requirements are met; the current executor transport also requires a Docker client on the executor-facing host. This is a remaining deployment constraint, not a promise of all capabilities running without supporting infrastructure.

The project includes deployment examples, not provisioned free accounts. A ₹0 budget does not guarantee sufficient hosted capacity, always-on services, public availability or isolated execution. Review actual service limits before choosing hosting. Cloud-provider admission defaults to disabled in production; that is not a guarantee that an operator-configured endpoint or hosting account has no charges.

## VS Code service-backed profiles

1. Create a private directory outside the source/OneDrive:

```powershell
New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\Fabric AI"
```

2. Create `postgres.env` there, using `.env.example` and `PRODUCTION_SETUP.md` as references. VS Code loads this file; plain `npm start` does not automatically load it. Use real endpoints and generated secrets, never the placeholders. Do not paste this file into chat or commit it. `NODE_ENV`, the public URL, upload scanning and registration must match the environment actually being deployed.
3. Apply **all migrations, including 007**, with the separate migration role. For a temporary terminal session, set `DATABASE_URL` to migration credentials and run `npm.cmd run db:migrate`; remove that variable when finished. The API/worker must use the restricted application role, not the migration/bootstrap role.
4. For existing JSON data, follow the dry-run-first import procedure in `PRODUCTION_SETUP.md`; do not simply rename `flux.json` or delete it. Import preserves originals and revokes old sessions. Verify imported content and original object bytes before switching installations.
5. In Run and Debug select **Fabric — PostgreSQL API + worker**. Both use the external `postgres.env`. The explicit API entry refuses a missing database URL rather than silently falling back to JSON.
6. Check liveness `/api/live` and readiness `/api/ready`. Readiness requires PostgreSQL, Redis, object storage **and a recent worker heartbeat**. Startup allows the API to listen before a worker starts, avoiding a launch-order deadlock; readiness stays 503 until a worker registers.
7. Complete the documented real-service/browser/live/security gates before public deployment. Do not treat the local test suite or a green liveness response as production certification.

## Windows backup-permission fix

See `WINDOWS_BACKUP_FIX.md`. On NTFS, private backup staging/publication now verifies current-user-only protected Windows ACLs rather than Unix mode bits. PowerShell/ACL failures stop publication. Native Windows verification remains pending; the packaged GitHub Actions Windows job has not been run here. No failing test was disabled.

## Safe model and memory expectations

On this 16 GB integrated-graphics device, start with a small installed model and one task at a time. This is a conservative operating recommendation, not a measured capacity guarantee. Indexed RAG additionally needs embeddings; a conversational model is not automatically an embedding provider. Pending/blocked indexing status is explicit. Long-term memories are explicit saves and can be disabled/deleted. Remote public hosting cannot reach your PC's `127.0.0.1` Ollama endpoint; never solve this by exposing Ollama publicly without a reviewed authenticated gateway and network boundary.


## Checkpoint 7 model and analytics behavior

In the **PostgreSQL service-backed runtime**, Ollama model metadata determines whether native chat tools are enabled. A model with no tool capability keeps text chat but shows a text-only status. Unavailable metadata does not fabricate support. `list_files` and `analyze_data` let general agents calculate bounded deterministic dataset results with provenance. These new production tools are not retrofitted into the preserved local JSON demo; selecting a coder model alone does not enable the full production architecture. Live Ollama/Windows verification is still required.


## Checkpoint 8 data and chart fixes

The shared parser and chart corrections apply to the local VS Code demo too: quoted multiline CSV keeps logical rows, negative values keep their sign, scatter uses actual X values, and explicit percent strings are interpreted as fractions. Old saved scatter charts without X coordinates must be regenerated; the renderer will explain that rather than fabricate coordinates.

Export CSV as UTF-8. Rename duplicate headers; malformed quotes, null bytes, invalid encoding and oversized/duplicate-source inputs fail clearly. Workbooks may merge compatible headers across worksheets; export incompatible sheets as separate datasets. Recalculate and save formulas in a spreadsheet application before upload; Fabric reads cached results and does not execute or refresh formulas. Keep the original workbook privately backed up. Nested JSON must be explicitly flattened for numerical analysis, though valid JSON document text remains available for RAG.

`npm.cmd run benchmark:analyst` uses synthetic local data and calls no AI provider. It measures parser/calculation/dashboard/HTML CPU work, not your Ollama latency or deployment capacity. Full public-production/Windows certification remains pending; these fixes do not remove infrastructure requirements.


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
