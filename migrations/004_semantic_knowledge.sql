BEGIN;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE rag_chunks(id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces(id),user_id text NOT NULL REFERENCES users(id),file_id text NOT NULL REFERENCES files(id) ON DELETE CASCADE,chunk_index integer NOT NULL,page_number integer,source text NOT NULL,content text NOT NULL CHECK(length(content)<=6000),embedding vector(768) NOT NULL,embedding_model text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(file_id,chunk_index));
CREATE INDEX rag_workspace_file ON rag_chunks(workspace_id,file_id);
CREATE INDEX rag_embedding_hnsw ON rag_chunks USING hnsw(embedding vector_cosine_ops);
ALTER TABLE memories ADD COLUMN embedding vector(768);
ALTER TABLE memories ADD COLUMN embedding_model text;
CREATE INDEX memory_embedding_hnsw ON memories USING hnsw(embedding vector_cosine_ops) WHERE deleted_at IS NULL AND embedding IS NOT NULL;
COMMIT;
