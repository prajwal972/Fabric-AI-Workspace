# Environment reference

`.env.example` is authoritative. Required production groups are:

- Core: `FABRIC_MASTER_KEY`, `FABRIC_PUBLIC_URL`, host/port, metrics token.
- Data: `DATABASE_URL`, `REDIS_URL`, S3 endpoint/bucket/credentials.
- Uploads: scan mode, ClamAV binary, worker limits.
- Voice: Azure key/region only when Azure is enabled; automatic three-locale detection is opt-in.
- OAuth: provider client IDs/secrets only for enabled connectors.
- Native: four approved SHA-256 digests and download limits.

Secret values must come from a secret manager. Configuration changes require staging verification and rollback notes.
