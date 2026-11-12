# Deployment runbook

**Status:** staging/deployment candidate. Complete `KNOWN_LIMITATIONS.md` release gates before production approval.

## Runtime requirements

Node 24 recommended (supported engine >=22.12), PostgreSQL 16 with pgvector 0.8+, Redis/BullMQ, private S3-compatible storage supporting AES256 server-side encryption, HTTPS ingress, up-to-date ClamAV, and worker parser tools (`pdftotext`, Python + python-docx, Tesseract, FFprobe, prlimit).

```sh
npm ci
npm run check
npm test
npm audit --audit-level=high
```

Provide secrets through the deployment secret manager, not committed `.env` files. Required API/worker configuration:

- `NODE_ENV=production`, `FABRIC_PUBLIC_URL=https://your-canonical-origin`, `FABRIC_MASTER_KEY` (random >=32 characters)
- `DATABASE_URL` for a non-superuser application role
- `REDIS_URL` with scoped network/authentication controls
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, scoped `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`
- `FABRIC_METRICS_TOKEN` (generated >=32-character secret), `FABRIC_UPLOAD_SCAN_MODE=required`
- Optional `FABRIC_SMTP_URL` / `FABRIC_EMAIL_FROM` for verification/recovery
- Reviewed `FABRIC_TRUSTED_MODEL_ORIGINS` for private model gateways; workspace owners cannot authorize arbitrary private networks
- `FABRIC_MODEL_PRICING_JSON`: e.g. `{"your-model":{"inputPerMillion":1,"outputPerMillion":2,"version":"your-reviewed-price-date"}}`. These are example rates, not real provider pricing.
- Limits: `MAX_AGENT_STEPS=8`, `MAX_TOOL_EXECUTION_TIME=30000`, `MAX_TOTAL_RUNTIME=120000`, worker concurrency/timeouts as documented in `.env.example`

## Database bootstrap and roles

Provision the `vector` extension with a migration/DBA role. Run migrations with separate migration credentials:

```sh
DATABASE_URL="$FABRIC_MIGRATION_DATABASE_URL" npm run db:migrate
```

Create a restricted application login through the secret manager/DBA. Grant connect/schema usage and DML only on application tables, sequence access where required, and SELECT on `schema_migrations`. Do not grant superuser, BYPASSRLS, server-file or server-program roles. The production application rejects superuser/BYPASSRLS credentials.

The migration runner owns DDL transactions and verifies file checksums. Never edit an already-applied migration. Use new migrations for subsequent releases. Startup verifies that every shipped migration has been applied.

## Storage and scanning

Provision the bucket before startup: public access blocked, encrypted at rest, lifecycle/versioning/backup policy configured. The application sends SSE-S3 AES256 on uploads. Deploy ClamAV inside the private network; `deployment/clamd.conf` connects the client to `clamav:3310` and streams bytes (no shared host path). Configure daemon scan/stream/recursion limits and update definitions; the compose file alone does not certify those controls.

## Start API and worker

```sh
npm start
npm run worker
```

API liveness: `/api/live`. Infrastructure and active-worker readiness: `/api/ready`. A worker heartbeat must register before readiness becomes green; `/api/live` remains independent. Expired worker registrations are removed using Redis server time (45-second expiry). A heartbeat is process/queue-connectivity evidence, not proof of successful job completion. Prometheus: `/api/metrics`, authenticated with the metrics bearer token. Configure TLS and trusted ingress timeouts for SSE. Do not enable public monitoring endpoints or expose database/Redis/object-storage ports.

For compose, set immutable digest-pinned `POSTGRES_IMAGE` (a pgvector PostgreSQL image), `REDIS_IMAGE`, `CLAMAV_IMAGE`, `FABRIC_VERSION`, bootstrap database/Redis passwords, application and migration URLs, and the external S3 credentials:

```sh
docker compose -f docker-compose.production.yml config --quiet
docker compose -f docker-compose.production.yml up -d --build
```

The supplied compose syntax is validated. Actual image build/start, resource sizing and host security remain target-environment release gates. `docker-compose.yml` is local-demo-only.

## Legacy migration

Stop the original app and take verified backups of `flux.json`, upload bytes and its master key. Use a fresh migrated target database. Supply `FABRIC_LEGACY_MASTER_KEY` and the new `FABRIC_MASTER_KEY` securely.

```sh
npm run db:import -- --source=/secure-backup/flux.json --data-dir=/secure-backup/data
# Review dry-run counts, references and credentials before applying.
npm run db:import -- --source=/secure-backup/flux.json --data-dir=/secure-backup/data --apply
```

Import is transactional, re-encrypts credentials, uploads original bytes, creates real processing/outbox jobs, preserves IDs/content/provenance, and leaves source untouched. All old sessions are revoked; users sign in again. Historical non-resumable runs/workflows are retained in an encrypted import archive. Never copy a legacy store into production and treat it as the new persistence layer.

## Optional isolated Python and SQL

Python remains unavailable by default. On a dedicated executor plane with full CPU/memory/PID cgroups, configure a digest-pinned `FABRIC_SANDBOX_IMAGE`, explicitly set `FABRIC_SANDBOX_DEDICATED_HOST=1`, and set `FABRIC_SANDBOX_DOCKER_HOST` plus `DOCKER_TLS_VERIFY=1` and private `DOCKER_CERT_PATH` client certificates. Only a remote `tcp://host:port` transport is accepted; local sockets, loopback endpoints, URL credentials and unauthenticated transports fail closed. Endpoint DNS/actual host separation and certificate identity must still be reviewed by the operator. Use the optional `sandbox-worker` image target for a Docker CLI. Never mount the production Docker socket or place application secrets on the executor host. Code transfers via stdin; no host filesystem is mounted. Verify forbidden network/filesystem access, CPU/RAM limits, cancellation, output limits and cleanup on the real host.

SQL requires a separate read-only `FABRIC_ANALYTICS_DATABASE_URL` and `FABRIC_ANALYTICS_WORKSPACE_ID`; never reuse the production application credentials. Use explicitly schema-qualified analytics tables/views. The deliberately conservative dialect permits reviewed aggregates/scalars but rejects arbitrary functions, quoted identifiers, casts, comments, multi-statements and server-catalog reads. Function resolution is pinned to pg_catalog, and in-flight cancellation targets the analytics connection, not the production pool. Real disposable-role/database tests pass; verify the target role grants/data boundaries separately.

## Release approval

Run real-service integration, both browser suites, live provider evaluations, malware/security tests, restore drills, graceful shutdown/failure injection and realistic latency/capacity tests. Do not label the application production-ready based on protocol fixtures or page-load smoke tests.

## Memory backfill and model changes

Saving memory creates a durable background indexing job; saving the explicit fact does not depend on a provider responding synchronously. In Settings → Memory, use **Index pending memories (up to 50)** for imported/pending facts. Missing providers fail the indexing job honestly while preserving the explicit saved fact.

The authenticated `POST /api/memory/reindex` accepts `{limit:50,afterId?:string,force?:boolean}` and returns a real job ID. Job output contains indexed/skipped counts and an optional next cursor; repeat bounded batches as needed. `force:true` explicitly reindexes with the selected embedding model. Users index only their own personal/conversation facts; workspace facts require admin rights. Expired/deleted/other-user memories are excluded. Sensitive imported text is skipped before provider transmission; review/remove those facts. Disabling memory prevents retrieval and subsequent vector writes. Never treat a completed indexing job as a semantic-quality evaluation.

Redis producers use `FABRIC_REDIS_COMMAND_TIMEOUT_MS` (default 5000; validated 100–10000) and bounded retries rather than indefinitely holding requests/transactions. Worker connections retain BullMQ-required reconnect behavior.

## Encrypted database backups and restore drills

Run backup/restore from a secured operator host with Node and a PostgreSQL client matching the server major version. API images deliberately do not carry database-administration client tools. Use a dedicated backup/restore database role appropriate to each operation, not the API account. Keep the encryption key separately in the secret manager; key-file access must be private.

```sh
# Provide DATABASE_URL, BACKUP_DIR and a private >=32-byte key file via secrets/configuration.
export FABRIC_BACKUP_ENCRYPTION_KEY_FILE=/secure/key-file
bash scripts/backup.sh
# Verify the isolated target and backups before explicit destructive restore approval:
FABRIC_RESTORE_CONFIRM=RESTORE bash scripts/restore.sh /secure/archive.dump.enc
```

Connection passwords are passed via PostgreSQL environment variables, not command arguments. Dumps use unique private temporary names and are removed on failure. Decryption publishes plaintext only after successful authentication, with mode 0600; corrupted input never replaces an existing output. Restore verifies the selected archive’s checksum even after relocation, requires explicit confirmation, uses exit-on-error/single-transaction pg_restore, then validates/applies migrations. A local disposable drill passed, but schedule target-host restore exercises and document RPO/RTO.

PostgreSQL archives contain metadata, not S3 file bytes or Redis live execution state. Independently protect/restore object storage and encryption/master keys, quiesce writes during coordinated snapshots, review in-flight runs instead of replaying unknown writes, and verify application readiness/permissions after restore. Optional S3 archive upload requires AWS CLI installed on the operator host; it is not tested here.

Startup rejects copied placeholder/repeated production master or metrics secrets, invalid service URL protocols and attempts to make production scanning optional. Analytics URLs matching the application database (including common loopback aliases) are rejected. DNS aliases and target-role grants still require operator review. SQL output supports bounded standard scalar/array types with exact bigint/numeric decoding; unsupported custom types and ambiguous output columns fail clearly.


## Durable storage deletion (checkpoint 4: real-service revalidation required)

`DELETE /api/files/:id` and `DELETE /api/artifacts/:id` logically remove access immediately and return `{ok,cleanupJobId,storageStatus}`. A PostgreSQL transaction persists tombstone/audit/job/outbox; file deletion also removes RAG chunks and requests cancellation of in-flight file-processing jobs. Inspect `GET /api/jobs/:cleanupJobId` for **completed** before claiming physical deletion. The worker removes original/extracted file objects or the artifact object idempotently. Failure is visible as **dead_letter**, not silently swallowed.

Mandatory `storage-delete` jobs cannot be cancelled. Owners/admins may call `POST /api/jobs/:failedCleanupJobId/retry-cleanup` with the normal session/CSRF headers; it returns `{jobId,status}`. Repeating the same retry returns that retry job rather than duplicating it. A later failed retry may itself be retried by its new ID. This endpoint does not replay arbitrary external actions or agent writes. Cleanup can finish after the original deleting member is revoked, but only for an existing scoped tombstone; it cannot delete live metadata.

`FABRIC_JOB_TIMEOUT_MS` defaults to 300000 (validated 1000–600000); `FABRIC_JOB_LOCK_MS` defaults to 30000 (1000–600000), renewed by BullMQ. `FABRIC_DB_POOL_MAX` defaults to 10 (3–100) and must be at least `FABRIC_WORKER_CONCURRENCY + 2` so leases cannot consume all connections. Worker timeouts are cooperative signals; untrusted code still requires the dedicated sandbox's enforced process/resource deadline. SDK object operations receive abort signals.

Only handlers with durable/idempotent recovery receive automatic transient retries. Notifications/reports lack destination-side idempotency and fail for review after one attempt. Stalled deliveries are not automatically replayed; review `JOB_INTERRUPTED_OUTCOME_UNKNOWN` and restore/reconcile queue/database state. No general exactly-once guarantee is made. Historical tombstones, object creation crash windows, failed compensation, S3 object versions/retention and coordinated recovery still need operational reconciliation.


## Public-use admission and Windows operator setup (checkpoint 5)

Use `WINDOWS_VSCODE.md` for the two distinct VS Code profiles. Windows local demo does not inherit production PostgreSQL features, and no free hosting or all-native-Windows production guarantee is made. External services can avoid installing Docker on the user's PC, but compatible worker/parser/executor infrastructure is still required.

Apply migration **007** before starting this source. Production/staging default to `FABRIC_REGISTRATION_MODE=closed`, `FABRIC_ALLOW_CLOUD_AI=false`, `FABRIC_REQUIRE_EMAIL_VERIFICATION=true`, `FABRIC_AI_USER_DAILY_REQUESTS=25`, `FABRIC_AI_WORKSPACE_DAILY_REQUESTS=100`, and `FABRIC_AI_MAX_OUTPUT_TOKENS=4096`. Review `.env.example` values for the actual environment. Closed registration preserves sign-in for existing/imported accounts. Opening production registration requires email verification and configured SMTP/from address; missing configuration fails startup. SMTP delivery itself must be tested.

AI admission checks fresh membership, verified email when required, current provider scope/enabled/type, and atomic PostgreSQL UTC daily counters before each provider attempt/embedding batch. Tool rounds and retries also count; failed admitted attempts are not refunded. These are request bounds, **not a money cap**, concurrency entitlement, hosted-service credit guarantee or universal network egress block. Local provider endpoints still require operator-reviewed access controls. Quota counters do not limit all voice, research, connector, storage or email activity. Remote speech services are disabled by the cloud flag in the voice service; browser/device recognition has its own privacy/service behavior.

Configure a verification-capable mail service or provision previously verified accounts through a reviewed administrative/import process. Do not disable verification simply to expose open production registration. Native Windows ACL/CI, migration 007, quota concurrency and new worker readiness require actual target/real-service tests before approval.
