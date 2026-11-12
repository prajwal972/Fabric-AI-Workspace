import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runMigrations } from '../src/database/migrations.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
  ssl: process.env.PGSSLMODE === 'disable' ? false : undefined,
});
try {
  const changed = await runMigrations({
    pool, directory: path.join(root, 'migrations'),
    rollback: process.argv.includes('--rollback'),
    onApplied: (version, rollback) => console.log(`${rollback ? 'Rolled back' : 'Applied'} ${version}`),
  });
  if (!changed.length) console.log('No migrations to apply.');
} finally { await pool.end(); }
