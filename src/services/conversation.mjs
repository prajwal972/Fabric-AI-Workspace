import crypto from "node:crypto";
import { z } from "zod";
import { can } from "../security/rbac.mjs";
import { AppError } from "../server/errors.mjs";
const payload = z.object({
  title: z.string().max(120).optional(),
  systemInstructions: z.string().max(4000).optional(),
});
const paging = z.object({
  query: z.string().max(254).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
const parse = (schema, value) => {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError(
      "VALIDATION_ERROR",
      "Invalid conversation request.",
      400,
    );
  return result.data;
};
export class ConversationService {
  constructor(repository) {
    this.repository = repository;
  }
  authorize(actor, write = false) {
    if (!actor?.workspaceId || !actor?.user?.id)
      throw new AppError("UNAUTHORIZED", "Sign in required.", 401);
    if (!can(actor.role, write ? "chat.write" : "workspace.read"))
      throw new AppError(
        "FORBIDDEN",
        "You do not have permission to perform this action.",
        403,
      );
  }
  list(actor, options = {}) {
    this.authorize(actor);
    return this.repository.list(actor.workspaceId, parse(paging, options));
  }
  async get(actor, id) {
    this.authorize(actor);
    const row = await this.repository.get(actor.workspaceId, id);
    if (!row) throw new AppError("NOT_FOUND", "Conversation not found.", 404);
    return row;
  }
  async create(actor, input = {}) {
    this.authorize(actor, true);
    const data = parse(payload, input);
    const row = await this.repository.create(actor.workspaceId, {
      id: "con_" + crypto.randomUUID(),
      userId: actor.user.id,
      title: (data.title || "New conversation").replace(/\0/g, ""),
      systemInstructions: (data.systemInstructions || "").replace(/\0/g, ""),
    });
    if (!row)
      throw new AppError("FORBIDDEN", "Workspace membership is required.", 403);
    return row;
  }
  async update(actor, id, input) {
    this.authorize(actor, true);
    const data = parse(payload, input);
    if (data.title !== undefined)
      data.title = data.title.replace(/\0/g, "") || "Untitled";
    if (data.systemInstructions !== undefined)
      data.systemInstructions = data.systemInstructions.replace(/\0/g, "");
    const row = await this.repository.update(actor.workspaceId, id, data);
    if (!row) throw new AppError("NOT_FOUND", "Conversation not found.", 404);
    return row;
  }
  async delete(actor, id) {
    this.authorize(actor, true);
    if (!(await this.repository.delete(actor.workspaceId, id)))
      throw new AppError("NOT_FOUND", "Conversation not found.", 404);
    return { ok: true };
  }
}
