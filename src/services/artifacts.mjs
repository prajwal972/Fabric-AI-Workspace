import { projectFiles, zipStore } from "./artifacts-format.mjs";
import { newId } from "../security/crypto.mjs";
import { AppError } from "../server/errors.mjs";
import { logger } from "../observability/index.mjs";
export class ArtifactService {
  constructor({ repo, storage, storageCleanup }) {
    Object.assign(this, { repo, storage, storageCleanup });
  }
  async create(actor, input) {
    const message = await this.repo.message(actor.workspaceId, input.messageId);
    if (
      !message ||
      message.role !== "assistant" ||
      !["complete", "superseded"].includes(message.status)
    )
      throw new AppError(
        "MESSAGE_REQUIRED",
        "Select a completed assistant message.",
        400,
      );
    const files = projectFiles(message.content);
    const size = files.reduce((a, f) => a + Buffer.byteLength(f.content), 0);
    if (!files.length || size > 2e6)
      throw new AppError(
        "ARTIFACT_INVALID",
        "The response has no valid bounded project files.",
        400,
      );
    const id = newId("art");
    return this.persist(actor, id, zipStore(files), "application/zip", {
      id,
      userId: actor.user.id,
      messageId: message.id,
      name: String(input.name || "Fabric output").slice(0, 120),
      objectKey: this.storage.key(actor.workspaceId, id),
      files: files.map((f) => ({
        path: f.path,
        size: Buffer.byteLength(f.content),
      })),
      size,
    });
  }
  async report(actor, input) {
    const id = newId("art"),
      body = JSON.stringify(input.result, null, 2);
    if (body.length > 2e6)
      throw new AppError(
        "ARTIFACT_LIMIT",
        "Report exceeds its size limit.",
        400,
      );
    return this.persist(actor, id, body, "application/json", {
      id,
      userId: actor.user.id,
      name: String(input.name || "Analysis report").slice(0, 120),
      objectKey: this.storage.key(actor.workspaceId, id),
      files: [],
      size: Buffer.byteLength(body),
    });
  }
  async persist(actor, id, body, contentType, metadata) {
    await this.storage.put({
      workspaceId: actor.workspaceId,
      objectId: id,
      body,
      contentType,
    });
    try {
      return await this.repo.artifacts.create(actor.workspaceId, metadata);
    } catch (error) {
      try {
        await this.storage.delete({
          workspaceId: actor.workspaceId,
          objectId: id,
        });
      } catch (cleanup) {
        logger.error({
          event: "artifact.orphan_cleanup_failed",
          workspaceId: actor.workspaceId,
          objectId: id,
          requestId: actor.requestId,
          code: cleanup.code || "STORAGE_DELETE_FAILED",
        });
      }
      throw error;
    }
  }
  async delete(actor, id) {
    return this.storageCleanup.delete(actor, "artifact", id);
  }
  async download(actor, id) {
    const row = await this.repo.artifacts.require(actor.workspaceId, id);
    return {
      row,
      object: await this.storage.get({
        workspaceId: actor.workspaceId,
        objectId: id,
      }),
    };
  }
}
