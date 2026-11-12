BEGIN;
CREATE INDEX messages_active_context_page ON messages(workspace_id,conversation_id,created_at DESC,id DESC) WHERE status='complete';
CREATE INDEX messages_user_turn_page ON messages(workspace_id,conversation_id,created_at DESC,id DESC) WHERE role='user';
COMMIT;
