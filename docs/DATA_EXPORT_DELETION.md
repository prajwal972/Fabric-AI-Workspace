# User-data export and deletion

Self-service export/deletion APIs are not yet implemented and are a production blocker. The final workflow must authenticate the requester, require recent reauthentication, include workspace-scoped database records and object files, produce a signed expiring export, record an audit event, honor legal holds, delete primary data transactionally, enqueue object cleanup, and document backup expiration. Test cross-workspace isolation and idempotent retries.
