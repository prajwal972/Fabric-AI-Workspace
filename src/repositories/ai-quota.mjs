import { AppError } from "../server/errors.mjs";
export class AIQuotaRepository {
  constructor(repo) {
    this.repo = repo;
  }
  async admit(actor, limits, signal, provider) {
    return this.repo.transaction(async (tx) => {
      signal?.throwIfAborted();
      const member = (
        await tx.pool.query(
          "SELECT m.role,u.email_verified_at FROM memberships m JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL JOIN workspaces w ON w.id=m.workspace_id AND w.deleted_at IS NULL WHERE m.workspace_id=$1 AND m.user_id=$2",
          [actor.workspaceId, actor.user.id],
        )
      ).rows[0];
      if (!member || !["owner", "admin", "member"].includes(member.role))
        throw new AppError(
          "FORBIDDEN",
          "Current workspace membership does not permit AI requests.",
          403,
        );
      if (limits.FABRIC_REQUIRE_EMAIL_VERIFICATION && !member.email_verified_at)
        throw new AppError(
          "EMAIL_VERIFICATION_REQUIRED",
          "Verify your email in Settings → Sessions before using AI.",
          403,
        );
      const current = (
        await tx.pool.query(
          "SELECT enabled,type FROM providers WHERE workspace_id=$1 AND id=$2",
          [actor.workspaceId, provider.id],
        )
      ).rows[0];
      if (!current?.enabled)
        throw new AppError(
          "PROVIDER_DISABLED",
          "The provider is disabled or unavailable.",
          403,
        );
      if (current.type !== provider.type)
        throw new AppError(
          "PROVIDER_CONFIGURATION_CHANGED",
          "Provider configuration changed. Retry the request.",
          409,
        );
      // Consistent user→workspace lock order. Conditional increments and one
      // transaction ensure simultaneous workers cannot overdraw either limit.
      await tx.pool.query(
        "INSERT INTO ai_user_daily(user_id,quota_day) VALUES($1,(now() AT TIME ZONE 'UTC')::date) ON CONFLICT DO NOTHING",
        [actor.user.id],
      );
      const user = (
        await tx.pool.query(
          "UPDATE ai_user_daily SET request_count=request_count+1,updated_at=now() WHERE user_id=$1 AND quota_day=(now() AT TIME ZONE 'UTC')::date AND request_count<$2 RETURNING request_count",
          [actor.user.id, limits.FABRIC_AI_USER_DAILY_REQUESTS],
        )
      ).rows[0];
      if (!user)
        throw new AppError(
          "AI_USER_DAILY_LIMIT",
          "Your daily AI request limit has been reached. Limits reset at midnight UTC.",
          429,
        );
      await tx.pool.query(
        "INSERT INTO ai_workspace_daily(workspace_id,quota_day) VALUES($1,(now() AT TIME ZONE 'UTC')::date) ON CONFLICT DO NOTHING",
        [actor.workspaceId],
      );
      const workspace = (
        await tx.pool.query(
          "UPDATE ai_workspace_daily SET request_count=request_count+1,updated_at=now() WHERE workspace_id=$1 AND quota_day=(now() AT TIME ZONE 'UTC')::date AND request_count<$2 RETURNING request_count",
          [actor.workspaceId, limits.FABRIC_AI_WORKSPACE_DAILY_REQUESTS],
        )
      ).rows[0];
      if (!workspace)
        throw new AppError(
          "AI_WORKSPACE_DAILY_LIMIT",
          "The workspace daily AI request limit has been reached. Limits reset at midnight UTC.",
          429,
        );
      signal?.throwIfAborted();
      return {
        userUsed: user.request_count,
        workspaceUsed: workspace.request_count,
      };
    });
  }
  async status(actor) {
    const row = (
      await this.repo.pool.query(
        "SELECT coalesce((SELECT request_count FROM ai_user_daily WHERE user_id=$1 AND quota_day=(now() AT TIME ZONE 'UTC')::date),0) AS user_used,coalesce((SELECT request_count FROM ai_workspace_daily WHERE workspace_id=$2 AND quota_day=(now() AT TIME ZONE 'UTC')::date),0) AS workspace_used",
        [actor.user.id, actor.workspaceId],
      )
    ).rows[0];
    return { userUsed: row.user_used, workspaceUsed: row.workspace_used };
  }
}
