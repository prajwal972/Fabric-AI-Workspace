import { logger } from "../observability/index.mjs";
import pg from "pg";
import Redis from "ioredis";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";

const check = async (name, fn, timeoutMs = 2_000) => {
  const started = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`${name} health check timed out`)),
          timeoutMs,
        ),
      ),
    ]);
    return { name, ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      name,
      ok: false,
      latencyMs: Date.now() - started,
      error: error?.code || error?.name || "UNAVAILABLE",
    };
  }
};

export function createInfrastructure(env = process.env) {
  const pool = env.DATABASE_URL
    ? new pg.Pool({
        connectionString: env.DATABASE_URL,
        max: Number(env.FABRIC_DB_POOL_MAX || 10),
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
        statement_timeout: 30_000,
        application_name: "fabric-api",
        ssl: env.PGSSLMODE === "disable" ? false : undefined,
      })
    : null;
  const redis = env.REDIS_URL
    ? new Redis(env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 5_000,
      })
    : null;
  const s3 =
    env.S3_ENDPOINT && env.S3_BUCKET
      ? new S3Client({
          endpoint: env.S3_ENDPOINT,
          maxAttempts: 3,
          requestHandler: { connectionTimeout: 5000, requestTimeout: 60000 },
          region: env.S3_REGION || "us-east-1",
          forcePathStyle: env.S3_FORCE_PATH_STYLE !== "false",
          credentials:
            env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
              ? {
                  accessKeyId: env.S3_ACCESS_KEY_ID,
                  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
                }
              : undefined,
        })
      : null;

  pool?.on("error", (error) =>
    logger.error({
      event: "database.idle_connection_error",
      code: error.code || "DATABASE_UNAVAILABLE",
    }),
  );
  redis?.on("error", (error) =>
    logger.warn({
      event: "redis.error",
      code: error.code || "REDIS_UNAVAILABLE",
    }),
  );
  async function readiness() {
    const results = [];
    if (pool)
      results.push(await check("postgres", () => pool.query("SELECT 1")));
    if (redis) {
      results.push(
        await check("redis", async () => {
          if (redis.status === "wait") await redis.connect();
          await redis.ping();
        }),
      );
    }
    if (s3)
      results.push(
        await check("object-storage", () =>
          s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET })),
        ),
      );
    return { ok: results.every((item) => item.ok), dependencies: results };
  }

  async function close() {
    await Promise.allSettled([
      pool?.end(),
      redis
        ? redis.status === "wait" || redis.status === "end"
          ? redis.disconnect()
          : redis.quit().catch(() => redis.disconnect())
        : undefined,
      Promise.resolve(s3?.destroy()),
    ]);
  }

  return { pool, redis, s3, readiness, close };
}
