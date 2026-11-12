# Foundation checkpoint source changes

## Modified
- `.dockerignore`
- `.env.example`
- `.github/workflows/ci.yml`
- `.gitignore`
- `README.md`
- `docker-compose.production.yml`
- `docs/KNOWN_LIMITATIONS.md`
- `package-lock.json`
- `package.json`
- `public/app.js`
- `scripts/migrate.mjs`
- `src/security/rbac.mjs`
- `src/server.mjs`
- `test/file-security.test.mjs`
- `test/http-hardening.test.mjs`

## Added
- `docs/engineering/AUDIT-v1.10.4.md`
- `docs/engineering/FOUNDATION_REPORT.md`
- `docs/engineering/IMPLEMENTATION_PLAN.md`
- `integration/browser.spec.mjs`
- `integration/postgres.integration.mjs`
- `migrations/002_conversation_tenant_integrity.down.sql`
- `migrations/002_conversation_tenant_integrity.sql`
- `playwright.config.mjs`
- `scripts/check.mjs`
- `src/database/migrations.mjs`
- `src/database/transaction.mjs`
- `src/repositories/conversation.mjs`
- `src/server/config.mjs`
- `src/server/errors.mjs`
- `src/server/security-headers.mjs`
- `src/services/conversation.mjs`
- `test/chat-cancellation.test.mjs`
- `test/foundation.test.mjs`

## Verification artifacts
`reports/foundation/` contains logs, a inspected UI screenshot, this inventory and changes.patch. Existing older reports are historical, not current certification.
