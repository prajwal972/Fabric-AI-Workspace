import { z } from "zod";
import { can } from "../security/rbac.mjs";
import { newId, hash } from "../security/crypto.mjs";
import { AppError } from "../server/errors.mjs";
const classifications = new Set([
  "READ",
  "WRITE",
  "DESTRUCTIVE",
  "EXTERNAL_ACTION",
]);
const canonical = (value) =>
  value && typeof value === "object"
    ? Array.isArray(value)
      ? value.map(canonical)
      : Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonical(value[k])]),
        )
    : value;
export const argumentHash = (input) => hash(JSON.stringify(canonical(input)));
export class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }
  register(tool) {
    if (
      !/^[a-z][a-z0-9_]{1,60}$/.test(tool.name) ||
      this.tools.has(tool.name) ||
      !classifications.has(tool.classification) ||
      !tool.permission ||
      !tool.input ||
      !tool.output ||
      typeof tool.handler !== "function"
    )
      throw new TypeError("Invalid or duplicate tool");
    this.tools.set(tool.name, tool);
    return this;
  }
  schemas(actor) {
    return [...this.tools.values()]
      .filter((t) => can(actor.role, t.permission))
      .map((t) => ({
        name: t.name,
        id: t.name,
        description: t.description,
        inputSchema: z.toJSONSchema(t.input),
        outputSchema: z.toJSONSchema(t.output),
        permission: t.permission,
        classification: t.classification,
        destructive: t.classification === "DESTRUCTIVE",
        permissions: [t.permission],
      }));
  }
}
export class ApprovalRequired extends AppError {
  constructor(id) {
    super("APPROVAL_REQUIRED", "This action needs your approval.", 409);
    this.approvalId = id;
  }
}
export class ToolGateway {
  constructor({ registry, repo, jobs, env = process.env }) {
    Object.assign(this, { registry, repo, jobs, env });
  }
  async requestApproval(actor, name, input, runId) {
    const id = newId("apr");
    await this.repo.pool.query(
      "INSERT INTO approvals(id,workspace_id,user_id,run_id,tool_name,input,input_hash,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,'pending',now()+interval '15 minutes')",
      [
        id,
        actor.workspaceId,
        actor.user.id,
        runId || null,
        name,
        JSON.stringify(input),
        argumentHash(input),
      ],
    );
    return id;
  }
  async decision(actor, id, approved, repository = this.repo) {
    if (!actor?.workspaceId || !actor?.user?.id)
      throw new AppError("UNAUTHORIZED", "Sign in required.", 401);
    if (typeof approved !== "boolean")
      throw new AppError(
        "VALIDATION_ERROR",
        "Approval decision must be a boolean.",
        400,
      );
    const member = (
      await repository.pool.query(
        "SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL JOIN workspaces w ON w.id=m.workspace_id AND w.deleted_at IS NULL WHERE m.workspace_id=$1 AND m.user_id=$2",
        [actor.workspaceId, actor.user.id],
      )
    ).rows[0];
    if (!member || !can(member.role, "tools.execute"))
      throw new AppError(
        "FORBIDDEN_TOOL",
        "Current workspace membership does not permit this approval decision.",
        403,
      );
    const pending = (
      await repository.pool.query(
        "SELECT tool_name,run_id FROM approvals WHERE id=$1 AND workspace_id=$2 AND user_id=$3 AND status='pending' AND expires_at>now() FOR UPDATE",
        [id, actor.workspaceId, actor.user.id],
      )
    ).rows[0];
    if (!pending)
      throw new AppError("NOT_FOUND", "Approval expired or unavailable.", 404);
    if (approved && pending.run_id) {
      const run = await repository.agent_runs.require(
        actor.workspaceId,
        pending.run_id,
      );
      if (
        run.userId !== actor.user.id ||
        run.status !== "waiting_approval" ||
        run.cancelRequested ||
        run.state?.approvalId !== id
      )
        throw new AppError(
          "APPROVAL_RUN_STATE",
          "This approval does not match the agent's current waiting action.",
          409,
        );
    }
    const tool = this.registry.tools.get(pending.tool_name);
    if (approved && (!tool || !can(member.role, tool.permission)))
      throw new AppError(
        "FORBIDDEN_TOOL",
        "This tool is no longer available or permitted.",
        403,
      );
    const { rows } = await repository.pool.query(
      "UPDATE approvals SET status=$4 WHERE id=$1 AND workspace_id=$2 AND user_id=$3 AND status='pending' AND expires_at>now() RETURNING id,run_id",
      [
        id,
        actor.workspaceId,
        actor.user.id,
        approved ? "approved" : "rejected",
      ],
    );
    if (!rows.length)
      throw new AppError("NOT_FOUND", "Approval expired or unavailable.", 404);
    if (!approved && rows[0].run_id) {
      const run = await repository.agent_runs.require(
        actor.workspaceId,
        rows[0].run_id,
      );
      if (
        run.userId === actor.user.id &&
        run.status === "waiting_approval" &&
        run.state?.approvalId === id
      )
        await repository.agent_runs.update(actor.workspaceId, run.id, {
          status: "cancelled",
          cancelRequested: true,
          error: "APPROVAL_REJECTED",
        });
    }
    return rows[0];
  }
  async decideAndSchedule(actor, id, approved) {
    if (!this.jobs)
      throw new AppError(
        "QUEUE_UNAVAILABLE",
        "Approval scheduling is unavailable.",
        503,
      );
    return this.repo.transaction(async (tx) => {
      const decision = await this.decision(actor, id, approved, tx);
      if (decision.run_id && approved)
        await this.jobs.create(
          actor,
          "agent-run",
          { runId: decision.run_id, approvalId: id },
          "resume-" + id,
          tx,
        );
      return decision;
    });
  }
  async pending(actor) {
    return (
      await this.repo.pool.query(
        'SELECT id,tool_name AS tool,input,run_id AS "runId",expires_at AS "expiresAt" FROM approvals WHERE workspace_id=$1 AND user_id=$2 AND status=\'pending\' AND expires_at>now() ORDER BY created_at DESC LIMIT 50',
        [actor.workspaceId, actor.user.id],
      )
    ).rows;
  }
  async execute(actor, name, input, { signal, runId, approvalId } = {}) {
    if (!actor?.workspaceId || !actor?.user?.id)
      throw new AppError("UNAUTHORIZED", "Sign in required.", 401);
    signal?.throwIfAborted();
    const membership = (
      await this.repo.pool.query(
        "SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL JOIN workspaces w ON w.id=m.workspace_id AND w.deleted_at IS NULL WHERE m.workspace_id=$1 AND m.user_id=$2",
        [actor.workspaceId, actor.user.id],
      )
    ).rows[0];
    if (!membership)
      throw new AppError(
        "FORBIDDEN_TOOL",
        "Workspace membership is required.",
        403,
      );
    actor = { ...actor, role: membership.role };
    const tool = this.registry.tools.get(name);
    if (!tool || !can(actor.role, tool.permission))
      throw new AppError(
        "FORBIDDEN_TOOL",
        "This tool is unavailable or not permitted.",
        403,
      );
    const parsed = tool.input.safeParse(input);
    if (!parsed.success)
      throw new AppError(
        "INVALID_TOOL_INPUT",
        "The tool arguments are invalid.",
        400,
      );
    input = parsed.data;
    signal?.throwIfAborted();
    if (tool.classification !== "READ") {
      if (!approvalId)
        throw new ApprovalRequired(
          await this.requestApproval(actor, name, input, runId),
        );
      const { rowCount } = await this.repo.pool.query(
        "UPDATE approvals SET status='consumed' WHERE id=$1 AND workspace_id=$2 AND user_id=$3 AND tool_name=$4 AND input_hash=$5 AND status='approved' AND expires_at>now() AND run_id IS NOT DISTINCT FROM $6::text",
        [
          approvalId,
          actor.workspaceId,
          actor.user.id,
          name,
          argumentHash(input),
          runId || null,
        ],
      );
      if (!rowCount)
        throw new AppError(
          "INVALID_APPROVAL",
          "Approval does not match this action or was already used.",
          403,
        );
    }
    const started = Date.now(),
      id = newId("exe"),
      deadline = Number(this.env.MAX_TOOL_EXECUTION_TIME || 30000),
      controller = new AbortController();
    const combined = AbortSignal.any([
      ...(signal ? [signal] : []),
      controller.signal,
    ]);
    let timeout;
    await this.repo.pool.query(
      "INSERT INTO tool_executions(id,workspace_id,user_id,run_id,tool_name,input,status,code_hash,resource_limits) VALUES($1,$2,$3,$4,$5,$6,'running',$7,$8)",
      [
        id,
        actor.workspaceId,
        actor.user.id,
        runId || null,
        name,
        JSON.stringify(input),
        input.code ? hash(input.code) : null,
        JSON.stringify({ timeoutMs: deadline }),
      ],
    );
    try {
      const result = await Promise.race([
        tool.handler(input, {
          actor,
          signal: combined,
          executionId: id,
          runId,
        }),
        new Promise((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(
              new AppError("TOOL_TIMEOUT", "Tool execution timed out.", 504),
            );
          }, deadline);
        }),
      ]);
      const output = tool.output.safeParse(result);
      if (!output.success)
        throw new AppError(
          "INVALID_TOOL_OUTPUT",
          "The tool returned an invalid result.",
          502,
        );
      if (Buffer.byteLength(JSON.stringify(output.data)) > 200000)
        throw new AppError(
          "TOOL_OUTPUT_LIMIT",
          "Tool output exceeded its size limit.",
          502,
        );
      await this.repo.pool.query(
        "UPDATE tool_executions SET status='completed',output=$2,duration_ms=$3 WHERE id=$1",
        [id, JSON.stringify(output.data), Date.now() - started],
      );
      await this.repo.audit(actor, "tool.completed", {
        tool: name,
        executionId: id,
        runId,
      });
      return output.data;
    } catch (error) {
      await this.repo.pool.query(
        "UPDATE tool_executions SET status=$2,error_code=$3,duration_ms=$4 WHERE id=$1",
        [
          id,
          combined.aborted ? "cancelled" : "failed",
          error.code || "TOOL_FAILED",
          Date.now() - started,
        ],
      );
      await this.repo.audit(actor, "tool.failed", {
        tool: name,
        executionId: id,
        code: error.code || "TOOL_FAILED",
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
