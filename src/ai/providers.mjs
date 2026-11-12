import crypto from "node:crypto";
import { networkFetch, boundedText } from "../security/network.mjs";
import { AppError } from "../server/errors.mjs";
function providerError(status) {
  return new AppError(
    status === 429
      ? "PROVIDER_RATE_LIMIT"
      : status === 401 || status === 403
        ? "PROVIDER_AUTH_ERROR"
        : "PROVIDER_ERROR",
    status === 429
      ? "The provider rate limit was reached. Please retry later."
      : status === 401 || status === 403
        ? "The provider rejected its credentials or permissions."
        : "The model provider could not complete this request.",
    502,
  );
}
const openTools = (tools) =>
  tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
function openMessages(messages) {
  return messages.map((m) =>
    m.role === "tool"
      ? {
          role: "tool",
          tool_call_id: m.toolCallId,
          content:
            typeof m.content === "string"
              ? m.content
              : JSON.stringify(m.content),
        }
      : {
          role: m.role,
          content: m.content || "",
          ...(m.toolCalls?.length
            ? {
                tool_calls: m.toolCalls.map((t) => ({
                  id: t.id,
                  type: "function",
                  function: {
                    name: t.name,
                    arguments: JSON.stringify(t.input),
                  },
                })),
              }
            : {}),
        },
  );
}
async function* sseData(body, signal) {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      pending += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      if (pending.length > 2e6)
        throw new AppError(
          "INVALID_PROVIDER_STREAM",
          "Model stream exceeded framing limits.",
          502,
        );
      let end;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end).replace(/\r$/, "");
        pending = pending.slice(end + 1);
        if (line.startsWith("data:")) {
          const text = line.slice(5).trim();
          if (text === "[DONE]") return;
          if (text) yield JSON.parse(text);
        }
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export class OpenAIAdapter {
  constructor(row, { box, nativeRuntime, env = process.env } = {}) {
    this.row = row;
    this.box = box;
    this.nativeRuntime = nativeRuntime;
    this.env = env;
  }
  async base() {
    return this.row.type === "fabric-native"
      ? await this.nativeRuntime.ensureLlm({ autoInstall: false })
      : (this.row.config?.baseUrl || "https://api.openai.com/v1").replace(
          /\/$/,
          "",
        );
  }
  headers() {
    return {
      "content-type": "application/json",
      ...(this.row.credential
        ? { authorization: "Bearer " + this.box.decrypt(this.row.credential) }
        : {}),
    };
  }
  trustedPrivate(base) {
    const origin = new URL(base).origin;
    const trusted = [
      "http://127.0.0.1:11434",
      "http://localhost:11434",
      this.env.FABRIC_OLLAMA_URL,
      ...(this.env.FABRIC_TRUSTED_MODEL_ORIGINS || "").split(","),
    ]
      .filter(Boolean)
      .map((x) => new URL(x).origin);
    return (
      this.row.type === "fabric-native" ||
      this.env.NODE_ENV === "test" ||
      trusted.includes(origin)
    );
  }
  async request(path, body, signal) {
    const r = await networkFetch((await this.base()) + path, {
      method: body ? "POST" : "GET",
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
      signal,
      allowPrivate: this.trustedPrivate(await this.base()),
    });
    if (!r.ok) {
      await r.body?.cancel();
      throw providerError(r.status);
    }
    return r;
  }
  async models() {
    const r = await this.request("/models", null, AbortSignal.timeout(15000));
    return JSON.parse(await boundedText(r)).data.map((m) => ({
      id: m.id,
      name: m.id,
      capabilities: this.getCapabilities(),
    }));
  }
  getCapabilities() {
    return {
      streaming: true,
      tools: true,
      vision: false,
      embeddings: this.row.type !== "fabric-native",
      contextWindow: this.row.config?.contextWindow || 8192,
    };
  }
  async *stream({
    model,
    messages,
    tools = [],
    maxTokens = 512,
    temperature = 0.7,
    signal,
  }) {
    if (
      new URL(await this.base()).hostname === "api.openai.com" &&
      /^(o1|o3|o4|gpt-5)(?:[.-]|$)/.test(model)
    ) {
      yield* this.responses({ model, messages, tools, maxTokens, signal });
      return;
    }
    if (this.row.type === "fabric-native")
      model = process.env.FABRIC_NATIVE_MODEL_ID || "fabric-base";
    const body = {
      model,
      messages: openMessages(messages),
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: maxTokens,
      temperature,
      ...(tools.length ? { tools: openTools(tools) } : {}),
    };
    const r = await this.request("/chat/completions", body, signal),
      calls = new Map();
    let completed = false;
    for await (const j of sseData(r.body, signal)) {
      if (j.choices?.[0]?.finish_reason) completed = true;
      const delta = j.choices?.[0]?.delta;
      if (delta?.content) yield { text: delta.content };
      for (const t of delta?.tool_calls || []) {
        const value = calls.get(t.index) || {
          id: t.id || crypto.randomUUID(),
          name: "",
          arguments: "",
        };
        if (t.id) value.id = t.id;
        if (t.function?.name) value.name += t.function.name;
        if (t.function?.arguments) value.arguments += t.function.arguments;
        if (value.arguments.length > 200000)
          throw new AppError(
            "TOOL_INPUT_TOO_LARGE",
            "Tool input exceeded the limit.",
            502,
          );
        calls.set(t.index, value);
      }
      if (j.usage)
        yield {
          usage: {
            inputTokens: j.usage.prompt_tokens,
            outputTokens: j.usage.completion_tokens,
          },
        };
    }
    if (!completed)
      throw new AppError(
        "PROVIDER_STREAM_INTERRUPTED",
        "The model stream ended before completion.",
        502,
      );
    for (const t of calls.values())
      yield {
        toolCall: {
          id: t.id,
          name: t.name,
          input: JSON.parse(t.arguments || "{}"),
        },
      };
  }
  async *responses({ model, messages, tools, maxTokens, signal }) {
    const input = messages.flatMap((m) =>
      m.role === "tool"
        ? [
            {
              type: "function_call_output",
              call_id: m.toolCallId,
              output:
                typeof m.content === "string"
                  ? m.content
                  : JSON.stringify(m.content),
            },
          ]
        : [
            {
              role: m.role === "system" ? "developer" : m.role,
              content: m.content || "",
            },
            ...(m.toolCalls || []).map((t) => ({
              type: "function_call",
              call_id: t.id,
              name: t.name,
              arguments: JSON.stringify(t.input),
            })),
          ],
    );
    const r = await this.request(
      "/responses",
      {
        model,
        input,
        stream: true,
        max_output_tokens: maxTokens,
        ...(tools.length
          ? {
              tools: tools.map((t) => ({
                type: "function",
                name: t.name,
                description: t.description,
                parameters: t.inputSchema,
              })),
            }
          : {}),
      },
      signal,
    );
    for await (const j of sseData(r.body, signal)) {
      if (j.type === "response.output_text.delta") yield { text: j.delta };
      if (
        j.type === "response.output_item.done" &&
        j.item?.type === "function_call"
      )
        yield {
          toolCall: {
            id: j.item.call_id,
            name: j.item.name,
            input: JSON.parse(j.item.arguments),
          },
        };
      if (j.type === "response.completed" && j.response?.usage)
        yield {
          usage: {
            inputTokens: j.response.usage.input_tokens,
            outputTokens: j.response.usage.output_tokens,
          },
        };
      if (j.type === "error" || j.type === "response.failed")
        throw providerError(502);
    }
  }
  async embed(texts, signal) {
    const r = await this.request(
      "/embeddings",
      {
        model: this.row.config?.embeddingModel || "text-embedding-3-small",
        input: texts,
        dimensions: 768,
      },
      signal,
    );
    const result = JSON.parse(await boundedText(r, 8e6));
    return {
      vectors: result.data
        .sort((a, b) => a.index - b.index)
        .map((x) => x.embedding),
      inputTokens: result.usage?.prompt_tokens,
    };
  }
}
export class AnthropicAdapter extends OpenAIAdapter {
  async base() {
    return (this.row.config?.baseUrl || "https://api.anthropic.com/v1").replace(
      /\/$/,
      "",
    );
  }
  headers() {
    return {
      "content-type": "application/json",
      "x-api-key": this.box.decrypt(this.row.credential),
      "anthropic-version": "2023-06-01",
    };
  }
  getCapabilities() {
    return { ...super.getCapabilities(), embeddings: false };
  }
  async *stream({
    model,
    messages,
    tools = [],
    maxTokens = 512,
    temperature = 0.7,
    signal,
  }) {
    const system = messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n"),
      chat = [];
    for (const m of messages.filter((m) => m.role !== "system")) {
      const role = m.role === "assistant" ? "assistant" : "user",
        content =
          m.role === "tool"
            ? [
                {
                  type: "tool_result",
                  tool_use_id: m.toolCallId,
                  content: JSON.stringify(m.content),
                },
              ]
            : [
                { type: "text", text: m.content || " " },
                ...(m.toolCalls || []).map((t) => ({
                  type: "tool_use",
                  id: t.id,
                  name: t.name,
                  input: t.input,
                })),
              ];
      if (chat.at(-1)?.role === role) chat.at(-1).content.push(...content);
      else chat.push({ role, content });
    }
    const r = await this.request(
      "/messages",
      {
        model,
        system,
        messages: chat,
        max_tokens: maxTokens,
        temperature,
        stream: true,
        ...(tools.length
          ? {
              tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema,
              })),
            }
          : {}),
      },
      signal,
    );
    const calls = new Map();
    let usage = {},
      completed = false;
    for await (const j of sseData(r.body, signal)) {
      if (j.type === "message_stop") completed = true;
      if (j.type === "message_start")
        usage.inputTokens = j.message?.usage?.input_tokens;
      if (
        j.type === "content_block_start" &&
        j.content_block.type === "tool_use"
      )
        calls.set(j.index, {
          id: j.content_block.id,
          name: j.content_block.name,
          initial: j.content_block.input,
          arguments: "",
        });
      if (j.type === "content_block_delta") {
        if (j.delta.type === "text_delta") yield { text: j.delta.text };
        if (j.delta.type === "input_json_delta") {
          const c = calls.get(j.index);
          if (c) {
            c.arguments += j.delta.partial_json;
            if (c.arguments.length > 200000) throw providerError(502);
          }
        }
      }
      if (j.type === "message_delta")
        usage.outputTokens = j.usage?.output_tokens;
      if (j.type === "error") throw providerError(502);
    }
    if (!completed)
      throw new AppError(
        "PROVIDER_STREAM_INTERRUPTED",
        "The model stream ended before completion.",
        502,
      );
    if (usage.inputTokens != null) yield { usage };
    for (const c of calls.values())
      yield {
        toolCall: {
          id: c.id,
          name: c.name,
          input: c.arguments ? JSON.parse(c.arguments) : c.initial,
        },
      };
  }
}
export class OllamaAdapter extends OpenAIAdapter {
  async base() {
    return (
      this.row.config?.baseUrl ||
      process.env.FABRIC_OLLAMA_URL ||
      "http://127.0.0.1:11434"
    ).replace(/\/$/, "");
  }
  async request(path, body, signal) {
    const r = await networkFetch((await this.base()) + path, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal,
      allowPrivate: this.trustedPrivate(await this.base()),
    });
    if (!r.ok) {
      if (r.status === 400) {
        const body = await boundedText(r, 20000);
        if (/does not support tools|tools (?:are )?not supported/i.test(body))
          throw new AppError(
            "TOOLS_UNSUPPORTED",
            "The selected model does not support tool calls. Choose a tool-capable model or turn off tools.",
            400,
          );
      } else await r.body?.cancel();
      throw providerError(r.status);
    }
    return r;
  }
  getCapabilities() {
    return {
      ...super.getCapabilities(),
      tools: false,
      capabilitiesVerified: false,
      capabilitySource: "uninspected",
    };
  }
  async inspectModel(model, signal) {
    const response = await this.request(
      "/api/show",
      { model, verbose: false },
      signal,
    );
    const data = JSON.parse(await boundedText(response, 200000));
    if (
      !Array.isArray(data.capabilities) ||
      data.capabilities.length > 32 ||
      data.capabilities.some(
        (cap) => typeof cap !== "string" || cap.length > 80,
      )
    )
      throw new AppError(
        "INVALID_MODEL_METADATA",
        "The model did not return usable capability metadata.",
        502,
      );
    const windows = Object.entries(data.model_info || {})
      .filter(
        ([key, value]) =>
          key.endsWith(".context_length") &&
          Number.isInteger(value) &&
          value >= 1024 &&
          value <= 2000000,
      )
      .map(([, value]) => value);
    return {
      ...this.getCapabilities(),
      completion: data.capabilities.includes("completion"),
      tools: data.capabilities.includes("tools"),
      vision: data.capabilities.includes("vision"),
      embeddings: data.capabilities.includes("embedding"),
      contextWindow: Math.min(
        Number.isInteger(this.row.config?.contextWindow) &&
          this.row.config.contextWindow >= 1024 &&
          this.row.config.contextWindow <= 2000000
          ? this.row.config.contextWindow
          : 8192,
        ...(windows.length ? windows : [8192]),
      ),
      capabilitiesVerified: true,
      capabilitySource: "ollama_show",
    };
  }
  async models() {
    const r = await this.request("/api/tags", null, AbortSignal.timeout(15000));
    return JSON.parse(await boundedText(r)).models.map((m) => ({
      id: m.name,
      name: m.name,
      capabilities: this.getCapabilities(),
    }));
  }
  async *stream({
    model,
    messages,
    tools = [],
    maxTokens = 512,
    temperature = 0.7,
    signal,
  }) {
    const r = await this.request(
        "/api/chat",
        {
          model,
          messages: openMessages(messages),
          stream: true,
          options: { temperature, num_predict: maxTokens },
          ...(tools.length ? { tools: openTools(tools) } : {}),
        },
        signal,
      ),
      reader = r.body.getReader(),
      dec = new TextDecoder();
    let pending = "",
      completed = false;
    try {
      while (true) {
        signal?.throwIfAborted();
        const { done, value } = await reader.read();
        pending += done ? dec.decode() : dec.decode(value, { stream: true });
        if (pending.length > 2e6) throw providerError(502);
        const lines = pending.split("\n");
        pending = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const j = JSON.parse(line);
          if (j.error) throw providerError(502);
          if (j.message?.content) yield { text: j.message.content };
          for (const t of j.message?.tool_calls || [])
            yield {
              toolCall: {
                id: crypto.randomUUID(),
                name: t.function.name,
                input: t.function.arguments,
              },
            };
          if (j.done) completed = true;
          if (j.done)
            yield {
              usage: {
                inputTokens: j.prompt_eval_count,
                outputTokens: j.eval_count,
              },
            };
        }
        if (done && pending.trim())
          throw new AppError(
            "INVALID_PROVIDER_STREAM",
            "The model stream ended with an incomplete frame.",
            502,
          );
        if (done) break;
      }
      if (!completed)
        throw new AppError(
          "PROVIDER_STREAM_INTERRUPTED",
          "The model stream ended before completion.",
          502,
        );
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  async embed(texts, signal) {
    const r = await this.request(
      "/api/embed",
      {
        model: this.row.config?.embeddingModel || "nomic-embed-text",
        input: texts,
      },
      signal,
    );
    return JSON.parse(await boundedText(r, 8e6)).embeddings;
  }
}
export class MockAdapter {
  getCapabilities() {
    return {
      streaming: true,
      tools: false,
      embeddings: false,
      vision: false,
      contextWindow: 8192,
    };
  }
  async models() {
    return [
      {
        id: "flux-mock-1",
        name: "Fabric Mock (testing only)",
        capabilities: this.getCapabilities(),
      },
    ];
  }
  async *stream({ messages, signal }) {
    for (const part of ("Mock response: " + messages.at(-1).content).split(
      /(\s+)/,
    )) {
      signal?.throwIfAborted();
      yield { text: part };
      await new Promise((r) => setTimeout(r, 5));
    }
  }
}
export function providerAdapter(row, context) {
  if (row.type === "mock") return new MockAdapter();
  if (row.type === "anthropic") return new AnthropicAdapter(row, context);
  if (row.type === "ollama") return new OllamaAdapter(row, context);
  return new OpenAIAdapter(row, context);
}
