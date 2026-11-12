> Upgrade status: PostgreSQL-runtime implementation is now present. Read `docs/engineering/UPGRADE_REPORT.md`, `docs/KNOWN_LIMITATIONS.md` and `docs/PRODUCTION_SETUP.md` for current status. The material below describes the original/local build and historical checkpoints; it is not a production-readiness certification.

# Fabric 1.10.1 hardening — final execution report

## Outcome

This work produced a **hardened preview, not a production-ready release**. The source remains fully test-green and several critical controls were implemented, but required external and architectural release gates could not be truthfully passed in this environment. In particular, API route persistence still uses the guarded JSON development store rather than the new normalized PostgreSQL repositories. Multi-replica production launch is prohibited.

## Implemented improvements

- Fail-safe store loading, corruption preservation, last-known-good backup, durable writes, and recovery tests.
- SHA-256 enforcement for native runtimes/models in production, download/archive limits, and integrity tests.
- Argon2id for new passwords with legacy scrypt verification/upgrade.
- Deny-by-default RBAC route classification, owner/admin protections, centralized security headers, Origin+CSRF checks.
- Least-privilege OAuth scopes and fixed connector action allowlists; arbitrary client path/method/body execution removed.
- Untrusted research, plugin, and file evidence moved out of the system message and explicitly labeled.
- Pinned npm lockfile; no known high/critical npm advisory.
- Normalized PostgreSQL schema and reversible migration, Redis/BullMQ and S3 adapters, worker scaffold, production Compose, immutable-version requirements, and CI security gates.
- Content inspection, executable upload blocking, production ClamAV fail-closed gate, bounded text extraction, streamed XLSX parsing, and spreadsheet formula neutralization.
- Liveness/readiness, graceful shutdown, structured request logs, Prometheus metrics, alert rules, encrypted authenticated backups, restoration guard, SBOM, and coverage evidence.
- Keyboard-operable conversation controls, accessible dialog focus handling, visible focus indicators, and lower-exposure voice language defaults.
- Production, local development, architecture, threat, security, environment, migration, backup, deployment, monitoring, incident, plugin, AI safety, privacy, testing, release, rollback, limitations, and changelog documents.

## Architecture before and after

**Before:** browser SPA → one Node process → in-memory arrays → atomic JSON file and local uploads; in-process extraction/jobs; local sessions/rates; ad hoc logs.

**Target foundation added:** browser/API with RBAC → PostgreSQL schema → Redis sessions/rates/queues → durable workers → S3 object storage → providers/plugins through policy boundaries → metrics/logs/alerts/backups.

**Important:** the running API has not yet been rewritten onto PostgreSQL repositories. The target services are configured and health-checked but are not the source of truth for route data.

## Security finding status

| Audit finding | Status |
|---|---|
| C-01 unverified native binaries | Mitigated: production digest required; signature/provenance verification still recommended |
| C-02 silent JSON data loss | Mitigated for development store; production PostgreSQL route migration still open |
| H-01 missing RBAC | Implemented at route-permission boundary; full HTTP role matrix still required |
| H-02 SSRF rebinding | Partial: safe-http DNS check and redirect denial improved; socket pinning/egress proxy required |
| H-03 arbitrary plugin action | Fixed for current connector execution; refresh/revocation/confirmation framework remains |
| H-04 prompt injection trust boundary | Mitigated with instruction/evidence separation; formal eval suite remains |
| H-05 upload security/DoS | Substantially improved; parser-worker isolation remains |
| H-06 production data/distributed jobs | Foundation added; API repository integration remains open |
| H-07 account/session lifecycle | Argon2id/RBAC improved; MFA/recovery/export/deletion remain open |
| H-08 AI quotas/resilience | Open: full quota ledger, cost policy, circuit breaker, fallback orchestration |
| H-09 misleading capabilities | XLSX parsing implemented and workflow status documented; contract tests should expand |
| H-10 CI/CD release gates | Pipeline added but not executed in this environment |

## Exact local verification

- Syntax checks: passed.
- Automated tests: **91 passed, 0 failed, 0 skipped, 0 todo**.
- Test duration: approximately 8–10 seconds depending on coverage instrumentation.
- Coverage: **76.25% lines, 63.25% branches, 47.71% functions** overall.
- Important weak path: `src/server.mjs` 44.35% line and 5.79% function coverage.
- npm audit: **0 critical, 0 high, 2 moderate**. Both moderate findings are in ExcelJS's private UUID dependency.
- Candidate secret scan in the original audit: 0 candidates.
- SBOM: generated as SPDX JSON.
- Backup crypto: round-trip and tamper rejection passed.

## Checks not completed

- Container build and image scan: Docker/Trivy unavailable locally.
- PostgreSQL migration/rollback and backup restoration against a real server: unavailable.
- Redis queue crash recovery and S3 integration: services unavailable.
- Browser E2E, axe, screen reader, and measured contrast: not run.
- Load/performance targets: not run; no capacity claim is made.
- Live cloud provider, Azure Speech, and OAuth certification: credentials/services unavailable.
- Staging/production deployment and automated rollback: not run.

## Release gate result

**FAILED / NOT EXECUTED:** production launch is blocked by the repository migration and unexecuted infrastructure, browser, load, container, restoration, and deployment gates. Fabric must not be labeled production-ready.

## Required next implementation work

1. Replace direct `db.*` array access in all routes with transaction-scoped PostgreSQL repositories; migrate JSON data with dry-run counts/checksums; add optimistic concurrency and pagination tests.
2. Move sessions and all rate limits to Redis; route file metadata/object bytes and extraction through S3 plus durable workers.
3. Add account recovery, email verification, MFA, session/device administration, export, deletion, and legal-hold behavior.
4. Implement OAuth refresh/revocation and confirmation grants for every external write.
5. Add socket-pinned egress or a mandatory egress proxy; run prompt-injection and SSRF regression suites.
6. Run CI, container scan, staging migrations, rollback, restoration, browser/accessibility, workspace isolation, and load tests; retain artifacts.

## Launch and rollback

There are no production launch instructions because the release gate failed. For continued development, use `docs/LOCAL_DEVELOPMENT.md`. Staging preparation is in `docs/PRODUCTION_SETUP.md`. Rollback checkpoints are the `phase-*` Git tags, with `audit-baseline-v1.10.1` as the original source baseline. Database rollback and operational rollback procedures are documented in `docs/DATABASE.md` and `docs/ROLLBACK.md`.
