import { spawn } from "node:child_process";
import crypto from "node:crypto";
import pg from "pg";
import { AppError } from "../server/errors.mjs";
import { validateAnalyticsSQL } from "./sql-policy.mjs";
import { boundedSQLProjection, decodeSQLRows } from "./sql-results.mjs";
export class PythonSandbox {
  constructor(env = process.env) {
    this.env = env;
  }
  async execute({ code }, { signal, executionId }) {
    const image = this.env.FABRIC_SANDBOX_IMAGE,
      host = this.env.FABRIC_SANDBOX_DOCKER_HOST;
    if (!image)
      throw new AppError(
        "SANDBOX_UNAVAILABLE",
        "An isolated Python sandbox image is not configured.",
        503,
      );
    if (!/@sha256:[a-f0-9]{64}$/.test(image))
      throw new AppError(
        "SANDBOX_IMAGE_UNPINNED",
        "The sandbox image must be pinned by digest.",
        503,
      );
    if (!host || this.env.FABRIC_SANDBOX_DEDICATED_HOST !== "1")
      throw new AppError(
        "SANDBOX_UNAVAILABLE",
        "A dedicated isolated executor host must be explicitly configured.",
        503,
      );
    // A dedicated-host acknowledgement alone must not enable an unauthenticated
    // remote Docker daemon or accidentally select the API host's local socket.
    let endpoint;
    try {
      endpoint = new URL(host);
    } catch {}
    const executorHostname = (endpoint?.hostname || "")
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, "");
    const loopbackExecutor =
      /^(?:127(?:\.|$)|0(?:\.|$)|::(?:1|ffff:(?:127\.|7f)))/.test(
        executorHostname,
      ) ||
      executorHostname === "localhost" ||
      executorHostname.endsWith(".localhost") ||
      /^\d+$/.test(executorHostname);
    if (
      !endpoint ||
      endpoint.protocol !== "tcp:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      (endpoint.pathname && endpoint.pathname !== "/") ||
      !endpoint.hostname ||
      !endpoint.port ||
      loopbackExecutor ||
      this.env.DOCKER_TLS_VERIFY !== "1" ||
      !this.env.DOCKER_CERT_PATH
    ) {
      throw new AppError(
        "SANDBOX_TRANSPORT_UNSAFE",
        "The dedicated executor requires a remote TCP endpoint with verified TLS and client certificates. Local sockets and unauthenticated transports are not supported.",
        503,
      );
    }
    signal?.throwIfAborted();
    const name = "fabric-sandbox-" + crypto.randomUUID(),
      started = Date.now();
    const clientEnv = {
      PATH: process.env.PATH,
      DOCKER_HOST: host,
      ...(this.env.DOCKER_TLS_VERIFY
        ? {
            DOCKER_TLS_VERIFY: this.env.DOCKER_TLS_VERIFY,
            DOCKER_CERT_PATH: this.env.DOCKER_CERT_PATH,
          }
        : {}),
    };
    return new Promise((resolve, reject) => {
      // Code goes over stdin. No host path is mounted, including on remote executors.
      const child = spawn(
        this.env.FABRIC_CONTAINER_BIN || "docker",
        [
          "run",
          "--rm",
          "--interactive",
          "--name",
          name,
          "--network",
          "none",
          "--read-only",
          "--user",
          "65534:65534",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--pids-limit",
          "64",
          "--cpus",
          "1",
          "--memory",
          "256m",
          "--memory-swap",
          "256m",
          "--tmpfs",
          "/tmp:rw,size=64m,noexec,nosuid,nodev",
          image,
          "python",
          "-I",
          "-B",
          "-c",
          'import sys; exec(compile(sys.stdin.read(), "<fabric-task>", "exec"))',
        ],
        { stdio: ["pipe", "pipe", "pipe"], env: clientEnv },
      );
      let stdout = "",
        stderr = "",
        settled = false;
      const stop = () => {
        const removal = spawn(
          this.env.FABRIC_CONTAINER_BIN || "docker",
          ["rm", "-f", name],
          { stdio: "ignore", env: clientEnv },
        );
        removal.on("error", () => {});
        const cleanup = setTimeout(() => removal.kill("SIGKILL"), 5000);
        removal.once("close", () => clearTimeout(cleanup));
        child.kill("SIGKILL");
      };
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        error ? reject(error) : resolve(result);
      };
      const abort = () => {
        stop();
        finish(new AppError("SANDBOX_CANCELLED", "Execution cancelled.", 499));
      };
      const timer = setTimeout(
        () => {
          stop();
          finish(
            new AppError(
              "SANDBOX_TIMEOUT",
              "Execution exceeded its time limit.",
              504,
            ),
          );
        },
        Math.min(30000, Number(this.env.MAX_TOOL_EXECUTION_TIME || 30000)),
      );
      const capture = (kind, chunk) => {
        if (kind === "out") stdout += chunk;
        else stderr += chunk;
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 100000) {
          stop();
          finish(
            new AppError(
              "SANDBOX_OUTPUT_LIMIT",
              "Execution output exceeded its limit.",
              422,
            ),
          );
        }
      };
      child.stdout.on("data", (c) => capture("out", c));
      child.stderr.on("data", (c) => capture("err", c));
      child.stdin.on("error", () => {});
      child.stdin.end(code);
      child.on("error", () =>
        finish(
          new AppError(
            "SANDBOX_UNAVAILABLE",
            "The isolated execution service is unavailable.",
            503,
          ),
        ),
      );
      child.on("close", (exitCode) =>
        exitCode === null || exitCode >= 125
          ? finish(
              new AppError(
                "SANDBOX_UNAVAILABLE",
                "The isolated execution service could not enforce its runtime configuration.",
                503,
              ),
            )
          : finish(null, {
              stdout,
              stderr,
              exitCode,
              durationMs: Date.now() - started,
            }),
      );
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
}
export class SQLSandbox {
  constructor(env = process.env) {
    this.env = env;
    const url = env.FABRIC_ANALYTICS_DATABASE_URL;
    if (url && env.DATABASE_URL) {
      const identity = (value) => {
        const parsed = new URL(value);
        const hostname = (parsed.searchParams.get("host") || parsed.hostname)
          .replace(/^\[|\]$/g, "")
          .toLowerCase();
        return JSON.stringify([
          ["localhost", "127.0.0.1", "::1"].includes(hostname)
            ? "loopback"
            : hostname,
          parsed.searchParams.get("port") || parsed.port || "5432",
          decodeURIComponent(
            parsed.searchParams.get("database") || parsed.pathname.slice(1),
          ),
        ]);
      };
      if (identity(url) === identity(env.DATABASE_URL))
        throw new AppError(
          "SQL_DATABASE_NOT_ISOLATED",
          "Analytics must use a separate database, not the Fabric application database.",
          503,
        );
    }
    this.pool = url
      ? new pg.Pool({
          connectionString: url,
          max: 2,
          statement_timeout: 3000,
          connectionTimeoutMillis: 2000,
          application_name: "fabric-analytics",
        })
      : null;
    this.cancelPool = url
      ? new pg.Pool({
          connectionString: url,
          max: 1,
          statement_timeout: 1000,
          connectionTimeoutMillis: 1000,
          application_name: "fabric-analytics-cancel",
        })
      : null;
  }
  async execute({ query }, { signal, actor }) {
    if (!this.pool)
      throw new AppError(
        "SQL_SANDBOX_UNAVAILABLE",
        "A separate read-only analytics database is not configured.",
        503,
      );
    if (
      !this.env.FABRIC_ANALYTICS_WORKSPACE_ID ||
      actor?.workspaceId !== this.env.FABRIC_ANALYTICS_WORKSPACE_ID
    )
      throw new AppError(
        "SQL_WORKSPACE_DENIED",
        "The analytics database is not authorized for this workspace.",
        403,
      );
    signal?.throwIfAborted();
    query = validateAnalyticsSQL(query);
    const client = await this.pool.connect();
    let cancelTask,
      released = false,
      inQuery = false;
    const abort = () => {
      if (!released && inQuery && !cancelTask)
        cancelTask = this.cancelPool
          .query("SELECT pg_cancel_backend($1)", [client.processID])
          .catch(() => {});
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      signal?.throwIfAborted();
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL statement_timeout='3s'");
      await client.query("SET LOCAL search_path=pg_catalog");
      await client.query("SET LOCAL standard_conforming_strings=on");
      const role = (
        await client.query(
          "SELECT rolsuper,rolbypassrls,pg_has_role(current_user,'pg_read_server_files','MEMBER') AS read_files,pg_has_role(current_user,'pg_write_server_files','MEMBER') AS write_files,pg_has_role(current_user,'pg_execute_server_program','MEMBER') AS execute_program FROM pg_roles WHERE rolname=current_user",
        )
      ).rows[0];
      if (
        !role ||
        role.rolsuper ||
        role.rolbypassrls ||
        role.read_files ||
        role.write_files ||
        role.execute_program
      )
        throw new AppError(
          "UNSAFE_SQL_ROLE",
          "Analytics credentials require a restricted read-only role.",
          503,
        );
      signal?.throwIfAborted();
      inQuery = true;
      const description = await client.query(
        `SELECT * FROM (${query}) AS fabric_result LIMIT 0`,
      );
      signal?.throwIfAborted();
      const result = await client.query(
        boundedSQLProjection(query, description.fields),
      );
      inQuery = false;
      await cancelTask;
      signal?.throwIfAborted();
      const rows = decodeSQLRows(result.rows, description.fields);
      await client.query("ROLLBACK");
      return { rows };
    } catch (error) {
      inQuery = false;
      await cancelTask;
      await client.query("ROLLBACK").catch(() => {});
      if (signal?.aborted)
        throw new AppError(
          "SQL_CANCELLED",
          "The read-only query was cancelled.",
          499,
        );
      if (error instanceof AppError) throw error;
      if (error.code === "57014")
        throw new AppError(
          "SQL_TIMEOUT",
          "The read-only query exceeded its time limit.",
          504,
        );
      throw new AppError(
        "SQL_QUERY_FAILED",
        "The read-only query could not be completed.",
        400,
      );
    } finally {
      released = true;
      signal?.removeEventListener("abort", abort);
      await cancelTask;
      client.release();
    }
  }
  async close() {
    await Promise.all([this.pool?.end(), this.cancelPool?.end()]);
  }
}
