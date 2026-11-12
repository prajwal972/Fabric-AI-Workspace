import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
export function postgresClientEnvironment(databaseURL, base = process.env) {
  const url = new URL(databaseURL);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("PostgreSQL URL required");
  const decode = (value) => decodeURIComponent(value);
  const database = decode(url.pathname.slice(1));
  if (!database || !url.hostname)
    throw new Error("A hosted PostgreSQL database URL is required");
  const env = {
    ...base,
    PGHOST: url.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: url.port || "5432",
    PGDATABASE: database,
    PGUSER: decode(url.username),
    PGPASSWORD: decode(url.password),
  };
  const options = {
    sslmode: "PGSSLMODE",
    sslrootcert: "PGSSLROOTCERT",
    sslcert: "PGSSLCERT",
    sslkey: "PGSSLKEY",
    connect_timeout: "PGCONNECT_TIMEOUT",
    options: "PGOPTIONS",
  };
  for (const [name, value] of url.searchParams) {
    if (!options[name])
      throw new Error("Unsupported PostgreSQL backup connection option");
    env[options[name]] = value;
  }
  return env;
}
async function main() {
  const [mode, file] = process.argv.slice(2);
  if (!["dump", "restore"].includes(mode) || !file || !process.env.DATABASE_URL)
    throw new Error("Database operation configuration required");
  const env = postgresClientEnvironment(process.env.DATABASE_URL),
    args =
      mode === "dump"
        ? ["--format=custom", "--no-owner", "--no-privileges"]
        : [
            "--exit-on-error",
            "--single-transaction",
            "--clean",
            "--if-exists",
            "--no-owner",
            "--no-privileges",
            "--dbname",
            env.PGDATABASE,
            file,
          ];
  const output = mode === "dump" ? await fs.open(file, "w", 0o600) : null;
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(mode === "dump" ? "pg_dump" : "pg_restore", args, {
        env,
        stdio: ["ignore", output ? output.fd : "ignore", "pipe"],
      });
      child.stderr.resume();
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0
          ? resolve()
          : reject(new Error("PostgreSQL operation failed")),
      );
    });
  } finally {
    await output?.close();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch(() => {
    console.error(
      "PostgreSQL backup/restore failed. Verify client/server versions, restricted credentials, connectivity and target permissions.",
    );
    process.exitCode = 1;
  });
