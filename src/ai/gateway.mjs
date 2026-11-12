import { newId } from "../security/crypto.mjs";
import { providerAdapter } from "./providers.mjs";
import { ModelCapabilityResolver } from "./model-capabilities.mjs";
import { AppError } from "../server/errors.mjs";
export class AIGateway {
  constructor({
    repo,
    box,
    nativeRuntime,
    toolGateway,
    policy,
    env = process.env,
  }) {
    Object.assign(this, { repo, box, nativeRuntime, toolGateway, policy, env });
    this.capabilityResolver = new ModelCapabilityResolver();
    try {
      this.pricing = JSON.parse(env.FABRIC_MODEL_PRICING_JSON || "{}");
      if (
        !this.pricing ||
        Array.isArray(this.pricing) ||
        typeof this.pricing !== "object" ||
        Object.keys(this.pricing).length > 1000
      )
        throw new Error();
      for (const [model, price] of Object.entries(this.pricing)) {
        if (
          !model ||
          model.length > 200 ||
          !price ||
          typeof price !== "object" ||
          ![price.inputPerMillion, price.outputPerMillion].every(
            (value) =>
              typeof value === "number" &&
              Number.isFinite(value) &&
              value >= 0 &&
              value <= 1000000,
          ) ||
          (price.version != null &&
            (typeof price.version !== "string" ||
              !price.version ||
              price.version.length > 120))
        )
          throw new Error();
      }
    } catch {
      throw new Error(
        "Model pricing configuration must contain bounded nonnegative numeric input/output rates.",
      );
    }
  }
  countTokens(messages, tools = []) {
    return {
      tokens: Math.ceil(
        Buffer.byteLength(
          JSON.stringify({
            messages,
            ...(tools.length
              ? {
                  tools: tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    parameters: t.inputSchema,
                  })),
                }
              : {}),
          }),
        ) / 4,
      ),
      estimated: true,
    };
  }
  adapter(row) {
    if (
      row.type === "mock" &&
      ["production", "staging"].includes(this.env.NODE_ENV)
    )
      throw new AppError(
        "MOCK_DISABLED",
        "Testing providers are not available in production.",
        400,
      );
    return providerAdapter(row, this);
  }
  async choose(actor, id) {
    const providers = (
      await this.repo.providers.list(actor.workspaceId, { limit: 100 })
    ).items.filter((p) => p.enabled);
    const row = id
      ? providers.find((p) => p.id === id)
      : providers.find((p) => p.isDefault) || providers[0];
    if (!row)
      throw new AppError(
        "PROVIDER_REQUIRED",
        "Configure an enabled provider in Settings.",
        400,
      );
    return row;
  }
  getCapabilities(row) {
    return this.adapter(row).getCapabilities();
  }
  async resolveCapabilities(actor, row, model, signal) {
    return this.capabilityResolver.resolve(
      actor,
      row,
      model,
      this.adapter(row),
      signal,
    );
  }
  async generate(actor, options) {
    let text = "",
      toolCalls = [],
      usage;
    for await (const event of this.stream(actor, {
      ...options,
      executeTools: false,
    })) {
      if (event.text) text += event.text;
      if (event.toolCall) toolCalls.push(event.toolCall);
      if (event.usage) usage = event.usage;
    }
    return { text, toolCalls, usage };
  }
  async *stream(
    actor,
    {
      providerId,
      model,
      messages,
      tools = [],
      executeTools = true,
      signal,
      temperature = 0.7,
      maxTokens = 512,
      requestId = newId("ai"),
      runId,
      onEvent,
    },
  ) {
    if (this.policy) maxTokens = this.policy.outputLimit(maxTokens);
    let row = await this.choose(actor, providerId),
      selected = model || row.config?.defaultModel || row.models?.[0]?.id;
    if (!selected)
      throw new AppError(
        "MODEL_REQUIRED",
        "Select or configure a model first.",
        400,
      );
    let caps = await this.resolveCapabilities(actor, row, selected, signal);
    if (caps.completion === false)
      throw new AppError(
        "MODEL_CHAT_UNSUPPORTED",
        "The selected model is not chat-capable. Choose a completion model.",
        400,
      );
    if (tools.length && !caps.tools)
      throw new AppError(
        "TOOLS_UNSUPPORTED",
        "This model provider does not support tool calls.",
        400,
      );
    const maxRounds = Math.min(12, Number(this.env.MAX_AGENT_STEPS || 8));
    const controller = new AbortController(),
      combined = AbortSignal.any([
        ...(signal ? [signal] : []),
        controller.signal,
        AbortSignal.timeout(Number(this.env.MAX_TOTAL_RUNTIME || 120000)),
      ]);
    const history = structuredClone(messages);
    let toolCount = 0;
    for (let round = 0; round <= maxRounds; round++) {
      combined.throwIfAborted();
      if (
        this.countTokens(history, tools).tokens + maxTokens >
        caps.contextWindow
      )
        throw new AppError(
          "CONTEXT_LIMIT",
          "The conversation exceeds this model’s context limit. Reduce attachments or start a new chat.",
          400,
        );
      let text = "",
        calls = [],
        usage = null,
        outputStarted = false;
      const turnId = requestId + "/" + round;
      try {
        let attempt = 0;
        while (true) {
          try {
            for await (const event of this.providerAttempt(
              actor,
              row,
              selected,
              {
                messages: history,
                tools,
                maxTokens,
                temperature,
                signal: combined,
              },
              turnId + "/attempt-" + attempt,
            )) {
              if (event.text) {
                outputStarted = true;
                text += event.text;
                if (Buffer.byteLength(text) > 200000)
                  throw new AppError(
                    "MODEL_OUTPUT_LIMIT",
                    "The model response exceeded its size limit.",
                    502,
                  );
                yield event;
              }
              if (event.toolCall) {
                calls.push(event.toolCall);
                if (!executeTools) yield event;
              }
              if (event.usage) usage = event.usage;
            }
            break;
          } catch (error) {
            if (
              combined.aborted ||
              outputStarted ||
              calls.length ||
              attempt++ >= 2 ||
              !["PROVIDER_RATE_LIMIT", "PROVIDER_ERROR"].includes(error.code)
            )
              throw error;
            await new Promise((r) =>
              setTimeout(r, Math.min(2000, 250 * 2 ** attempt)),
            );
            if (attempt === 2 && !providerId && !model) {
              const alternate = (
                await this.repo.providers.list(actor.workspaceId, {
                  limit: 100,
                })
              ).items.find(
                (p) => p.id !== row.id && p.enabled && p.type !== "mock",
              );
              if (alternate) {
                row = alternate;
                selected = row.config?.defaultModel || row.models?.[0]?.id;
                caps = await this.resolveCapabilities(
                  actor,
                  row,
                  selected,
                  combined,
                );
                if (
                  !selected ||
                  caps.completion === false ||
                  (tools.length && !caps.tools) ||
                  this.countTokens(history, tools).tokens + maxTokens >
                    caps.contextWindow
                )
                  throw error;
              }
            }
          }
        }
        await this.repo.providers.update(actor.workspaceId, row.id, {
          status: "connected",
          lastError: null,
        });
      } catch (error) {
        if (error.code === "TOOLS_UNSUPPORTED") this.capabilityResolver.clear();
        // An operator/quota/authorization denial is not provider ill health.
        if (
          !error.code?.startsWith("AI_") &&
          ![
            "FORBIDDEN",
            "EMAIL_VERIFICATION_REQUIRED",
            "PROVIDER_CONFIGURATION_CHANGED",
            "PROVIDER_DISABLED",
          ].includes(error.code)
        )
          await this.repo.providers.update(actor.workspaceId, row.id, {
            status: "error",
            lastError: error.code || "PROVIDER_ERROR",
          });
        throw error;
      }

      yield { usage: { ...usage, providerId: row.id, model: selected } };
      if (!executeTools || !calls.length) return;
      if (round === maxRounds || toolCount + calls.length > maxRounds)
        throw new AppError(
          "AGENT_STEP_LIMIT",
          "The tool execution limit was reached.",
          422,
        );
      history.push({ role: "assistant", content: text, toolCalls: calls });
      for (const call of calls) {
        toolCount++;
        await onEvent?.({ type: "tool", name: call.name, status: "executing" });
        const result = await this.toolGateway.execute(
          actor,
          call.name,
          call.input,
          { signal: combined, runId },
        );
        history.push({ role: "tool", toolCallId: call.id, content: result });
        await onEvent?.({
          type: "tool",
          name: call.name,
          status: "completed",
          result,
        });
      }
    }
  }
  async authorizeAttempt(actor, row, signal) {
    signal?.throwIfAborted();
    if (this.policy) return this.policy.admit(actor, row, signal);
    if (["production", "staging"].includes(this.env.NODE_ENV))
      throw new AppError(
        "AI_POLICY_UNAVAILABLE",
        "AI admission controls are unavailable.",
        503,
      );
  }
  async recordAttempt(
    actor,
    row,
    model,
    messages,
    text,
    usage,
    metadata,
    tools = [],
  ) {
    const valid = (value) =>
      Number.isSafeInteger(value) && value >= 0 && value <= 1000000000;
    const estimated = !valid(usage?.inputTokens) || !valid(usage?.outputTokens);
    const inputTokens = valid(usage?.inputTokens)
      ? usage.inputTokens
      : this.countTokens(messages, tools).tokens;
    const outputTokens = valid(usage?.outputTokens)
      ? usage.outputTokens
      : Math.ceil(Buffer.byteLength(text) / 4);
    const price = this.pricing[model];
    await this.repo.usage(actor, {
      providerId: row.id,
      model,
      inputTokens,
      outputTokens,
      costMicros: price
        ? Math.round(
            inputTokens * Number(price.inputPerMillion || 0) +
              outputTokens * Number(price.outputPerMillion || 0),
          )
        : 0,
      estimated,
      ...metadata,
      pricingVersion: price?.version || "unpriced",
    });
  }
  async *providerAttempt(actor, row, model, options, requestId) {
    // Denials happen before network access and are not fabricated ledger usage.
    await this.authorizeAttempt(actor, row, options.signal);
    const started = Date.now();
    let text = "",
      usage = null,
      firstTokenAt = null,
      status = "completed",
      completed = false;
    try {
      for await (const event of this.adapter(row).stream({
        ...options,
        model,
      })) {
        if (event.text) {
          text += event.text;
          firstTokenAt ??= Date.now();
        }
        if (event.usage) usage = event.usage;
        yield event;
      }
      completed = true;
    } catch (error) {
      status = options.signal?.aborted ? "cancelled" : "failed";
      throw error;
    } finally {
      if (!completed && status === "completed") status = "cancelled";
      await this.recordAttempt(
        actor,
        row,
        model,
        options.messages,
        text,
        usage,
        {
          requestId,
          status,
          latencyMs: Date.now() - started,
          ttftMs: firstTokenAt ? firstTokenAt - started : null,
        },
        options.tools || [],
      );
    }
  }
  async embeddingProvider(actor) {
    const id = this.env.FABRIC_EMBEDDING_PROVIDER_ID;
    let provider = id
      ? await this.repo.providers.require(actor.workspaceId, id)
      : (
          await this.repo.providers.list(actor.workspaceId, { limit: 100 })
        ).items.find(
          (p) => p.enabled && ["openai-compatible", "ollama"].includes(p.type),
        );
    if (
      !provider ||
      !provider.enabled ||
      !this.adapter(provider).getCapabilities().embeddings
    )
      throw new AppError(
        "EMBEDDING_PROVIDER_REQUIRED",
        "Configure an embedding-capable provider.",
        503,
      );
    return provider;
  }
  async embed(actor, texts, signal) {
    const row = await this.embeddingProvider(actor),
      model =
        row.config?.embeddingModel ||
        (row.type === "ollama" ? "nomic-embed-text" : "text-embedding-3-small"),
      started = Date.now();
    let result,
      status = "completed";
    await this.authorizeAttempt(actor, row, signal);
    try {
      result = await this.adapter(row).embed(texts, signal);
      const vectors = Array.isArray(result) ? result : result.vectors;
      if (
        vectors.length !== texts.length ||
        vectors.some(
          (v) => v.length !== 768 || v.some((n) => !Number.isFinite(n)),
        )
      )
        throw new AppError(
          "EMBEDDING_DIMENSION",
          "Embedding model must return 768-dimensional finite vectors.",
          502,
        );
      return {
        vectors,
        model,
        providerId: row.id,
        identity: row.id + ":" + model,
      };
    } catch (e) {
      status = signal?.aborted ? "cancelled" : "failed";
      throw e;
    } finally {
      await this.recordAttempt(
        actor,
        row,
        model,
        texts,
        "",
        { inputTokens: result?.inputTokens, outputTokens: 0 },
        {
          requestId: newId("emb"),
          latencyMs: Date.now() - started,
          status,
          ttftMs: null,
        },
      );
    }
  }
}
