import { AppError } from "../server/errors.mjs";
import { newId } from "../security/crypto.mjs";
export function chunkPages(pages, { size = 1800, overlap = 180 } = {}) {
  if (size < 200 || overlap >= size || overlap < 0)
    throw new TypeError("Invalid chunk bounds");
  const chunks = [];
  for (const page of pages) {
    const content = String(page.text || "").replace(/\0/g, "");
    for (let offset = 0; offset < content.length; offset += size - overlap) {
      const text = content.slice(offset, offset + size).trim();
      if (text) chunks.push({ text, pageNumber: page.pageNumber || null });
      if (chunks.length > 1000)
        throw new AppError(
          "DOCUMENT_CHUNK_LIMIT",
          "The document exceeds the indexing limit. Split it into smaller documents.",
          422,
        );
    }
  }
  return chunks;
}
export class RAGService {
  constructor({ repo, ai }) {
    Object.assign(this, { repo, ai });
  }
  async index(actor, file, pages, signal) {
    const chunks = chunkPages(pages);
    const records = [];
    for (let i = 0; i < chunks.length; i += 16) {
      signal?.throwIfAborted();
      const batch = chunks.slice(i, i + 16),
        embedded = await this.ai.embed(
          actor,
          batch.map((c) => c.text),
          signal,
        );
      records.push(
        ...batch.map((c, index) => ({
          ...c,
          id: newId("chk"),
          embedding: embedded.vectors[index],
          model: embedded.identity,
          index: i + index,
        })),
      );
    }
    await this.repo.transaction(async (tx) => {
      signal?.throwIfAborted();
      const live = (
        await tx.pool.query(
          "SELECT id FROM files WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE",
          [actor.workspaceId, file.id],
        )
      ).rows[0];
      if (!live)
        throw new AppError("NOT_FOUND", "File is no longer available.", 404);
      await tx.pool.query(
        "DELETE FROM rag_chunks WHERE workspace_id=$1 AND file_id=$2",
        [actor.workspaceId, file.id],
      );
      for (const c of records)
        await tx.pool.query(
          "INSERT INTO rag_chunks(id,workspace_id,user_id,file_id,chunk_index,page_number,source,content,embedding,embedding_model) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::vector,$10)",
          [
            c.id,
            actor.workspaceId,
            actor.user.id,
            file.id,
            c.index,
            c.pageNumber,
            file.name,
            c.text,
            JSON.stringify(c.embedding),
            c.model,
          ],
        );
    });
    return records.length;
  }
  async retrieve(actor, query, fileIds = [], signal) {
    for (const id of fileIds)
      await this.repo.files.require(actor.workspaceId, id);
    const { vectors, identity: model } = await this.ai.embed(
      actor,
      [query],
      signal,
    );
    return (
      await this.repo.pool.query(
        'SELECT c.id AS "chunkId",c.file_id AS "fileId",c.page_number AS page,c.source AS title,c.content AS text,1-(c.embedding <=> $1::vector) AS score FROM rag_chunks c JOIN files f ON f.id=c.file_id AND f.workspace_id=c.workspace_id WHERE c.workspace_id=$2 AND c.embedding_model=$3 AND f.status=\'ready\' AND f.deleted_at IS NULL AND (cardinality($4::text[])=0 OR c.file_id=ANY($4::text[])) ORDER BY c.embedding <=> $1::vector LIMIT 6',
        [JSON.stringify(vectors[0]), actor.workspaceId, model, fileIds],
      )
    ).rows.map((row, i) => ({
      ...row,
      id: i + 1,
      url: "/api/files/" + row.fileId + "/download",
    }));
  }
}
