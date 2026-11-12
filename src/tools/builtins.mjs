import { z } from "zod";
import { deterministicPlanSchema } from "../services/analyst.mjs";
import { networkFetch, boundedText } from "../security/network.mjs";
import { AppError } from "../server/errors.mjs";
export function arithmetic(expression) {
  if (expression.length > 2000 || !/^[\d\s().+*/%\-]+$/.test(expression))
    throw new AppError(
      "INVALID_EXPRESSION",
      "Only bounded basic arithmetic is supported.",
      400,
    );
  const tokens = expression.match(/(?:\d+(?:\.\d*)?|\.\d+)|[()+*/%\-]/g) || [];
  if (tokens.join("") !== expression.replace(/\s/g, ""))
    throw new AppError(
      "INVALID_EXPRESSION",
      "Invalid arithmetic expression.",
      400,
    );
  let i = 0,
    depth = 0;
  function atom() {
    if (++depth > 32)
      throw new AppError(
        "EXPRESSION_DEPTH",
        "Arithmetic nesting is too deep.",
        400,
      );
    let token = tokens[i++],
      value;
    if (token === "(") {
      value = add();
      if (tokens[i++] !== ")")
        throw new AppError(
          "INVALID_EXPRESSION",
          "Invalid arithmetic expression.",
          400,
        );
    } else if (token === "-") value = -atom();
    else {
      value = Number(token);
      if (!Number.isFinite(value))
        throw new AppError("INVALID_EXPRESSION", "A number was expected.", 400);
    }
    depth--;
    return value;
  }
  function multiply() {
    let value = atom();
    while (["*", "/", "%"].includes(tokens[i])) {
      const op = tokens[i++],
        right = atom();
      value =
        op === "*" ? value * right : op === "/" ? value / right : value % right;
    }
    return value;
  }
  function add() {
    let value = multiply();
    while (["+", "-"].includes(tokens[i])) {
      const op = tokens[i++],
        right = multiply();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }
  const value = add();
  if (i !== tokens.length || !Number.isFinite(value))
    throw new AppError(
      "INVALID_EXPRESSION",
      "Arithmetic did not produce a finite result.",
      400,
    );
  return value;
}
export function registerBuiltins(
  registry,
  { files, rag, memory, sandbox, sql, analyst },
) {
  registry.register({
    name: "calculator",
    description: "Calculate bounded arithmetic deterministically.",
    permission: "tools.execute",
    classification: "READ",
    input: z.object({ expression: z.string().max(2000) }).strict(),
    output: z.object({ value: z.number() }),
    handler: async ({ expression }) => ({ value: arithmetic(expression) }),
  });
  registry.register({
    name: "clock",
    description: "Read the current ISO timestamp.",
    permission: "workspace.read",
    classification: "READ",
    input: z.object({}).strict(),
    output: z.object({ iso: z.string() }),
    handler: async () => ({ iso: new Date().toISOString() }),
  });
  registry.register({
    name: "safe_http",
    description:
      "Read a public HTTP(S) page. No credentials, private destinations or redirects.",
    permission: "tools.execute",
    classification: "READ",
    input: z.object({ url: z.string().max(4000).url() }),
    output: z.object({ status: z.number(), body: z.string() }),
    handler: async ({ url }, { signal }) => {
      const r = await networkFetch(url, { signal });
      return { status: r.status, body: await boundedText(r, 100000) };
    },
  });
  registry.register({
    name: "read_file",
    description: "Read authorized extracted text from a workspace file.",
    permission: "workspace.read",
    classification: "READ",
    input: z.object({ fileId: z.string().min(1).max(200) }),
    output: z.object({
      fileId: z.string().min(1).max(200),
      name: z.string(),
      text: z.string(),
    }),
    handler: async ({ fileId }, { actor }) => {
      const file = await files.repo.files.require(actor.workspaceId, fileId);
      if (file.status !== "ready")
        throw new AppError("FILE_NOT_READY", "The file is not ready.", 409);
      return {
        fileId,
        name: file.name,
        text: (file.text || "").slice(0, 50000),
      };
    },
  });
  registry.register({
    name: "search_knowledge",
    description: "Retrieve relevant authorized file chunks with citations.",
    permission: "workspace.read",
    classification: "READ",
    input: z.object({
      query: z.string().min(1).max(2000),
      fileIds: z.array(z.string().min(1).max(200)).max(12).default([]),
    }),
    output: z.object({ sources: z.array(z.any()) }),
    handler: async (input, { actor, signal }) => ({
      sources: await rag.retrieve(actor, input.query, input.fileIds, signal),
    }),
  });
  registry.register({
    name: "list_files",
    description:
      "List a bounded page of workspace file metadata (not file contents). Use the returned IDs with read_file or analyze_data. nextOffset means more files remain.",
    permission: "workspace.read",
    classification: "READ",
    input: z
      .object({
        limit: z.number().int().min(1).max(20).default(10),
        offset: z.number().int().min(0).max(100000).default(0),
      })
      .strict(),
    output: z.object({
      items: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            kind: z.string().nullable().optional(),
            status: z.string(),
          }),
        )
        .max(20),
      nextOffset: z.number().int().nullable(),
    }),
    handler: async (input, { actor }) => {
      const page = await files.repo.listFileMetadata(actor.workspaceId, input);
      return {
        items: page.items.map((file) => ({
          id: file.id,
          name: file.name,
          kind: file.kind,
          status: file.status,
        })),
        nextOffset: page.nextOffset,
      };
    },
  });
  registry.register({
    name: "analyze_data",
    description:
      "Calculate deterministic statistics from ready workspace CSV/XLSX/JSON datasets. No generated code or LLM arithmetic. Returns real values, filter/column/source provenance and explicit output truncation. Does not modify files or dashboard state.",
    permission: "analyst.run",
    classification: "READ",
    input: z
      .object({
        fileIds: z
          .array(z.string().min(1).max(200))
          .min(1)
          .max(12)
          .refine((ids) => new Set(ids).size === ids.length),
        plan: deterministicPlanSchema,
      })
      .strict(),
    output: z.object({
      value: z.union([
        z.number().finite(),
        z.null(),
        z.array(z.number().finite()).max(100),
        z
          .array(
            z.object({
              label: z.string(),
              value: z.number().finite().nullable(),
              rows: z.number().int().min(0),
            }),
          )
          .max(200),
      ]),
      provenance: z.object({
        fileIds: z.array(z.string()).max(12),
        columns: z.array(z.string()).max(3),
        parserVersion: z.string().optional(),
        percentStrings: z.literal("fraction").optional(),
        sourceWorksheets: z
          .array(
            z.object({
              fileId: z.string(),
              worksheets: z
                .array(
                  z.object({
                    name: z.string().optional(),
                    index: z.number().int(),
                    rows: z.number().int(),
                    startRow: z.number().int(),
                    endRow: z.number().int().optional(),
                  }),
                )
                .max(20),
              formulaResults: z.literal("cached_not_recalculated"),
            }),
          )
          .max(12)
          .optional(),
        operation: z.string(),
        aggregation: z.string(),
        filters: z.record(z.string(), z.array(z.string())),
        rowsIncluded: z.number().int().min(0),
        validValues: z.number().int().min(0),
        calculatedAt: z.string(),
        sourceHashes: z.array(
          z.object({
            fileId: z.string(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/i),
          }),
        ),
        outputTotal: z.number().int().optional(),
        outputReturned: z.number().int().optional(),
        outputTruncated: z.boolean().optional(),
        countMode: z.enum(["record_rows", "valid_numeric_values"]).optional(),
        method: z.enum(["pearson", "population_zscore"]).optional(),
        validPairs: z.number().int().min(0).optional(),
        minimumObservations: z.number().int().positive().optional(),
        outlierThreshold: z.number().positive().finite().optional(),
      }),
    }),
    handler: (input, { actor }) =>
      analyst.analyze(actor, input.fileIds, input.plan),
  });
  registry.register({
    name: "delete_file",
    description:
      "Remove a workspace file and queue durable storage cleanup. Explicit approval required; queued cleanup is not yet physical deletion.",
    permission: "files.write",
    classification: "DESTRUCTIVE",
    input: z.object({ fileId: z.string().min(1).max(200) }),
    output: z.object({
      ok: z.boolean(),
      cleanupJobId: z.string(),
      storageStatus: z.enum(["queued", "completed", "failed"]),
    }),
    handler: async ({ fileId }, { actor }) => files.delete(actor, fileId),
  });
  registry.register({
    name: "remember",
    description:
      "Store an explicitly useful preference or fact, never a secret. Approval required.",
    permission: "workspace.write",
    classification: "WRITE",
    input: z.object({
      content: z.string().max(2000),
      scope: z.enum(["user", "workspace"]),
    }),
    output: z.object({ id: z.string() }),
    handler: async (input, { actor }) => ({
      id: (await memory.add(actor, input)).id,
    }),
  });
  registry.register({
    name: "execute_python",
    description:
      "Execute Python in an isolated, resource-limited, network-disabled container. Approval required.",
    permission: "sandbox.execute",
    classification: "WRITE",
    input: z.object({ code: z.string().min(1).max(50000) }).strict(),
    output: z.object({
      stdout: z.string(),
      stderr: z.string(),
      exitCode: z.number(),
      durationMs: z.number(),
    }),
    handler: (input, context) => sandbox.execute(input, context),
  });
  registry.register({
    name: "query_database",
    description:
      "Execute one bounded SELECT against a separately configured read-only analytics database.",
    permission: "sql.query",
    classification: "READ",
    input: z.object({ query: z.string().min(1).max(10000) }).strict(),
    output: z.object({ rows: z.array(z.record(z.string(), z.any())) }),
    handler: (input, context) => sql.execute(input, context),
  });
  return registry;
}
