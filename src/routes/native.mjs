import { json, body, nativePublic } from "../server/http.mjs";

export async function nativeRoutes({
  ctx,
  actor,
  req,
  res,
  p,
  method,
  u,
  controller,
}) {
  if (p.startsWith("/api/native/")) {
    if (method === "GET")
      return json(res, 200, nativePublic(await ctx.nativeRuntime.status()));
    const data = await body(req),
      component = ["llm", "voice", "all"].includes(data.component)
        ? data.component
        : "all";
    if (p.endsWith("/install"))
      return json(res, 202, await ctx.nativeRuntime.install(component));
    if (p.endsWith("/start")) {
      if (component !== "voice") await ctx.nativeRuntime.ensureLlm();
      if (component !== "llm") await ctx.nativeRuntime.ensureStt();
      return json(res, 200, nativePublic(await ctx.nativeRuntime.status()));
    }
  }
}
