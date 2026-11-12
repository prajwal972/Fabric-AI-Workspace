import { DATASET_ERROR_MESSAGES } from "../analyst/dataset.mjs";
import { withResourceLease } from "../infrastructure/resource-lease.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { inspectUpload, scanUpload } from "./security.mjs";
import { newId } from "../security/crypto.mjs";
import { AppError } from "../server/errors.mjs";
export function kindFor(name, mime) {
  const ext = path.extname(name).toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (
    mime.startsWith("text/") ||
    [".json", ".jsonl", ".csv", ".tsv", ".md", ".txt", ".js", ".py", ".sql"].includes(ext)
  )
    return "text";
  return "document";
}
export class FileService {
  constructor({ repo, storage, jobs, rag, storageCleanup, env = process.env }) {
    Object.assign(this, { repo, storage, jobs, rag, env, storageCleanup });
  }
  async upload(actor, req, name, mime) {
    const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "fabric-upload-"),
      ),
      local = path.join(directory, "upload"),
      id = newId("fil"),
      digest = crypto.createHash("sha256");
    let size = 0;
    const handle = await fs.open(local, "wx", 0o600);
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 250 * 1024 * 1024)
          throw new AppError("FILE_TOO_LARGE", "File exceeds 250 MB.", 413);
        digest.update(chunk);
        await handle.write(chunk);
      }
      await handle.close();
      if (!size) throw new AppError("EMPTY_FILE", "The file is empty.", 400);
      const inspection = await inspectUpload(local, {
        name,
        declaredMime: mime,
      });
      const kind = kindFor(name, mime),
        objectId = id;
      await this.storage.put({
        workspaceId: actor.workspaceId,
        objectId,
        body: (await import("node:fs")).createReadStream(local),
        contentType: inspection.detectedMime || mime,
        contentLength: size,
      });
      let file;
      try {
        const created = await this.repo.transaction(async (tx) => {
          file = await tx.files.create(actor.workspaceId, {
            id,
            userId: actor.user.id,
            name: name.slice(0, 254),
            objectKey: this.storage.key(actor.workspaceId, objectId),
            mime: inspection.detectedMime || mime,
            declaredMime: mime,
            size,
            sha256: digest.digest(),
            status: "quarantined",
            kind,
          });
          const job = await this.jobs.create(
            actor,
            "file-process",
            { fileId: id },
            "process-" + id,
            tx,
          );
          await tx.audit(actor, "file.uploaded", { fileId: id, size });
          return { file, job };
        });
        const job = created.job;
        return {
          ...this.publicFile(file),
          jobId: job.id,
          status: "processing",
        };
      } catch (e) {
        await this.storage
          .delete({ workspaceId: actor.workspaceId, objectId })
          .catch(() => {});
        throw e;
      }
    } finally {
      await handle.close().catch(() => {});
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
  publicFile(file) {
    const { text, objectKey, extractedObjectKey, sha256, pages, ...row } = file;
    return {
      ...row,
      status: ["quarantined", "scanning"].includes(row.status)
        ? "processing"
        : row.status,
      downloadable: true,
      preview: (text || "").slice(0, 320),
      extractedCharacters: (text || "").length,
    };
  }
  async process(actor, input, options) {
    return withResourceLease(
      this.repo.pool,
      `${actor.workspaceId}:storage:file:${input.fileId}`,
      options.signal,
      () => this.processLocked(actor, input, options),
    );
  }
  async processLocked(actor, { fileId }, { signal, progress }) {
    let file = await this.repo.files.require(actor.workspaceId, fileId);
    if (file.status === "ready" && ["ready", "empty"].includes(file.ragStatus))
      return { fileId, status: "ready", ragStatus: file.ragStatus };
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-parse-")),
      local = path.join(dir, path.basename(file.name));
    try {
      await this.repo.files.update(actor.workspaceId, file.id, {
        status: "scanning",
      });
      const object = await this.storage.get({
        workspaceId: actor.workspaceId,
        objectId: file.id,
        signal,
      });
      const handle = await fs.open(local, "wx", 0o600);
      let bytes = 0;
      try {
        for await (const chunk of object.Body) {
          signal.throwIfAborted();
          bytes += chunk.length;
          if (bytes > 250 * 1024 * 1024) throw new Error("Object too large");
          await handle.write(chunk);
        }
      } finally {
        await handle.close();
      }
      await scanUpload(local, this.env);
      await progress(20);
      await this.repo.files.update(actor.workspaceId, file.id, {
        status: "processing",
      });
      const parsed = await this.parse(local, file, signal);
      await progress(60);
      const extractedId = file.id + ".text";
      await this.storage.put({
        workspaceId: actor.workspaceId,
        objectId: extractedId,
        body: parsed.text,
        contentType: "text/plain",
        signal,
      });
      let chunks = 0,
        ragStatus = "empty";
      if (parsed.text) {
        try {
          chunks = await this.rag.index(actor, file, parsed.pages, signal);
          ragStatus = "ready";
        } catch (error) {
          if (error.code === "EMBEDDING_PROVIDER_REQUIRED")
            ragStatus = "blocked_requires_embedding_provider";
          else if (
            [
              "AI_USER_DAILY_LIMIT",
              "AI_WORKSPACE_DAILY_LIMIT",
              "AI_CLOUD_DISABLED",
              "EMAIL_VERIFICATION_REQUIRED",
            ].includes(error.code)
          )
            ragStatus = "blocked_ai_policy";
          else throw error;
        }
      }
      await progress(95);
      await this.repo.files.update(actor.workspaceId, file.id, {
        status: "ready",
        ragStatus,
        text: parsed.text,
        extraction: parsed.method,
        pages: parsed.pages.map((p) => ({
          pageNumber: p.pageNumber,
          characters: p.text.length,
          ...(p.dataset ? { dataset: p.dataset } : {}),
        })),
        extractedObjectKey: this.storage.key(actor.workspaceId, extractedId),
        error: null,
      });
      return { fileId, status: "ready", chunks, ragStatus };
    } catch (error) {
      // Logical deletion wins; never resurrect metadata or hide the original error.
      if (await this.repo.files.get(actor.workspaceId, file.id))
        await this.repo.files.update(actor.workspaceId, file.id, {
          status: "failed",
          error: error.code || "FILE_PROCESSING_FAILED",
        });
      throw error;
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
  parse(local, file, signal) {
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--max-old-space-size=128",
          fileURLToPath(new URL("./parser-process.mjs", import.meta.url)),
          "--parse",
          local,
          file.name,
          file.kind,
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
          env: { PATH: process.env.PATH },
          detached: process.platform !== "win32",
        },
      );
      let output = "",
        errors = "";
      const kill = () => {
        try {
          if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {}
      };
      const abort = () => kill();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) kill();
      const timer = setTimeout(kill, 60000);
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.length > 5e6) kill();
      });
      child.stderr.on("data", (chunk) => {
        if (errors.length < 2000) errors += chunk;
      });
      child.on("error", () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(
          new AppError(
            "PARSER_FAILED",
            "Document extraction could not complete.",
            422,
          ),
        );
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (code !== 0) {
          let details;
          try {
            details = JSON.parse(errors);
          } catch {}
          if (Object.hasOwn(DATASET_ERROR_MESSAGES, details?.code || ""))
            return reject(
              new AppError(
                details.code,
                DATASET_ERROR_MESSAGES[details.code],
                422,
              ),
            );
          return reject(
            new AppError(
              "PARSER_FAILED",
              "Document extraction could not complete.",
              422,
            ),
          );
        }
        try {
          resolve(JSON.parse(output));
        } catch {
          reject(
            new AppError(
              "PARSER_FAILED",
              "Document extraction returned an invalid result.",
              422,
            ),
          );
        }
      });
    });
  }
  async delete(actor, id) {
    return this.storageCleanup.delete(actor, "file", id);
  }
  async download(actor, id) {
    const file = await this.repo.files.require(actor.workspaceId, id);
    return {
      file,
      object: await this.storage.get({
        workspaceId: actor.workspaceId,
        objectId: file.id,
      }),
    };
  }
}
