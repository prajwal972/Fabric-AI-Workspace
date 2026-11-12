import { hash } from "../security/crypto.mjs";
import { AppError, safeErrorMessage } from "./errors.mjs";
export const json = (res, status, data) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data));
};
export async function body(req, max = 20e6) {
  let count = 0,
    parts = [];
  for await (const chunk of req) {
    count += chunk.length;
    if (count > max)
      throw new AppError(
        "REQUEST_TOO_LARGE",
        "The request exceeds its size limit.",
        413,
      );
    parts.push(chunk);
  }
  try {
    return parts.length ? JSON.parse(Buffer.concat(parts)) : {};
  } catch {
    throw new AppError("INVALID_JSON", "Request JSON is invalid.", 400);
  }
}
export function cookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1));
      } catch {
        return "";
      }
    }
  }
  return "";
}
export function nativePublic(value) {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/(?:path|directory|secret|key|binary)$/i.test(key))
      .map(([key, v]) => [
        key,
        key === "error" && v ? safeErrorMessage(v, 503) : v,
      ]),
  );
}
export const pageOptions = (u) => ({
  limit: Number(u.searchParams.get("limit") || 50),
  offset: Number(u.searchParams.get("offset") || 0),
});
export async function limiter(ctx, key, max = 60) {
  const bucket =
    "fabric-rate:" + hash(key) + ":" + Math.floor(Date.now() / 60000);
  const value = await ctx.jobs.connection.eval(
    "local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],61) end;return n",
    1,
    bucket,
  );
  if (value > max)
    throw new AppError(
      "RATE_LIMIT",
      "Too many requests. Please retry later.",
      429,
    );
}
