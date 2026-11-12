# Deployment runbook

1. Confirm release commit, checksum, SBOM, scans, approvals, and rollback image/database point.
2. Back up and verify checksum; record PostgreSQL WAL/PITR position.
3. Deploy migrations as a single controlled job.
4. Deploy workers, then API canary using an immutable image digest.
5. Check readiness, logs, metrics, login, workspace isolation, chat cancellation, upload scanning, and a job.
6. Increase traffic gradually while watching error rate, latency, DB, Redis, queue, provider, and voice metrics.
7. Roll back automatically on readiness failure, elevated 5xx, migration incompatibility, or data-integrity alarms.

Never use `latest` as the sole identifier. Keep the previous image and compatible down migration available.
