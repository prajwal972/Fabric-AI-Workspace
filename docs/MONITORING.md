# Monitoring and alerting

Scrape `/api/metrics` with `Authorization: Bearer $FABRIC_METRICS_TOKEN`. Alerts are in `monitoring/alerts.yml`.

Recommended dashboards: request rate/error/latency; active generations; provider failure/latency/token/cost; PostgreSQL pool/query latency; Redis health; queue depth/retries/dead letters; S3 errors; uploads scanned/rejected; voice latency/failure; process CPU/memory/event-loop lag.

Never log credentials, cookies, raw authorization headers, document content, voice audio, or sensitive personal data. Send security audit events to immutable retention storage.
