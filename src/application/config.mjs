import { publicControls } from "../security/public-policy.mjs";
import { z } from "zod";
const serviceURL = (protocols) =>
  z
    .string()
    .url()
    .refine((value) => protocols.includes(new URL(value).protocol));
const unsafeSecret = (value) =>
  !value ||
  value.length < 32 ||
  /^(?:replace[-_ ]|change[-_ ]?me|disposable[-_ ]|test[-_ ]|dummy[-_ ]|example[-_ ])/i.test(
    value,
  ) ||
  /^(.)\1+$/.test(value);
export function applicationConfig(env = process.env) {
  const production = ["production", "staging"].includes(env.NODE_ENV);
  const schema = z.object({
    NODE_ENV: z
      .enum(["development", "test", "staging", "production"])
      .default("development"),
    DATABASE_URL: serviceURL(["postgres:", "postgresql:"]),
    FABRIC_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    MAX_AGENT_STEPS: z.coerce.number().int().min(1).max(12).default(8),
    MAX_TOOL_EXECUTION_TIME: z.coerce
      .number()
      .int()
      .min(100)
      .max(60000)
      .default(30000),
    MAX_TOTAL_RUNTIME: z.coerce
      .number()
      .int()
      .min(1000)
      .max(600000)
      .default(120000),
    FABRIC_DB_POOL_MAX: z.coerce.number().int().min(3).max(100).default(10),
    FABRIC_WORKER_CONCURRENCY: z.coerce
      .number()
      .int()
      .min(1)
      .max(32)
      .default(4),
    FABRIC_REDIS_COMMAND_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(10000)
      .default(5000),
    FABRIC_JOB_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(600000)
      .default(300000),
    FABRIC_JOB_LOCK_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(600000)
      .default(30000),
    FABRIC_MEMORY_MAX_DISTANCE: z.coerce.number().min(0).max(2).default(0.35),
    FABRIC_MASTER_KEY: z.string().min(32),
    REDIS_URL: serviceURL(["redis:", "rediss:"]),
    S3_ENDPOINT: serviceURL(["http:", "https:"]),
    S3_BUCKET: z.string().min(1),
    FABRIC_PUBLIC_URL: serviceURL(["http:", "https:"]).default(
      "http://127.0.0.1:8787",
    ),
  });
  const parsed = schema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      "Required configuration missing or invalid: " +
        parsed.error.issues.map((i) => i.path.join(".")).join(", "),
    );
  if (
    parsed.data.FABRIC_DB_POOL_MAX <
    parsed.data.FABRIC_WORKER_CONCURRENCY + 2
  )
    throw new Error(
      "FABRIC_DB_POOL_MAX must exceed FABRIC_WORKER_CONCURRENCY by at least two connections for leases and shared queries.",
    );
  if (production && !parsed.data.FABRIC_PUBLIC_URL.startsWith("https://"))
    throw new Error("Production public URL must use HTTPS");
  if (production && unsafeSecret(parsed.data.FABRIC_MASTER_KEY))
    throw new Error(
      "FABRIC_MASTER_KEY must be a generated production secret, not a placeholder or repeated value.",
    );
  if (production && unsafeSecret(env.FABRIC_METRICS_TOKEN))
    throw new Error(
      "FABRIC_METRICS_TOKEN must be a generated monitoring secret.",
    );
  if (
    production &&
    env.FABRIC_UPLOAD_SCAN_MODE &&
    env.FABRIC_UPLOAD_SCAN_MODE !== "required"
  )
    throw new Error("Production file scanning must be required.");
  return {
    ...env,
    ...parsed.data,
    ...publicControls(env),
    production,
    port: Number(env.FABRIC_PORT || 8787),
    host: env.FABRIC_HOST || "127.0.0.1",
  };
}
