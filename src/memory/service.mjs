import { z } from "zod";
import { can } from "../security/rbac.mjs";
import { AppError } from "../server/errors.mjs";
const sensitiveMemory = (content) =>
  /password|api.?key|secret|bearer\s|private key|credit.?card|\bsk-[a-z0-9]/i.test(
    content,
  );
export class MemoryService {
  constructor({ repo, ai, jobs, env = process.env }) {
    Object.assign(this, { repo, ai, jobs });
    this.maxDistance = Number(env.FABRIC_MEMORY_MAX_DISTANCE ?? 0.35);
    if (
      !Number.isFinite(this.maxDistance) ||
      this.maxDistance < 0 ||
      this.maxDistance > 2
    )
      throw new TypeError("FABRIC_MEMORY_MAX_DISTANCE must be between 0 and 2");
  }
  async policy(
    actor,
    permission = "workspace.read",
    repository = this.repo,
    lock = false,
  ) {
    if (!actor?.workspaceId || !actor?.user?.id)
      throw new AppError("UNAUTHORIZED", "Sign in required.", 401);
    const row = (
      await repository.pool.query(
        "SELECT m.role,u.memory_enabled AS user_enabled,w.memory_enabled AS workspace_enabled FROM memberships m JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL JOIN workspaces w ON w.id=m.workspace_id AND w.deleted_at IS NULL WHERE m.user_id=$1 AND m.workspace_id=$2" +
          (lock ? " FOR SHARE OF m,u,w" : ""),
        [actor.user.id, actor.workspaceId],
      )
    ).rows[0];
    if (!row || !can(row.role, permission))
      throw new AppError(
        "FORBIDDEN",
        "Current workspace membership does not permit this memory operation.",
        403,
      );
    return {
      actor: { ...actor, role: row.role },
      enabled: !!(row.user_enabled && row.workspace_enabled),
    };
  }
  async enabled(actor, permission = "workspace.read") {
    return (await this.policy(actor, permission)).enabled;
  }
  async add(actor, input) {
    const data = z
      .object({
        content: z.string().trim().min(1).max(2000),
        scope: z.enum(["user", "workspace", "conversation"]).default("user"),
        conversationId: z.string().min(1).max(200).optional(),
        expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
      })
      .strict()
      .refine(
        (value) => value.scope === "conversation" || !value.conversationId,
        { message: "Conversation IDs apply only to conversation memory" },
      )
      .parse(input);
    const policy = await this.policy(actor, "workspace.write");
    actor = policy.actor;
    if (!policy.enabled)
      throw new AppError("MEMORY_DISABLED", "Memory is disabled.", 409);
    if (data.scope === "workspace" && !can(actor.role, "workspace.admin"))
      throw new AppError(
        "FORBIDDEN",
        "Only an administrator can write workspace memory.",
        403,
      );
    if (
      data.expiresAt &&
      (Date.parse(data.expiresAt) <= Date.now() ||
        Date.parse(data.expiresAt) > Date.now() + 365 * 86400000)
    )
      throw new AppError(
        "MEMORY_EXPIRY",
        "Memory expiry must be in the future and within one year.",
        400,
      );
    if (sensitiveMemory(data.content))
      throw new AppError(
        "SENSITIVE_MEMORY",
        "Do not store secrets in memory.",
        400,
      );
    if (data.scope === "conversation" && !data.conversationId)
      throw new AppError(
        "CONVERSATION_REQUIRED",
        "Conversation memory requires a conversation.",
        400,
      );
    if (data.conversationId) {
      const c = (
        await this.repo.pool.query(
          "SELECT id FROM conversations WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL",
          [actor.workspaceId, data.conversationId],
        )
      ).rows[0];
      if (!c) throw new AppError("NOT_FOUND", "Conversation not found.", 404);
    }
    return this.repo.transaction(async (tx) => {
      const current = await this.policy(actor, "workspace.write", tx, true);
      actor = current.actor;
      if (!current.enabled)
        throw new AppError("MEMORY_DISABLED", "Memory is disabled.", 409);
      if (data.scope === "workspace" && !can(actor.role, "workspace.admin"))
        throw new AppError(
          "FORBIDDEN",
          "Only an administrator can write workspace memory.",
          403,
        );
      if (data.scope === "conversation") {
        const conversation = (
          await tx.pool.query(
            "SELECT id FROM conversations WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL FOR SHARE",
            [actor.workspaceId, data.conversationId],
          )
        ).rows[0];
        if (!conversation)
          throw new AppError("NOT_FOUND", "Conversation not found.", 404);
      }
      const row = await tx.memories.create(actor.workspaceId, {
        ...data,
        userId: data.scope === "workspace" ? null : actor.user.id,
      });
      const job = await this.jobs.create(
        actor,
        "memory-reindex",
        { ids: [row.id], limit: 1 },
        "memory-index-" + row.id,
        tx,
      );
      await tx.audit(actor, "memory.created", {
        id: row.id,
        scope: row.scope,
        expiresAt: data.expiresAt || null,
      });
      return { ...row, jobId: job.id, indexingStatus: "queued" };
    });
  }
  async reindex(actor, input, { signal, progress } = {}) {
    const data = z
      .object({
        ids: z.array(z.string().min(1).max(100)).min(1).max(100).optional(),
        limit: z.number().int().min(1).max(100).default(50),
        afterId: z.string().max(100).optional(),
        force: z.boolean().default(false),
      })
      .strict()
      .parse(input);
    const policy = await this.policy(actor, "workspace.write");
    actor = policy.actor;
    if (!policy.enabled)
      throw new AppError("MEMORY_DISABLED", "Memory is disabled.", 409);
    const administrator = can(actor.role, "workspace.admin");
    const rows = (
      await this.repo.pool.query(
        "SELECT id,scope,content FROM memories WHERE workspace_id=$1 AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at>now()) AND ((user_id=$2 AND scope<>'workspace') OR (scope='workspace' AND $3)) AND ($4::text[] IS NULL OR id=ANY($4)) AND ($5::text IS NULL OR id>$5) AND ($6 OR embedding IS NULL) ORDER BY id LIMIT $7",
        [
          actor.workspaceId,
          actor.user.id,
          administrator,
          data.ids || null,
          data.afterId || null,
          data.force,
          data.limit + 1,
        ],
      )
    ).rows;
    const selected = rows.slice(0, data.limit);
    const batch = selected.filter((row) => !sensitiveMemory(row.content));
    const skippedSensitive = selected.length - batch.length;
    let indexed = 0,
      skipped = skippedSensitive;
    for (let i = 0; i < batch.length; i += 16) {
      signal?.throwIfAborted();
      if (!(await this.enabled(actor, "workspace.write")))
        throw new AppError(
          "MEMORY_DISABLED",
          "Memory was disabled before indexing completed.",
          409,
        );
      const part = batch.slice(i, i + 16),
        embedded = await this.ai.embed(
          actor,
          part.map((r) => r.content),
          signal,
        );
      signal?.throwIfAborted();
      await this.repo.transaction(async (tx) => {
        const current = await this.policy(actor, "workspace.write", tx, true);
        actor = current.actor;
        if (!current.enabled)
          throw new AppError(
            "MEMORY_DISABLED",
            "Memory was disabled before indexing completed.",
            409,
          );
        for (let n = 0; n < part.length; n++) {
          const row = part[n];
          const result = await tx.pool.query(
            "UPDATE memories SET embedding=$1::vector,embedding_model=$2 WHERE workspace_id=$3 AND id=$4 AND content=$5 AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at>now()) AND ((user_id=$6 AND scope<>'workspace') OR (scope='workspace' AND EXISTS(SELECT 1 FROM memberships WHERE workspace_id=$3 AND user_id=$6 AND role IN ('owner','admin')))) AND EXISTS(SELECT 1 FROM users u JOIN memberships m ON m.user_id=u.id JOIN workspaces w ON w.id=m.workspace_id WHERE u.id=$6 AND w.id=$3 AND u.memory_enabled AND w.memory_enabled AND u.deleted_at IS NULL AND w.deleted_at IS NULL)",
            [
              JSON.stringify(embedded.vectors[n]),
              embedded.identity,
              actor.workspaceId,
              row.id,
              row.content,
              actor.user.id,
            ],
          );
          if (result.rowCount) indexed++;
          else skipped++;
        }
      });
      await progress?.(
        Math.round(
          (Math.min(batch.length, i + 16) / Math.max(1, batch.length)) * 100,
        ),
      );
    }
    await this.repo.audit(actor, "memory.indexed", { indexed, skipped });
    return {
      indexed,
      skipped,
      processed: selected.length,
      skippedSensitive,
      nextCursor: rows.length > data.limit ? selected.at(-1).id : null,
    };
  }
  async listPage(actor, input = {}) {
    const data = z
      .object({
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).max(100000).default(0),
        includeExpired: z.boolean().default(false),
      })
      .strict()
      .parse(input);
    await this.policy(actor);
    const rows = (
      await this.repo.pool.query(
        'SELECT id,scope,content,conversation_id AS "conversationId",created_at AS "createdAt",expires_at AS "expiresAt",(expires_at IS NOT NULL AND expires_at<=now()) AS expired,CASE WHEN embedding IS NULL THEN \'pending\' ELSE \'indexed\' END AS "indexingStatus" FROM memories WHERE workspace_id=$1 AND deleted_at IS NULL AND (scope=\'workspace\' OR user_id=$2) AND ($5 OR expires_at IS NULL OR expires_at>now()) AND EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL JOIN workspaces w ON w.id=m.workspace_id AND w.deleted_at IS NULL WHERE m.workspace_id=$1 AND m.user_id=$2) ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4',
        [
          actor.workspaceId,
          actor.user.id,
          data.limit + 1,
          data.offset,
          data.includeExpired,
        ],
      )
    ).rows;
    return {
      items: rows.slice(0, data.limit),
      nextOffset: rows.length > data.limit ? data.offset + data.limit : null,
    };
  }
  async list(actor) {
    return (await this.listPage(actor, { limit: 100 })).items;
  }
  async remove(actor, id) {
    z.string().min(1).max(200).parse(id);
    await this.repo.transaction(async (tx) => {
      actor = (await this.policy(actor, "workspace.write", tx, true)).actor;
      const row = await tx.memories.require(actor.workspaceId, id);
      if (
        (row.scope === "workspace" && !can(actor.role, "workspace.admin")) ||
        (row.userId && row.userId !== actor.user.id)
      )
        throw new AppError("FORBIDDEN", "You cannot delete this memory.", 403);
      await tx.pool.query(
        "UPDATE memories SET deleted_at=now(),embedding=NULL,embedding_model=NULL WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL",
        [actor.workspaceId, id],
      );
      await tx.audit(actor, "memory.deleted", { id });
    });
  }
  async retrieve(actor, query, conversationId, signal) {
    signal?.throwIfAborted();
    if (!(await this.enabled(actor))) return [];
    const present = (
      await this.repo.pool.query(
        "SELECT 1 FROM memories WHERE workspace_id=$1 AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at>now()) AND embedding IS NOT NULL AND (scope='workspace' OR user_id=$2) AND (scope<>'conversation' OR conversation_id=$3) LIMIT 1",
        [actor.workspaceId, actor.user.id, conversationId || null],
      )
    ).rows.length;
    if (!present) return [];
    let vector;
    try {
      vector = await this.ai.embed(actor, [query], signal);
    } catch (e) {
      if (e.code === "EMBEDDING_PROVIDER_REQUIRED") return [];
      throw e;
    }
    signal?.throwIfAborted();
    if (!(await this.enabled(actor))) return [];
    const result = (
      await this.repo.pool.query(
        "SELECT id,scope,content,embedding <=> $5::vector AS distance FROM memories WHERE workspace_id=$1 AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at>now()) AND (scope='workspace' OR user_id=$2) AND (scope<>'conversation' OR (conversation_id=$3 AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=conversation_id AND c.workspace_id=$1 AND c.deleted_at IS NULL))) AND embedding_model=$4 AND embedding IS NOT NULL AND embedding <=> $5::vector <= $6 AND EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL JOIN workspaces w ON w.id=m.workspace_id AND w.deleted_at IS NULL WHERE m.workspace_id=$1 AND m.user_id=$2 AND u.memory_enabled AND w.memory_enabled) ORDER BY embedding <=> $5::vector,id LIMIT 5",
        [
          actor.workspaceId,
          actor.user.id,
          conversationId || null,
          vector.identity,
          JSON.stringify(vector.vectors[0]),
          this.maxDistance,
        ],
      )
    ).rows;
    signal?.throwIfAborted();
    return result;
  }
  async toggle(actor, enabled, workspace = false) {
    z.boolean().parse(enabled);
    z.boolean().parse(workspace);
    await this.repo.transaction(async (tx) => {
      actor = (await this.policy(actor, "workspace.read", tx)).actor;
      const result = workspace
        ? await tx.pool.query(
            "UPDATE workspaces w SET memory_enabled=$2 WHERE w.id=$1 AND w.deleted_at IS NULL AND EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL WHERE m.workspace_id=w.id AND m.user_id=$3 AND m.role IN ('owner','admin'))",
            [actor.workspaceId, enabled, actor.user.id],
          )
        : await tx.pool.query(
            "UPDATE users u SET memory_enabled=$2 WHERE u.id=$1 AND u.deleted_at IS NULL AND EXISTS(SELECT 1 FROM memberships m JOIN workspaces w ON w.id=m.workspace_id AND w.deleted_at IS NULL WHERE m.user_id=u.id AND m.workspace_id=$3 AND m.role IN ('owner','admin','member','viewer'))",
            [actor.user.id, enabled, actor.workspaceId],
          );
      if (!result.rowCount)
        throw new AppError(
          "FORBIDDEN",
          "Current workspace membership does not permit changing memory settings.",
          403,
        );
      await tx.audit(actor, "memory.settings_changed", {
        enabled,
        scope: workspace ? "workspace" : "user",
      });
    });
  }
}
