BEGIN;
DROP INDEX IF EXISTS conversations_workspace_page_idx;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_conversation_workspace_fk;
DROP INDEX IF EXISTS conversations_workspace_id_uq;
COMMIT;
