# Changelog

## 1.10.1 production-hardening work in progress

- Added fail-safe JSON recovery and last-known-good backups.
- Added native artifact SHA-256 verification and archive limits.
- Added RBAC enforcement, centralized HTTP headers, Argon2id, least-privilege connector scopes, plugin action allowlists, and prompt trust boundaries.
- Added pinned dependencies, normalized PostgreSQL migration, Redis queue and S3 adapters, worker scaffold, production Compose, and CI security gates.
- Added file-type inspection, executable blocking, ClamAV fail-closed production gate, bounded text/XLSX extraction, and formula neutralization.
- Added readiness/liveness, graceful shutdown, structured logs, Prometheus metrics, alerts, and authenticated encrypted backups.
- Improved keyboard conversation controls, dialog focus behavior, and voice privacy defaults.

This version remains pre-production until `KNOWN_LIMITATIONS.md` blockers are closed.
