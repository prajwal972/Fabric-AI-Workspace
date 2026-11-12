import { z } from "zod";
import { can } from "../security/rbac.mjs";
import { AppError } from "../server/errors.mjs";
export class ProviderService {
  constructor({ repo, box, ai, env = process.env }) {
    Object.assign(this, { repo, box, ai, env });
  }
  public(row) {
    const { credential, ...record } = row;
    return { ...record, hasCredential: !!credential };
  }
  async bootstrap(actor) {
    if (
      (await this.repo.providers.list(actor.workspaceId, { limit: 1 })).items
        .length
    )
      return;
    await this.repo.providers.create(actor.workspaceId, {
      type: "fabric-native",
      name: "Fabric1.0",
      config: { defaultModel: "fabric:1.0" },
      models: [{ id: "fabric:1.0", name: "Fabric1.0" }],
      enabled: true,
      isDefault: !this.env.FABRIC_TEST_MOCK,
      status: "unchecked",
    });
    if (this.env.NODE_ENV === "test" && this.env.FABRIC_TEST_MOCK === "1")
      await this.repo.providers.create(actor.workspaceId, {
        type: "mock",
        name: "Fabric Mock (testing)",
        config: { defaultModel: "flux-mock-1" },
        models: [{ id: "flux-mock-1", name: "Fabric Mock" }],
        enabled: true,
        isDefault: true,
        status: "connected",
      });
  }
  async save(actor, input, id) {
    const schema = z.object({
      type: z.enum(["openai-compatible", "anthropic", "ollama"]),
      name: z.string().min(1).max(80),
      baseUrl: z.string().url(),
      defaultModel: z.string().max(200).default(""),
      apiKey: z.string().max(10000).optional(),
      embeddingModel: z.string().max(200).optional(),
      contextWindow: z.number().int().min(1024).max(2000000).optional(),
    });
    const current = id
      ? await this.repo.providers.require(actor.workspaceId, id)
      : null;
    const data = schema.parse({
      ...current,
      ...input,
      type: input.type || current?.type,
      baseUrl: input.baseUrl || current?.config?.baseUrl,
      defaultModel: input.defaultModel ?? current?.config?.defaultModel,
    });
    const u = new URL(data.baseUrl);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
      throw new AppError(
        "INVALID_PROVIDER_URL",
        "Only credential-free HTTP(S) provider URLs are allowed.",
        400,
      );
    let credential = data.apiKey
      ? this.box.encrypt(data.apiKey)
      : current?.credential || null;
    if (data.type === "ollama") credential = null;
    if (data.type !== "ollama" && !credential)
      throw new AppError(
        "CREDENTIAL_REQUIRED",
        "A provider API key is required.",
        400,
      );
    const fields = {
      type: data.type,
      name: data.name,
      config: {
        baseUrl: data.baseUrl,
        defaultModel: data.defaultModel,
        embeddingModel: data.embeddingModel || current?.config?.embeddingModel,
        contextWindow: data.contextWindow || current?.config?.contextWindow,
      },
      credential,
      models: data.defaultModel
        ? [{ id: data.defaultModel, name: data.defaultModel }]
        : [],
      status: "unchecked",
      lastError: null,
    };
    const row = id
      ? await this.repo.providers.update(actor.workspaceId, id, fields)
      : await this.repo.providers.create(actor.workspaceId, {
          ...fields,
          enabled: true,
          isDefault: false,
        });
    await this.repo.audit(actor, "provider.saved", {
      id: row.id,
      type: row.type,
    });
    return this.public(row);
  }
  async default(actor, id) {
    await this.repo.providers.require(actor.workspaceId, id);
    await this.repo.transaction(async (tx) => {
      await tx.pool.query(
        "UPDATE providers SET is_default=false WHERE workspace_id=$1",
        [actor.workspaceId],
      );
      await tx.pool.query(
        "UPDATE providers SET is_default=true WHERE workspace_id=$1 AND id=$2",
        [actor.workspaceId, id],
      );
    });
  }
  async action(actor, id, action, input = {}) {
    const row = await this.repo.providers.require(actor.workspaceId, id);
    try {
      if (action === "default") {
        await this.default(actor, id);
        return { ok: true };
      }
      if (action === "warm") {
        if (row.type !== "ollama")
          throw new AppError(
            "UNSUPPORTED_OPERATION",
            "Warm-up is available only for Ollama.",
            400,
          );
        const response = await this.ai.generate(actor, {
          providerId: id,
          model: input.model,
          messages: [{ role: "user", content: "Hello" }],
          maxTokens: 1,
        });
        return { ok: true };
      }
      const models = await this.ai.adapter(row).models();
      await this.repo.providers.update(actor.workspaceId, id, {
        models,
        status: "connected",
        lastError: null,
      });
      return action === "models"
        ? { items: models }
        : { ok: true, message: "Provider connected." };
    } catch (e) {
      await this.repo.providers.update(actor.workspaceId, id, {
        status: "error",
        lastError: e.code || "PROVIDER_ERROR",
      });
      throw e;
    }
  }
  async delete(actor, id) {
    const row = await this.repo.providers.require(actor.workspaceId, id);
    if (["fabric-native", "mock"].includes(row.type))
      throw new AppError(
        "BUILTIN_PROVIDER",
        "Built-in providers cannot be removed.",
        400,
      );
    await this.repo.providers.delete(actor.workspaceId, id);
    await this.repo.audit(actor, "provider.deleted", { id });
  }
}
