import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { withTransaction } from "./transaction.mjs";
import { WorkspaceRepository } from "../repositories/workspace.mjs";
import { cryptoBox, newId } from "../security/crypto.mjs";
import { zipStore } from "../services/artifacts-format.mjs";
const arrays = [
  "users",
  "workspaces",
  "members",
  "providers",
  "conversations",
  "messages",
  "files",
  "memories",
  "plugins",
  "artifacts",
  "analystStates",
];
const redacted = (value) =>
  Array.isArray(value)
    ? value.map(redacted)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value).map(([k, v]) => [
            k,
            /secret|password|token|credential|authorization|api.?key/i.test(k)
              ? "[redacted]"
              : redacted(v),
          ]),
        )
      : value;
export async function importLegacy({
  pool,
  storage,
  jobs,
  sourcePath,
  legacyDataDir,
  legacyMasterKey,
  masterKey,
  dryRun = true,
}) {
  const stat = await fs.stat(sourcePath);
  if (stat.size > 20e6)
    throw new Error(
      "Legacy store exceeds the 20 MB migration bound; split it using a reviewed migration.",
    );
  const bytes = await fs.readFile(sourcePath),
    digest = crypto.createHash("sha256").update(bytes).digest("hex"),
    data = JSON.parse(bytes.toString());
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Legacy store must be an object");
  for (const key of arrays)
    if (data[key] !== undefined && !Array.isArray(data[key]))
      throw new Error("Invalid legacy collection: " + key);
  const counts = Object.fromEntries(
    arrays.map((k) => [k, data[k]?.length || 0]),
  );
  counts.sessionsRevoked = data.sessions?.length || 0;
  counts.archivedRuns = data.runs?.length || 0;
  counts.archivedWorkflows = data.workflows?.length || 0;
  const users = new Map((data.users || []).map((u) => [u.id, u])),
    workspaces = new Set((data.workspaces || []).map((w) => w.id));
  for (const u of users.values())
    if (
      !u.id ||
      !u.email ||
      !/^\$(?:argon2)|^scrypt\$/.test(u.passwordHash || "")
    )
      throw new Error(
        "A legacy user has a missing or unsupported password hash",
      );
  for (const key of arrays.filter((k) => !["users", "workspaces"].includes(k)))
    for (const r of data[key] || [])
      if (!workspaces.has(r.workspaceId))
        throw new Error("Invalid workspace reference in " + key);
  for (const member of data.members || [])
    if (
      !users.has(member.userId) ||
      !["owner", "admin", "member", "viewer"].includes(member.role)
    )
      throw new Error("Invalid legacy workspace member");
  const root = await fs.realpath(legacyDataDir),
    uploads = path.join(root, "uploads"),
    localFiles = new Map();
  for (const file of data.files || []) {
    const name = file.storageFile;
    if (!name || path.basename(name) !== name)
      throw new Error("Legacy file has an unsafe/missing storage filename");
    const resolved = await fs.realpath(path.join(uploads, name));
    if (!resolved.startsWith(uploads + path.sep))
      throw new Error("Legacy file escapes the uploads directory");
    if ((await fs.stat(resolved)).size > 250 * 1024 * 1024)
      throw new Error("Legacy file exceeds the upload limit");
    localFiles.set(file.id, resolved);
  }
  const oldBox = cryptoBox(legacyMasterKey),
    box = cryptoBox(masterKey),
    credentials = new Map();
  for (const row of [...(data.providers || []), ...(data.plugins || [])])
    if (row.credential)
      credentials.set(row.id, box.encrypt(oldBox.decrypt(row.credential)));
  if (dryRun)
    return {
      dryRun: true,
      sourceSha256: digest,
      counts,
      notice:
        "Source and database were not modified. Sessions will be revoked; historical runs/workflows retained in encrypted archive.",
    };
  const id = newId("imp"),
    uploaded = [];
  const put = async (ws, objectId, body, contentType) => {
    const key = await storage.put({
      workspaceId: ws,
      objectId,
      body,
      contentType,
      contentLength: Buffer.byteLength(body),
    });
    uploaded.push({ workspaceId: ws, objectId });
    return key;
  };
  try {
    return await withTransaction(pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "fabric:legacy-import",
      ]);
      const previous = (
        await client.query(
          "SELECT id,counts FROM legacy_imports WHERE source_sha256=$1",
          [digest],
        )
      ).rows[0];
      if (previous) return { alreadyImported: true, ...previous };
      if (
        Number((await client.query("SELECT count(*) FROM users")).rows[0].count)
      )
        throw new Error(
          "Import requires a fresh database. Never merge accounts implicitly.",
        );
      const tx = new WorkspaceRepository({ query: client.query.bind(client) });
      for (const u of users.values())
        await client.query(
          "INSERT INTO users(id,email,name,password_hash,created_at) VALUES($1,$2,$3,$4,$5)",
          [
            u.id,
            u.email.toLowerCase(),
            u.name,
            u.passwordHash,
            u.createdAt || new Date(),
          ],
        );
      for (const w of data.workspaces || [])
        await client.query(
          "INSERT INTO workspaces(id,name,memory_enabled,research_url,created_at) VALUES($1,$2,$3,$4,$5)",
          [
            w.id,
            w.name,
            w.memoryEnabled !== false,
            w.researchUrl || null,
            w.createdAt || new Date(),
          ],
        );
      for (const m of data.members || [])
        await client.query(
          "INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,$3)",
          [m.workspaceId, m.userId, m.role],
        );
      const actorFor = (r) => {
        const uid =
          r.userId ||
          r.createdBy ||
          (data.members || []).find(
            (m) => m.workspaceId === r.workspaceId && m.role === "owner",
          )?.userId;
        if (!users.has(uid)) throw new Error("Record has no valid user");
        return { workspaceId: r.workspaceId, user: { id: uid }, role: "owner" };
      };
      for (const p of data.providers || [])
        await tx.providers.create(p.workspaceId, {
          id: p.id,
          name: p.name,
          type: p.type,
          config: p.config || {},
          models: p.models || [],
          credential: credentials.get(p.id) || null,
          enabled: p.type === "mock" ? false : p.enabled !== false,
          isDefault: p.type === "mock" ? false : !!p.isDefault,
          status: "unchecked",
        });
      for (const c of data.conversations || [])
        await client.query(
          "INSERT INTO conversations(id,workspace_id,created_by,title,system_instructions,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            c.id,
            c.workspaceId,
            actorFor(c).user.id,
            c.title || "Untitled",
            c.systemInstructions || "",
            c.createdAt || new Date(),
            c.updatedAt || c.createdAt || new Date(),
          ],
        );
      for (const m of data.messages || []) {
        const {
          id,
          workspaceId,
          conversationId,
          role,
          content,
          status,
          error,
          createdAt,
          ...metadata
        } = m;
        await client.query(
          "INSERT INTO messages(id,workspace_id,conversation_id,user_id,role,content,metadata,status,error_code,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            id,
            workspaceId,
            conversationId,
            actorFor(m).user.id,
            role,
            content || "",
            JSON.stringify(metadata),
            status || "complete",
            error ? "LEGACY_ERROR" : null,
            createdAt || new Date(),
          ],
        );
      }
      for (const f of data.files || []) {
        const fileBytes = await fs.readFile(localFiles.get(f.id)),
          actor = actorFor(f),
          key = await put(f.workspaceId, f.id, fileBytes, f.mime);
        await tx.files.create(f.workspaceId, {
          id: f.id,
          userId: actor.user.id,
          name: f.name,
          mime: f.mime || "application/octet-stream",
          declaredMime: f.declaredMime,
          size: fileBytes.length,
          sha256: crypto.createHash("sha256").update(fileBytes).digest(),
          objectKey: key,
          status: "quarantined",
          kind: f.kind,
          text: f.text || "",
          ragStatus: "pending",
        });
        await jobs.create(
          actor,
          "file-process",
          { fileId: f.id },
          "import-" + id + "-" + f.id,
          tx,
        );
      }
      for (const p of data.plugins || [])
        await tx.plugins.create(p.workspaceId, {
          id: p.id,
          pluginId: p.pluginId,
          name: p.name,
          baseUrl: p.baseUrl,
          authScheme: p.authScheme,
          enabled: p.enabled !== false,
          credential: credentials.get(p.id) || null,
          oauthProvider: p.oauthProvider || null,
        });
      for (const m of data.memories || [])
        await tx.memories.create(m.workspaceId, {
          id: m.id,
          scope: m.scope === "workspace" ? "workspace" : "user",
          userId: m.scope === "workspace" ? null : actorFor(m).user.id,
          content: String(m.content || m.text || "").slice(0, 2000),
        });
      for (const state of data.analystStates || [])
        await client.query(
          "INSERT INTO analyst_states(workspace_id,state) VALUES($1,$2)",
          [state.workspaceId, JSON.stringify(state)],
        );
      for (const a of data.artifacts || []) {
        const actor = actorFor(a),
          bundle = zipStore(a.files || []),
          key = await put(a.workspaceId, a.id, bundle, "application/zip");
        await tx.artifacts.create(a.workspaceId, {
          id: a.id,
          userId: actor.user.id,
          messageId: a.sourceMessageId || null,
          name: a.name || "Imported artifact",
          objectKey: key,
          files: (a.files || []).map(({ path, content }) => ({
            path,
            size: Buffer.byteLength(content || ""),
          })),
          size: bundle.length,
        });
      }
      for (const a of data.audit || [])
        if (workspaces.has(a.workspaceId))
          await client.query(
            "INSERT INTO audit_events(workspace_id,event_type,outcome,details,created_at) VALUES($1,$2,'success',$3,$4)",
            [
              a.workspaceId,
              String(a.event || "legacy.event").slice(0, 200),
              JSON.stringify(redacted(a.details || {})),
              a.createdAt || new Date(),
            ],
          );
      const archive = await put(
        "legacy_imports",
        id,
        box.encrypt(bytes),
        "application/octet-stream",
      );
      await client.query(
        "INSERT INTO legacy_imports(id,source_sha256,archive_object_key,counts) VALUES($1,$2,$3,$4)",
        [id, digest, archive, JSON.stringify(counts)],
      );
      return {
        id,
        sourceSha256: digest,
        counts,
        sessionsRevoked: true,
        archivedHistoricalRuns: true,
      };
    });
  } catch (e) {
    for (const object of uploaded) await storage.delete(object).catch(() => {});
    throw e;
  }
}
