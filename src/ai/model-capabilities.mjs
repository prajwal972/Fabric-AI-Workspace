import { AppError } from "../server/errors.mjs";
// Process-local, workspace/config-scoped metadata cache. No prompts, credentials
// or raw model templates are retained. It is not a universal model catalog.
export class ModelCapabilityResolver {
  constructor({ maxEntries = 100, ttlMs = 300000 } = {}) {
    if (
      !Number.isInteger(maxEntries) ||
      maxEntries < 1 ||
      maxEntries > 1000 ||
      !Number.isInteger(ttlMs) ||
      ttlMs < 1 ||
      ttlMs > 3600000
    )
      throw new TypeError("Invalid model metadata cache bounds");
    this.entries = new Map();
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }
  async resolve(actor, row, model, adapter, signal) {
    signal?.throwIfAborted();
    const base = adapter.getCapabilities();
    if (row.type !== "ollama" || typeof adapter.inspectModel !== "function")
      return base;
    if (typeof model !== "string" || !model || model.length > 200)
      throw new AppError("MODEL_REQUIRED", "Select a valid model first.", 400);
    const key = JSON.stringify([
      actor.workspaceId,
      row.id,
      model,
      row.config?.baseUrl,
      row.config?.contextWindow,
    ]);
    const cached = this.entries.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    let value,
      ttl = this.ttlMs;
    try {
      value = await adapter.inspectModel(
        model,
        AbortSignal.any([
          ...(signal ? [signal] : []),
          AbortSignal.timeout(2500),
        ]),
      );
    } catch {
      if (signal?.aborted) signal.throwIfAborted();
      value = {
        ...base,
        tools: false,
        capabilitiesVerified: false,
        capabilitySource: "unavailable",
      };
      ttl = 30000;
    }
    if (this.entries.size >= this.maxEntries)
      this.entries.delete(this.entries.keys().next().value);
    this.entries.set(key, { value, expires: Date.now() + ttl });
    return value;
  }
  clear() {
    this.entries.clear();
  }
}
