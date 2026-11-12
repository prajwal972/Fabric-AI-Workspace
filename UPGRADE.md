> Upgrade status: PostgreSQL-runtime implementation is now present. Read `docs/engineering/UPGRADE_REPORT.md`, `docs/KNOWN_LIMITATIONS.md` and `docs/PRODUCTION_SETUP.md` for current status. The material below describes the original/local build and historical checkpoints; it is not a production-readiness certification.

# Upgrade to Fabric 1.4.0

1. Stop Fabric.
2. Back up your existing `data/` directory.
3. Extract this release and replace the application files, but **keep your existing `data/` directory** if you want to preserve accounts, conversations, and encrypted credentials.
4. Keep the same `Fabric_MASTER_KEY` (or existing private `data/master.key`) while old encrypted credentials remain.
5. Start Fabric, open **Models**, choose **Configure**, select the preset matching the service that issued the key, verify the base URL, optionally enter a default model, and enter a replacement key only when rotating it.
6. Click **Validate**, then **Load models**. A 401, 403, 404, or 429 response now displays a specific explanation instead of a generic error.

## Security note

The uploaded 1.0.1 archive contained a runtime `data/master.key`. This clean release never includes runtime data or keys. If that earlier archive was shared anywhere untrusted, rotate provider API keys. To rotate the local encryption key safely: remove/re-add encrypted provider credentials, stop Fabric, replace the master key, restart, and add the new provider keys.
