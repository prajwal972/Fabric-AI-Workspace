import { z } from "zod";
import { AppError } from "../server/errors.mjs";
const bool = (fallback) =>
  z
    .preprocess(
      (v) => (typeof v === "boolean" ? String(v) : v),
      z.enum(["true", "false"]).default(String(fallback)),
    )
    .transform((v) => v === "true");
export function publicControls(env = process.env) {
  const production = ["production", "staging"].includes(env.NODE_ENV);
  const parsed = z
    .object({
      FABRIC_REGISTRATION_MODE: z
        .enum(["open", "closed"])
        .default(production ? "closed" : "open"),
      FABRIC_ALLOW_CLOUD_AI: bool(!production),
      FABRIC_REQUIRE_EMAIL_VERIFICATION: bool(production),
      FABRIC_AI_USER_DAILY_REQUESTS: z.coerce
        .number()
        .int()
        .min(1)
        .max(100000)
        .default(production ? 25 : 1000),
      FABRIC_AI_WORKSPACE_DAILY_REQUESTS: z.coerce
        .number()
        .int()
        .min(1)
        .max(100000)
        .default(production ? 100 : 5000),
      FABRIC_AI_MAX_OUTPUT_TOKENS: z.coerce
        .number()
        .int()
        .min(128)
        .max(32768)
        .default(production ? 4096 : 32768),
    })
    .safeParse(env);
  if (!parsed.success)
    throw new Error(
      "Invalid public-use configuration: " +
        parsed.error.issues.map((i) => i.path.join(".")).join(", "),
    );
  if (production && parsed.data.FABRIC_REGISTRATION_MODE === "open") {
    if (!parsed.data.FABRIC_REQUIRE_EMAIL_VERIFICATION)
      throw new Error(
        "Open production registration requires email verification before AI use.",
      );
    if (!env.FABRIC_SMTP_URL || !env.FABRIC_EMAIL_FROM)
      throw new Error(
        "Open production registration requires configured transactional email.",
      );
  }
  return parsed.data;
}
export function assertRegistrationAllowed(env) {
  if (publicControls(env).FABRIC_REGISTRATION_MODE === "closed")
    throw new AppError(
      "REGISTRATION_CLOSED",
      "New account registration is currently closed. Existing users can still sign in.",
      403,
    );
}
// Admission is common to chat, planning, explanation and embeddings. Models
// cannot disable the operator policy or bypass it by invoking an internal tool.
export class AIRequestPolicy {
  constructor({ quota, env = process.env }) {
    this.quota = quota;
    this.controls = publicControls(env);
  }
  outputLimit(requested) {
    if (!Number.isInteger(requested) || requested < 1)
      throw new AppError(
        "VALIDATION_ERROR",
        "Output token limit must be a positive integer.",
        400,
      );
    return Math.min(requested, this.controls.FABRIC_AI_MAX_OUTPUT_TOKENS);
  }
  async admit(actor, provider, signal) {
    signal?.throwIfAborted();
    if (!actor?.workspaceId || !actor.user?.id)
      throw new AppError(
        "UNAUTHORIZED",
        "Authentication is required for AI requests.",
        401,
      );
    if (provider.enabled === false)
      throw new AppError("PROVIDER_DISABLED", "The provider is disabled.", 403);
    if (
      !this.controls.FABRIC_ALLOW_CLOUD_AI &&
      !["ollama", "fabric-native", "mock"].includes(provider.type)
    )
      throw new AppError(
        "AI_CLOUD_DISABLED",
        "Cloud AI is disabled by the deployment operator. Choose an allowed local provider or contact the administrator.",
        403,
      );
    if (!this.quota)
      throw new AppError(
        "AI_POLICY_UNAVAILABLE",
        "AI admission controls are unavailable.",
        503,
      );
    return this.quota.admit(actor, this.controls, signal, provider);
  }
  async status(actor) {
    return {
      ...(await this.quota.status(actor)),
      cloudEnabled: this.controls.FABRIC_ALLOW_CLOUD_AI,
      emailVerificationRequired:
        this.controls.FABRIC_REQUIRE_EMAIL_VERIFICATION,
      userDailyLimit: this.controls.FABRIC_AI_USER_DAILY_REQUESTS,
      workspaceDailyLimit: this.controls.FABRIC_AI_WORKSPACE_DAILY_REQUESTS,
      maxOutputTokens: this.controls.FABRIC_AI_MAX_OUTPUT_TOKENS,
      resetTimeZone: "UTC",
      accounting:
        "provider attempts and embedding batches; failed admitted attempts count",
      monetaryBudgetGuarantee: false,
    };
  }
}
