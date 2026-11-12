import { pipeline } from "node:stream/promises";
import { json, body, pageOptions } from "../server/http.mjs";

export async function artifactsRoutes({
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
  if (p === "/api/artifacts") {
    if (method === "GET") {
      const page = await ctx.repo.artifacts.list(
        actor.workspaceId,
        pageOptions(u),
      );
      return json(res, 200, {
        ...page,
        items: page.items.map((row) => ({
          ...row,
          fileCount: row.files.length,
        })),
      });
    }
    if (method === "POST")
      return json(res, 201, await ctx.artifacts.create(actor, await body(req)));
  }
  match = p.match(/^\/api\/artifacts\/([^/]+)(?:\/(download))?$/);
  if (match) {
    if (method === "GET" && match[2]) {
      const { object } = await ctx.artifacts.download(actor, match[1]);
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": 'attachment; filename="fabric-artifact.zip"',
      });
      await pipeline(object.Body, res);
      return;
    }
    if (method === "DELETE") {
      return json(res, 200, await ctx.artifacts.delete(actor, match[1]));
    }
  }
}
