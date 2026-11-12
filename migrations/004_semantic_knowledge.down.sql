BEGIN;
DROP INDEX memory_embedding_hnsw;
ALTER TABLE memories DROP COLUMN embedding,DROP COLUMN embedding_model;
DROP TABLE rag_chunks;
COMMIT;
