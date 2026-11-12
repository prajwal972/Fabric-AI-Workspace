# Database and migrations

Migrations live in `migrations/` and are checksum-verified by `scripts/migrate.mjs` under a PostgreSQL advisory lock.

```bash
DATABASE_URL=... npm run db:migrate
DATABASE_URL=... npm run db:rollback
```

Never edit an applied migration. Add a new numbered migration with a tested `.down.sql` file. Rehearse forward and rollback migrations against a restored production-sized staging copy. The initial schema includes relational integrity, workspace indexes, sessions, encrypted-secret references, jobs, usage, audit events, and idempotency keys.

The current API repository migration is incomplete; see `KNOWN_LIMITATIONS.md`.
