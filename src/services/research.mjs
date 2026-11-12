import { networkFetch, boundedText } from "../security/network.mjs";
import { AppError } from "../server/errors.mjs";
export const htmlText = (value) =>
  String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export class ResearchService {
  constructor({ repo, env = process.env }) {
    this.repo = repo;
    this.env = env;
  }
  async search(actor, query, signal) {
    const ws = await this.repo.workspace(actor.workspaceId),
      endpoint = ws.researchUrl || this.env.FABRIC_RESEARCH_URL;
    if (!endpoint) return [];
    const u = new URL(endpoint),
      local = [
        "localhost",
        "127.0.0.1",
        "searxng",
        "host.docker.internal",
      ].includes(u.hostname);
    if (local && (u.protocol !== "http:" || u.port !== "8080"))
      throw new AppError(
        "UNSAFE_SEARCH_ENDPOINT",
        "Local SearXNG must use HTTP port 8080.",
        400,
      );
    if (!/\/search\/?$/.test(u.pathname))
      u.pathname = u.pathname.replace(/\/$/, "") + "/search";
    u.searchParams.set("q", query.slice(0, 500));
    u.searchParams.set("format", "json");
    u.searchParams.set("safesearch", "1");
    const r = await networkFetch(u, {
      allowPrivate: local,
      signal: AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(12000),
      ]),
      headers: { accept: "application/json" },
    });
    if (!r.ok)
      throw new AppError(
        "SEARCH_UNAVAILABLE",
        "The configured search service is unavailable.",
        502,
      );
    const result = JSON.parse(await boundedText(r, 300000));
    return (result.results || [])
      .slice(0, 6)
      .filter((x) => {
        try {
          return ["https:", "http:"].includes(new URL(x.url).protocol);
        } catch {
          return false;
        }
      })
      .map((x) => ({
        title: String(x.title || "").slice(0, 240),
        url: x.url,
        text: String(x.content || "").slice(0, 1500),
      }));
  }
  async bundle(actor, query, urls = [], signal) {
    const found = await this.search(actor, query, signal),
      candidates = [...urls.slice(0, 5).map((url) => ({ url })), ...found]
        .filter((x, i, a) => a.findIndex((y) => y.url === x.url) === i)
        .slice(0, 6);
    for (const source of candidates) {
      const u = new URL(source.url);
      if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
        throw new AppError(
          "UNSAFE_SOURCE",
          "Research sources must be credential-free public HTTP(S) URLs.",
          400,
        );
    }
    return Promise.all(
      candidates.map(async (source) => {
        try {
          const r = await networkFetch(source.url, {
            signal: AbortSignal.any([
              ...(signal ? [signal] : []),
              AbortSignal.timeout(10000),
            ]),
            headers: { accept: "text/html,text/plain,application/json" },
          });
          if (!r.ok) throw new Error("Source unavailable");
          const text = await boundedText(r, 120000);
          return {
            ...source,
            title:
              source.title ||
              htmlText(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) ||
              new URL(source.url).hostname,
            text: htmlText(text).slice(0, 18000),
            readStatus: "page",
          };
        } catch (e) {
          if (signal?.aborted || e.code === "UNSAFE_URL") throw e;
          return {
            ...source,
            title: source.title || new URL(source.url).hostname,
            text: source.text || "",
            readStatus: source.text ? "snippet" : "unavailable",
          };
        }
      }),
    );
  }
}
