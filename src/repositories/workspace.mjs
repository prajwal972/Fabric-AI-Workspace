import { withTransaction } from "../database/transaction.mjs";
import { newId } from "../security/crypto.mjs";
import { AppError } from "../server/errors.mjs";
// Explicit field maps are shared by scoped repositories, not exposed to HTTP.
const maps = {
  providers: {
    name: "name",
    type: "type",
    config: "config",
    models: "models",
    credential: "credential_ciphertext",
    enabled: "enabled",
    isDefault: "is_default",
    status: "status",
    lastError: "last_error_code",
  },
  files: {
    ragStatus: "rag_status",
    userId: "uploaded_by",
    name: "original_name",
    objectKey: "object_key",
    mime: "detected_mime",
    declaredMime: "declared_mime",
    size: "size_bytes",
    sha256: "sha256",
    status: "status",
    kind: "kind",
    text: "extracted_text",
    pages: "page_metadata",
    extraction: "extraction_method",
    error: "error_code",
    extractedObjectKey: "extracted_text_object_key",
  },
  agent_runs: {
    userId: "user_id",
    agentId: "agent_id",
    status: "status",
    input: "objective",
    plan: "plan",
    state: "state",
    output: "output",
    error: "error_code",
    cancelRequested: "cancel_requested",
  },
  agents: { name: "name", instructions: "instructions", tools: "tools" },
  jobs: {
    userId: "actor_user_id",
    type: "type",
    idempotencyKey: "idempotency_key",
    status: "status",
    input: "input",
    output: "output",
    error: "error_code",
    progress: "progress",
    cancelRequested: "cancel_requested",
    attempts: "attempts",
    maxAttempts: "max_attempts",
  },
  memories: {
    userId: "user_id",
    conversationId: "conversation_id",
    scope: "scope",
    content: "content",
    expiresAt: "expires_at",
  },
  artifacts: {
    userId: "user_id",
    messageId: "message_id",
    name: "name",
    objectKey: "object_key",
    files: "files",
    size: "size_bytes",
  },
  plugins: {
    credential: "credential_ciphertext",
    pluginId: "plugin_id",
    name: "name",
    baseUrl: "base_url",
    authScheme: "auth_scheme",
    enabled: "enabled",
    credentialSecretId: "credential_secret_id",
    oauthProvider: "oauth_provider",
    oauthExpiresAt: "oauth_expires_at",
  },
};
// Serialization follows the actual SQL column type, not a global field name.
// Agent objectives/output are TEXT; job input/output are JSONB.
const jsonFields = {
  providers: new Set(["config", "models"]),
  files: new Set(["pages"]),
  agent_runs: new Set(["plan", "state"]),
  agents: new Set(["tools"]),
  jobs: new Set(["input", "output"]),
  artifacts: new Set(["files"]),
};
const soft = new Set(["files", "memories", "artifacts"]);
export function recordDTO(table, row) {
  if (!row) return null;
  const data = {
    id: row.id,
    workspaceId: row.workspace_id,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
  };
  for (const [field, col] of Object.entries(maps[table]))
    data[field] = row[col];
  if (table === "files") {
    // pg returns BYTEA as Buffer; provenance uses the original 32-byte digest in hex.
    data.sha256 = Buffer.isBuffer(data.sha256)
      ? data.sha256.length === 32
        ? data.sha256.toString("hex")
        : null
      : /^[a-f0-9]{64}$/i.test(data.sha256 || "")
        ? data.sha256
        : null;
  }
  if (table === "artifacts") {
    data.fileCount = data.files?.length || 0;
    data.kind = data.fileCount > 1 ? "project" : "document";
  }
  return data;
}
export class ScopedRepository {
  constructor(pool, table) {
    if (!maps[table]) throw new TypeError("Unknown repository");
    this.pool = pool;
    this.table = table;
  }
  async get(ws, id) {
    const { rows } = await this.pool.query(
      `SELECT * FROM ${this.table} WHERE workspace_id=$1 AND id=$2 ${soft.has(this.table) ? "AND deleted_at IS NULL" : ""}`,
      [ws, id],
    );
    return recordDTO(this.table, rows[0]);
  }
  async require(ws, id) {
    const row = await this.get(ws, id);
    if (!row) throw new AppError("NOT_FOUND", "Record not found.", 404);
    return row;
  }
  async list(ws, { limit = 50, offset = 0 } = {}) {
    if (
      !ws ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 100000
    )
      throw new AppError("VALIDATION_ERROR", "Invalid pagination.", 400);
    const { rows } = await this.pool.query(
      `SELECT * FROM ${this.table} WHERE workspace_id=$1 ${soft.has(this.table) ? "AND deleted_at IS NULL" : ""} ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`,
      [ws, limit + 1, offset],
    );
    return {
      items: rows.slice(0, limit).map((row) => recordDTO(this.table, row)),
      nextOffset: rows.length > limit ? offset + limit : null,
    };
  }
  async create(ws, data) {
    const id = data.id || newId(this.table.slice(0, 3)),
      pairs = Object.entries(data).filter(([k]) => maps[this.table][k]);
    const columns = [
      "id",
      "workspace_id",
      ...pairs.map(([k]) => maps[this.table][k]),
    ];
    const values = [
      id,
      ws,
      ...pairs.map(([k, v]) =>
        jsonFields[this.table]?.has(k) && v != null ? JSON.stringify(v) : v,
      ),
    ];
    const { rows } = await this.pool.query(
      `INSERT INTO ${this.table}(${columns.join(",")}) VALUES(${values.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING *`,
      values,
    );
    return recordDTO(this.table, rows[0]);
  }
  async update(ws, id, data) {
    const pairs = Object.entries(data).filter(([k]) => maps[this.table][k]);
    if (!pairs.length) return this.require(ws, id);
    const values = [
      ws,
      id,
      ...pairs.map(([k, v]) =>
        jsonFields[this.table]?.has(k) && v != null ? JSON.stringify(v) : v,
      ),
    ];
    const { rows } = await this.pool.query(
      `UPDATE ${this.table} SET ${pairs.map(([k], i) => maps[this.table][k] + "=$" + (i + 3)).join(",")} WHERE workspace_id=$1 AND id=$2 ${soft.has(this.table) ? "AND deleted_at IS NULL" : ""} RETURNING *`,
      values,
    );
    if (!rows[0]) throw new AppError("NOT_FOUND", "Record not found.", 404);
    return recordDTO(this.table, rows[0]);
  }
  async delete(ws, id) {
    const { rowCount } = await this.pool.query(
      soft.has(this.table)
        ? `UPDATE ${this.table} SET deleted_at=now() WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL`
        : `DELETE FROM ${this.table} WHERE workspace_id=$1 AND id=$2`,
      [ws, id],
    );
    return rowCount > 0;
  }
}
export class WorkspaceRepository {
  constructor(pool) {
    this.pool = pool;
    for (const table of Object.keys(maps))
      this[table] = new ScopedRepository(pool, table);
  }
  async listFileMetadata(ws, { limit = 10, offset = 0 } = {}) {
    if (
      !ws ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 20 ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 100000
    )
      throw new AppError("VALIDATION_ERROR", "Invalid pagination.", 400);
    const { rows } = await this.pool.query(
      "SELECT id,original_name AS name,kind,status FROM files WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3",
      [ws, limit + 1, offset],
    );
    return {
      items: rows.slice(0, limit),
      nextOffset: rows.length > limit ? offset + limit : null,
    };
  }
  transaction(fn) {
    return withTransaction(this.pool, (client) =>
      fn(new WorkspaceRepository({ query: client.query.bind(client) })),
    );
  }
  async recoveryUser(email) {
    return (
      await this.pool.query(
        "SELECT u.id,u.email,u.name,m.workspace_id,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE lower(u.email)=$1 AND u.deleted_at IS NULL LIMIT 1",
        [email],
      )
    ).rows[0];
  }
  async userWorkspaces(uid) {
    return (
      await this.pool.query(
        "SELECT w.id,w.name,m.role FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 AND w.deleted_at IS NULL ORDER BY w.name LIMIT 100",
        [uid],
      )
    ).rows;
  }
  async members(ws) {
    return (
      await this.pool.query(
        "SELECT u.id,u.name,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 LIMIT 100",
        [ws],
      )
    ).rows;
  }
  async setMember(ws, uid, role) {
    await this.pool.query(
      "INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role WHERE memberships.role<>'owner'",
      [ws, uid, role],
    );
  }
  async saveOAuthState(row) {
    await this.pool.query(
      "INSERT INTO oauth_states(state_hash,workspace_id,user_id,plugin_id,provider,verifier_ciphertext,expires_at) VALUES(decode($1,'hex'),$2,$3,$4,$5,$6,now()+interval '10 minutes')",
      row,
    );
  }
  async consumeOAuthState(token, ws, uid, plugin) {
    return (
      await this.pool.query(
        "UPDATE oauth_states SET consumed_at=now() WHERE state_hash=decode($1,'hex') AND workspace_id=$2 AND user_id=$3 AND plugin_id=$4 AND consumed_at IS NULL AND expires_at>now() RETURNING *",
        [token, ws, uid, plugin],
      )
    ).rows[0];
  }
  async workspace(id) {
    return (
      await this.pool.query(
        'SELECT id,name,memory_enabled AS "memoryEnabled",research_url AS "researchUrl" FROM workspaces WHERE id=$1 AND deleted_at IS NULL',
        [id],
      )
    ).rows[0];
  }
  async setWorkspace(id, fields) {
    const pairs = Object.entries(fields).filter(([k]) =>
        ["memoryEnabled", "researchUrl", "name"].includes(k),
      ),
      keys = {
        memoryEnabled: "memory_enabled",
        researchUrl: "research_url",
        name: "name",
      };
    if (pairs.length)
      await this.pool.query(
        `UPDATE workspaces SET ${pairs.map(([k], i) => keys[k] + "=$" + (i + 2)).join(",")},updated_at=now(),version=version+1 WHERE id=$1`,
        [id, ...pairs.map(([, v]) => v)],
      );
    return this.workspace(id);
  }
  async audit(actor, event, details = {}, requestId) {
    await this.pool.query(
      "INSERT INTO audit_events(workspace_id,actor_user_id,event_type,request_id,outcome,details) VALUES($1,$2,$3,$4,'success',$5)",
      [
        actor?.workspaceId || null,
        actor?.user?.id || null,
        event,
        requestId || actor?.requestId || null,
        JSON.stringify(details),
      ],
    );
  }
  async auditPage(ws, limit = 100) {
    return (
      await this.pool.query(
        'SELECT id,event_type AS event,actor_user_id AS "actorId",created_at AS "createdAt",details,request_id AS "requestId" FROM audit_events WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2',
        [ws, Math.min(limit, 100)],
      )
    ).rows;
  }
  async createMessage(actor, cid, record) {
    const { rows } = await this.pool.query(
      "INSERT INTO messages(id,workspace_id,conversation_id,user_id,role,content,metadata,status,error_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
      [
        record.id || newId("mes"),
        actor.workspaceId,
        cid,
        actor.user.id,
        record.role,
        record.content || "",
        JSON.stringify(record.metadata || {}),
        record.status || "complete",
        record.error || null,
      ],
    );
    return this.messageDTO(rows[0]);
  }
  messageDTO(row) {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      conversationId: row.conversation_id,
      userId: row.user_id,
      role: row.role,
      content: row.content,
      ...row.metadata,
      status: row.status,
      error: row.error_code,
      createdAt: row.created_at.toISOString(),
    };
  }
  async latestUserMessage(ws, cid) {
    const row = (
      await this.pool.query(
        "SELECT * FROM messages WHERE workspace_id=$1 AND conversation_id=$2 AND role='user' ORDER BY created_at DESC,id DESC LIMIT 1",
        [ws, cid],
      )
    ).rows[0];
    return row ? this.messageDTO(row) : null;
  }
  async messagePage(ws, cid, { limit = 100, before } = {}) {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (before != null && (typeof before !== "string" || before.length > 128))
    )
      throw new AppError("VALIDATION_ERROR", "Invalid message page.", 400);
    const rows = (
      await this.pool.query(
        "SELECT * FROM messages WHERE workspace_id=$1 AND conversation_id=$2 AND ($3::text IS NULL OR (created_at,id)<(SELECT created_at,id FROM messages WHERE workspace_id=$1 AND conversation_id=$2 AND id=$3)) ORDER BY created_at DESC,id DESC LIMIT $4",
        [ws, cid, before || null, limit + 1],
      )
    ).rows;
    const items = rows
      .slice(0, limit)
      .reverse()
      .map((row) => this.messageDTO(row));
    return { items, nextCursor: rows.length > limit ? items[0].id : null };
  }
  async completeAssistantReply(actor, cid, record, replyTo) {
    return this.transaction(async (tx) => {
      const user = (
        await tx.pool.query(
          "SELECT id,created_at FROM messages WHERE workspace_id=$1 AND conversation_id=$2 AND id=$3 AND role='user'",
          [actor.workspaceId, cid, replyTo],
        )
      ).rows[0];
      if (!user)
        throw new AppError(
          "MESSAGE_REQUIRED",
          "The user message is unavailable.",
          409,
        );
      const latest = (
        await tx.pool.query(
          "SELECT id FROM messages WHERE workspace_id=$1 AND conversation_id=$2 AND role='user' ORDER BY created_at DESC,id DESC LIMIT 1",
          [actor.workspaceId, cid],
        )
      ).rows[0];
      if (latest?.id !== replyTo)
        throw new AppError(
          "REPLY_TURN_CHANGED",
          "The conversation changed before the response completed.",
          409,
        );
      const previous = (
        await tx.pool.query(
          "SELECT id FROM messages WHERE workspace_id=$1 AND conversation_id=$2 AND role='assistant' AND status IN ('complete','superseded') AND (created_at,id)>(SELECT created_at,id FROM messages WHERE workspace_id=$1 AND conversation_id=$2 AND id=$3) ORDER BY created_at DESC,id DESC LIMIT 1",
          [actor.workspaceId, cid, user.id],
        )
      ).rows[0];
      await tx.pool.query(
        "UPDATE messages SET status='superseded' WHERE workspace_id=$1 AND conversation_id=$2 AND role='assistant' AND status='complete' AND (created_at,id)>(SELECT created_at,id FROM messages WHERE workspace_id=$1 AND conversation_id=$2 AND id=$3)",
        [actor.workspaceId, cid, user.id],
      );
      return tx.createMessage(actor, cid, {
        ...record,
        metadata: {
          ...record.metadata,
          replyTo,
          previousVersionId: previous?.id || null,
        },
      });
    });
  }
  async activeMessages(ws, cid, { limit = 16 } = {}) {
    const rows = (
      await this.pool.query(
        "SELECT * FROM messages WHERE workspace_id=$1 AND conversation_id=$2 AND status='complete' ORDER BY created_at DESC,id DESC LIMIT $3",
        [ws, cid, Math.min(100, Math.max(1, limit))],
      )
    ).rows;
    return rows.reverse().map((row) => this.messageDTO(row));
  }
  async messages(ws, cid, { limit = 100, before } = {}) {
    const { rows } = await this.pool.query(
      "SELECT * FROM messages WHERE workspace_id=$1 AND conversation_id=$2 AND ($3::text IS NULL OR (created_at,id) < (SELECT created_at,id FROM messages WHERE workspace_id=$1 AND conversation_id=$2 AND id=$3)) ORDER BY created_at DESC,id DESC LIMIT $4",
      [ws, cid, before || null, Math.min(Math.max(limit, 1), 100)],
    );
    return rows.reverse().map((row) => this.messageDTO(row));
  }
  async message(ws, id) {
    const { rows } = await this.pool.query(
      "SELECT * FROM messages WHERE workspace_id=$1 AND id=$2",
      [ws, id],
    );
    return rows[0] ? this.messageDTO(rows[0]) : null;
  }
  async editLatestUserMessage(actor, id, content) {
    return this.transaction(async (tx) => {
      let row = (
        await tx.pool.query(
          "SELECT * FROM messages WHERE workspace_id=$1 AND id=$2",
          [actor.workspaceId, id],
        )
      ).rows[0];
      if (!row) throw new AppError("NOT_FOUND", "Message not found.", 404);
      if (row.role !== "user" || row.user_id !== actor.user.id)
        throw new AppError(
          "FORBIDDEN",
          "Only your own user messages may be edited.",
          403,
        );
      const locked = (
        await tx.pool.query(
          "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked",
          [actor.workspaceId + ":chat:" + row.conversation_id],
        )
      ).rows[0].locked;
      if (!locked)
        throw new AppError(
          "CONVERSATION_BUSY",
          "Wait for the current response to finish before editing.",
          409,
        );
      row = (
        await tx.pool.query(
          "SELECT * FROM messages WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
          [actor.workspaceId, id],
        )
      ).rows[0];
      const latest = (
        await tx.pool.query(
          "SELECT id FROM messages WHERE workspace_id=$1 AND conversation_id=$2 AND role='user' ORDER BY created_at DESC,id DESC LIMIT 1",
          [actor.workspaceId, row.conversation_id],
        )
      ).rows[0];
      if (latest?.id !== id)
        throw new AppError(
          "MESSAGE_EDIT_CONFLICT",
          "Only the latest user message can be edited. Older branches remain unchanged.",
          409,
        );
      const revisions = [
        ...(row.metadata?.revisions || []),
        { content: row.content, editedAt: new Date().toISOString() },
      ].slice(-5);
      await tx.pool.query(
        "UPDATE messages SET content=$3,metadata=$4 WHERE workspace_id=$1 AND id=$2",
        [
          actor.workspaceId,
          id,
          content,
          JSON.stringify({ ...row.metadata, revisions }),
        ],
      );
      await tx.pool.query(
        "UPDATE messages SET status='superseded' WHERE workspace_id=$1 AND conversation_id=$2 AND role='assistant' AND (created_at,id)>(SELECT created_at,id FROM messages WHERE workspace_id=$1 AND conversation_id=$2 AND id=$3)",
        [actor.workspaceId, row.conversation_id, row.id],
      );
      await tx.audit(actor, "message.edited", {
        messageId: id,
        conversationId: row.conversation_id,
      });
      return { conversationId: row.conversation_id, messageId: id };
    });
  }
  async analystSnapshot(ws) {
    const row = (
      await this.pool.query(
        "SELECT state,version FROM analyst_states WHERE workspace_id=$1",
        [ws],
      )
    ).rows[0];
    return { state: row?.state || null, revision: Number(row?.version || 0) };
  }
  async analystState(ws) {
    return (
      (
        await this.pool.query(
          "SELECT state FROM analyst_states WHERE workspace_id=$1",
          [ws],
        )
      ).rows[0]?.state || null
    );
  }
  async saveAnalystState(ws, state, expectedVersion) {
    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        ws + ":analyst",
      ]);
      const previous = (
        await client.query(
          "SELECT version FROM analyst_states WHERE workspace_id=$1 FOR UPDATE",
          [ws],
        )
      ).rows[0];
      if (
        expectedVersion != null &&
        Number(previous?.version || 0) !== expectedVersion
      )
        throw new AppError(
          "STATE_CONFLICT",
          "Analyst state changed. Reload and retry.",
          409,
        );
      await client.query(
        "INSERT INTO analyst_states(workspace_id,state) VALUES($1,$2) ON CONFLICT(workspace_id) DO UPDATE SET state=excluded.state,version=analyst_states.version+1,updated_at=now()",
        [ws, JSON.stringify(state)],
      );
    });
  }
  async usage(actor, data) {
    await this.pool.query(
      "INSERT INTO usage_ledger(workspace_id,user_id,provider_id,model,input_tokens,output_tokens,estimated_cost_micros,request_id,latency_ms,ttft_ms,status,tokens_estimated,pricing_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(workspace_id,request_id) WHERE request_id IS NOT NULL DO NOTHING",
      [
        actor.workspaceId,
        actor.user.id,
        data.providerId,
        data.model,
        data.inputTokens || 0,
        data.outputTokens || 0,
        data.costMicros || 0,
        data.requestId,
        data.latencyMs,
        data.ttftMs,
        data.status || "completed",
        !!data.estimated,
        data.pricingVersion || null,
      ],
    );
  }
  async usageSummary(ws) {
    return (
      await this.pool.query(
        'SELECT date_trunc(\'day\',created_at) AS day,model,provider_id AS "providerId",sum(input_tokens) AS "inputTokens",sum(output_tokens) AS "outputTokens",sum(estimated_cost_micros)/1000000.0 AS "estimatedCost",bool_or(pricing_version=\'unpriced\') AS "hasUnpricedRequests",count(*) AS requests FROM usage_ledger WHERE workspace_id=$1 AND created_at >= now()-interval \'31 days\' GROUP BY 1,2,3 ORDER BY 1 DESC LIMIT 100',
        [ws],
      )
    ).rows;
  }
}
