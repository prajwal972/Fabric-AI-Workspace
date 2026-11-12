import path from "node:path";
import { verifyMigrations } from "../database/migrations.mjs";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createInfrastructure } from "../infrastructure/services.mjs";
import { S3ObjectStore } from "../infrastructure/object-store.mjs";
import { createNativeRuntime } from "../native-runtime.mjs";
import { WorkspaceRepository } from "../repositories/workspace.mjs";
import { PostgresConversationRepository } from "../repositories/conversation.mjs";
import { ConversationService } from "../services/conversation.mjs";
import { AuthService } from "../auth/service.mjs";
import { cryptoBox } from "../security/crypto.mjs";
import { AIRequestPolicy } from "../security/public-policy.mjs";
import { AIQuotaRepository } from "../repositories/ai-quota.mjs";
import { AIGateway } from "../ai/gateway.mjs";
import { ToolRegistry, ToolGateway } from "../tools/gateway.mjs";
import { registerBuiltins } from "../tools/builtins.mjs";
import { AgentEngine } from "../agents/engine.mjs";
import { RAGService } from "../rag/service.mjs";
import { MemoryService } from "../memory/service.mjs";
import { StorageCleanupService } from "../services/storage-cleanup.mjs";
import { FileService } from "../files/service.mjs";
import { JobService } from "../workers/jobs.mjs";
import { PythonSandbox, SQLSandbox } from "../security/sandbox.mjs";
import { AnalystService } from "../services/analyst.mjs";
import { ProviderService } from "../services/providers.mjs";
import { ArtifactService } from "../services/artifacts.mjs";
import { ResearchService } from "../services/research.mjs";
import { ChatService } from "../services/chat.mjs";
import { NotificationService } from "../services/notifications.mjs";
import { connectorService } from "../services/connectors.mjs";
import { voiceService } from "../services/voice.mjs";
import { applicationConfig } from "./config.mjs";
import { logger } from "../observability/index.mjs";
export async function createContext(env = process.env) {
  env = applicationConfig(env);
  const infrastructure = createInfrastructure(env),
    repo = new WorkspaceRepository(infrastructure.pool),
    box = cryptoBox(env.FABRIC_MASTER_KEY),
    root = path.dirname(
      path.dirname(path.dirname(fileURLToPath(import.meta.url))),
    ),
    dataDir = path.resolve(env.FABRIC_DATA_DIR || path.join(root, "data"));
  try {
    await verifyMigrations(infrastructure.pool, path.join(root, "migrations"));
    if (
      env.production &&
      (
        await infrastructure.pool.query(
          "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
        )
      ).rows.some((r) => r.rolsuper || r.rolbypassrls)
    )
      throw new Error(
        "Production API requires a non-superuser application database role.",
      );
  } catch (e) {
    await infrastructure.close();
    throw e;
  }
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const nativeRuntime = createNativeRuntime({
      root,
      dataDir,
      log: (event, details) => logger.info({ event, ...details }),
    }),
    storage = new S3ObjectStore({
      client: infrastructure.s3,
      bucket: env.S3_BUCKET,
    }),
    jobs = new JobService({ repo, env }),
    storageCleanup = new StorageCleanupService({ repo, storage, jobs }),
    registry = new ToolRegistry(),
    tools = new ToolGateway({ registry, repo, jobs, env }),
    aiPolicy = new AIRequestPolicy({ quota: new AIQuotaRepository(repo), env }),
    ai = new AIGateway({
      repo,
      box,
      nativeRuntime,
      toolGateway: tools,
      env,
      policy: aiPolicy,
    }),
    rag = new RAGService({ repo, ai }),
    memory = new MemoryService({ repo, ai, jobs, env }),
    files = new FileService({ repo, storage, jobs, rag, env, storageCleanup }),
    sandbox = new PythonSandbox(env),
    sql = new SQLSandbox(env);
  const conversations = new ConversationService(
      new PostgresConversationRepository(infrastructure.pool),
    ),
    auth = new AuthService({
      pool: infrastructure.pool,
      box,
      repo,
      production: env.production,
      env,
    }),
    analyst = new AnalystService({ repo, ai }),
    providers = new ProviderService({ repo, box, ai, env }),
    agents = new AgentEngine({ repo, ai, tools, jobs, env }),
    artifacts = new ArtifactService({ repo, storage, storageCleanup }),
    notifications = new NotificationService({ env, box }),
    connectors = connectorService({
      box,
      runTool: (name, input) => {
        throw new Error("Internal connector execution requires actor scope");
      },
    }),
    research = new ResearchService({ repo, env }),
    chat = new ChatService({
      repo,
      conversations,
      ai,
      rag,
      memory,
      connectors,
      research,
    }),
    voice = voiceService({ nativeRuntime, DIR: dataDir, env });
  registerBuiltins(registry, { files, rag, memory, sandbox, sql, analyst });
  try {
    await Promise.race([
      jobs.queue.waitUntilReady(),
      new Promise((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Redis queue startup timed out")),
          5000,
        );
        timer.unref();
      }),
    ]);
  } catch (error) {
    await jobs.close();
    await infrastructure.close();
    throw error;
  }
  return {
    env,
    infrastructure,
    repo,
    box,
    nativeRuntime,
    storage,
    storageCleanup,
    jobs,
    registry,
    tools,
    ai,
    aiPolicy,
    rag,
    memory,
    files,
    sandbox,
    sql,
    conversations,
    auth,
    analyst,
    providers,
    agents,
    artifacts,
    notifications,
    connectors,
    chat,
    voice,
    async close() {
      await Promise.allSettled([
        jobs.close(),
        nativeRuntime.shutdown(),
        sql.close(),
        infrastructure.close(),
      ]);
    },
  };
}
