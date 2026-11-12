import { withTransaction } from "../database/transaction.mjs";

const columns =
  "id, workspace_id, created_by, title, system_instructions, created_at, updated_at";
const timestamp = (value) =>
  value instanceof Date ? value.toISOString() : value;
const dto = (row) =>
  row
    ? {
        id: row.id,
        workspaceId: row.workspace_id,
        userId: row.created_by,
        title: row.title,
        systemInstructions: row.system_instructions,
        createdAt: timestamp(row.created_at),
        updatedAt: timestamp(row.updated_at),
      }
    : null;
function scope(workspaceId) {
  if (typeof workspaceId !== "string" || !workspaceId)
    throw new TypeError("Workspace scope is required");
}

/** Canonical production PostgreSQL queries; the local adapter is demo-only. */
export class PostgresConversationRepository {
  constructor(pool) {
    this.pool = pool;
  }
  async list(workspaceId, { query = "", limit = 50, offset = 0 } = {}) {
    scope(workspaceId);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 100000
    )
      throw new TypeError("Invalid pagination");
    const { rows } = await this.pool.query(
      `SELECT ${columns} FROM conversations WHERE workspace_id = $1 AND deleted_at IS NULL AND ($2 = '' OR strpos(lower(title), lower($2)) > 0) ORDER BY updated_at DESC, id DESC LIMIT $3 OFFSET $4`,
      [workspaceId, query, limit + 1, offset],
    );
    return {
      items: rows.slice(0, limit).map(dto),
      nextOffset: rows.length > limit ? offset + limit : null,
    };
  }
  async get(workspaceId, id) {
    scope(workspaceId);
    const { rows } = await this.pool.query(
      `SELECT ${columns} FROM conversations WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [workspaceId, id],
    );
    return dto(rows[0]);
  }
  async create(workspaceId, record) {
    scope(workspaceId);
    const { rows } = await this.pool.query(
      `INSERT INTO conversations(id, workspace_id, created_by, title, system_instructions) SELECT $1, $2, $3, $4, $5 WHERE EXISTS (SELECT 1 FROM memberships WHERE workspace_id = $2 AND user_id = $3) RETURNING ${columns}`,
      [
        record.id,
        workspaceId,
        record.userId,
        record.title,
        record.systemInstructions,
      ],
    );
    return dto(rows[0]);
  }
  async update(workspaceId, id, patch) {
    scope(workspaceId);
    const { rows } = await this.pool.query(
      `UPDATE conversations SET title = COALESCE($3, title), system_instructions = COALESCE($4, system_instructions), updated_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL RETURNING ${columns}`,
      [workspaceId, id, patch.title ?? null, patch.systemInstructions ?? null],
    );
    return dto(rows[0]);
  }
  async delete(workspaceId, id) {
    scope(workspaceId);
    return withTransaction(this.pool, async (client) => {
      const { rows } = await client.query(
        "UPDATE conversations SET deleted_at = now(), updated_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL RETURNING id",
        [workspaceId, id],
      );
      if (!rows.length) return false;
      await client.query(
        "DELETE FROM messages WHERE workspace_id = $1 AND conversation_id = $2",
        [workspaceId, id],
      );
      return true;
    });
  }
}

/** Compatibility repository for local/demo mode only. No production SQL facade. */
export class LocalConversationRepository {
  constructor({ getStore, save }) {
    this.getStore = getStore;
    this.save = save;
  }
  async list(workspaceId, { query = "", limit = 50, offset = 0 } = {}) {
    scope(workspaceId);
    const rows = this.getStore()
      .conversations.filter(
        (row) =>
          row.workspaceId === workspaceId &&
          (!query || row.title.toLowerCase().includes(query.toLowerCase())),
      )
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
      );
    return {
      items: rows.slice(offset, offset + limit),
      nextOffset: rows.length > offset + limit ? offset + limit : null,
    };
  }
  async get(workspaceId, id) {
    scope(workspaceId);
    return (
      this.getStore().conversations.find(
        (row) => row.workspaceId === workspaceId && row.id === id,
      ) || null
    );
  }
  async create(workspaceId, record) {
    scope(workspaceId);
    const stamp = new Date().toISOString();
    const row = { ...record, workspaceId, createdAt: stamp, updatedAt: stamp };
    this.getStore().conversations.push(row);
    await this.save();
    return row;
  }
  async update(workspaceId, id, patch) {
    const row = await this.get(workspaceId, id);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date().toISOString() });
    await this.save();
    return row;
  }
  async delete(workspaceId, id) {
    if (!(await this.get(workspaceId, id))) return false;
    const db = this.getStore();
    db.messages = db.messages.filter(
      (row) => !(row.workspaceId === workspaceId && row.conversationId === id),
    );
    db.conversations = db.conversations.filter(
      (row) => !(row.workspaceId === workspaceId && row.id === id),
    );
    await this.save();
    return true;
  }
}
