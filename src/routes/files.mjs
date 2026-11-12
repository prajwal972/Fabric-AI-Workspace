import { z } from "zod";
import { pipeline } from "node:stream/promises";
import { json, body, pageOptions } from "../server/http.mjs";

export async function filesRoutes({
  ctx,
  actor,
  req,
  res,
  p,
  method,
  u,
  controller,
}) {
  let match;
  if (p === "/api/files" && method === "GET") {
    const page = await ctx.repo.files.list(actor.workspaceId, pageOptions(u));
    return json(res, 200, {
      ...page,
      items: page.items.map((f) => ctx.files.publicFile(f)),
    });
  }
  if (p === "/api/files/upload" && method === "POST") {
    const name = decodeURIComponent(
      String(req.headers["x-file-name"] || "upload.bin"),
    ).replace(/[\r\n\0]/g, "");
    return json(
      res,
      202,
      await ctx.files.upload(
        actor,
        req,
        name,
        String(req.headers["content-type"] || "application/octet-stream"),
      ),
    );
  }
  if (p === "/api/files" && method === "POST") {
    const b = await body(req);
    const data = Buffer.from(
      z
        .string()
        .max(12e6)
        .parse(b.data || b.content || ""),
      b.data ? "base64" : "utf8",
    );
    const { Readable } = await import("node:stream");
    return json(
      res,
      202,
      await ctx.files.upload(
        actor,
        Readable.from([data]),
        String(b.name || "upload.txt"),
        String(b.mime || "text/plain"),
      ),
    );
  }
  match = p.match(/^\/api\/files\/([^/]+)(?:\/(download|retry))?$/);
  if (match) {
    if (match[2] === "download" && method === "GET") {
      const { file, object } = await ctx.files.download(actor, match[1]);
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition":
          'attachment; filename="' + file.name.replace(/["\r\n\\]/g, "_") + '"',
      });
      await pipeline(object.Body, res);
      return;
    }
    if (match[2] === "retry" && method === "POST") {
      const file = await ctx.repo.files.require(actor.workspaceId, match[1]);
      const job = await ctx.jobs.create(actor, "file-process", {
        fileId: file.id,
      });
      return json(res, 202, { jobId: job.id });
    }
    if (method === "DELETE") {
      return json(res, 200, await ctx.files.delete(actor, match[1]));
    }
    if (method === "GET") {
      const f = await ctx.repo.files.require(actor.workspaceId, match[1]);
      return json(res, 200, {
        ...ctx.files.publicFile(f),
        text: (f.text || "").slice(0, 500000),
      });
    }
  }
}
