import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const LEDGER =
  "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())";
const LOCK = 7_413_321;

// Preserve existing on-disk SQL/checksums. The runner, not a migration file,
// owns the transaction so DDL and ledger updates commit or roll back together.
function migrationBody(sql) {
  return sql.replace(/^\s*BEGIN\s*;/i, "").replace(/COMMIT\s*;\s*$/i, "");
}

export async function runMigrations({
  pool,
  directory,
  rollback = false,
  onApplied = () => {},
}) {
  const client = await pool.connect();
  let locked = false;
  const changed = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK]);
    locked = true;
    await client.query(LEDGER);
    const files = (await fs.readdir(directory))
      .filter(
        (name) => /^\d+_.+\.sql$/.test(name) && !name.endsWith(".down.sql"),
      )
      .sort();
    const applied = new Map(
      (
        await client.query("SELECT version, checksum FROM schema_migrations")
      ).rows.map((row) => [row.version, row.checksum]),
    );
    const targets = rollback ? [...applied.keys()].sort().slice(-1) : files;
    for (const version of targets) {
      if (!/^\d+_[\w.-]+\.sql$/.test(version))
        throw new Error("Invalid migration version");
      const original = await fs.readFile(path.join(directory, version), "utf8");
      const checksum = crypto
        .createHash("sha256")
        .update(original)
        .digest("hex");
      if (applied.has(version) && applied.get(version) !== checksum)
        throw new Error(`Applied migration checksum changed: ${version}`);
      if (!rollback && applied.has(version)) continue;
      const sql = rollback
        ? await fs.readFile(
            path.join(directory, version.replace(/\.sql$/, ".down.sql")),
            "utf8",
          )
        : original;
      await client.query("BEGIN");
      try {
        await client.query(migrationBody(sql));
        if (rollback) {
          // The historic initial down script drops the ledger itself.
          await client.query(LEDGER);
          await client.query(
            "DELETE FROM schema_migrations WHERE version = $1",
            [version],
          );
        } else {
          await client.query(
            "INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)",
            [version, checksum],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      }
      changed.push(version);
      onApplied(version, rollback);
    }
    return changed;
  } finally {
    if (locked)
      await client
        .query("SELECT pg_advisory_unlock($1)", [LOCK])
        .catch(() => {});
    client.release();
  }
}

export async function verifyMigrations(pool, directory) {
  const files = (await fs.readdir(directory))
    .filter((n) => /^\d+_.+\.sql$/.test(n) && !n.endsWith(".down.sql"))
    .sort();
  let applied;
  try {
    applied = new Map(
      (
        await pool.query("SELECT version,checksum FROM schema_migrations")
      ).rows.map((r) => [r.version, r.checksum]),
    );
  } catch (error) {
    if (["42P01", "3F000"].includes(error.code))
      throw Object.assign(
        new Error(
          "Database migrations are required. Run npm run db:migrate before startup.",
        ),
        { code: "DATABASE_MIGRATIONS_REQUIRED" },
      );
    if (error.code === "42501")
      throw Object.assign(
        new Error(
          "The application database role cannot read the migration ledger. Review its grants.",
        ),
        { code: "DATABASE_PERMISSION_DENIED" },
      );
    throw Object.assign(
      new Error(
        "The application database is unavailable. Check service readiness and connection configuration.",
      ),
      { code: "DATABASE_UNAVAILABLE" },
    );
  }
  for (const version of files) {
    const sum = crypto
      .createHash("sha256")
      .update(await fs.readFile(path.join(directory, version)))
      .digest("hex");
    if (applied.get(version) !== sum)
      throw new Error(
        "Database migration missing or changed: " +
          version +
          ". Run npm run db:migrate.",
      );
  }
}
