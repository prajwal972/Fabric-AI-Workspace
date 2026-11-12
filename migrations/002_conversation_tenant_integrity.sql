BEGIN;
-- A message cannot claim another workspace while referencing a conversation.
-- Existing inconsistent rows cause migration failure, not silent reassignment.
CREATE UNIQUE INDEX conversations_workspace_id_uq ON conversations(workspace_id, id);
ALTER TABLE messages ADD CONSTRAINT messages_conversation_workspace_fk
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES conversations(workspace_id, id) ON DELETE CASCADE;
CREATE INDEX conversations_workspace_page_idx ON conversations(workspace_id, updated_at DESC, id DESC) WHERE deleted_at IS NULL;
COMMIT;
