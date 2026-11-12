BEGIN;
ALTER TABLE approvals DROP CONSTRAINT approval_run_workspace_fk;
ALTER TABLE tool_executions DROP CONSTRAINT execution_run_workspace_fk;
ALTER TABLE agent_runs DROP CONSTRAINT agent_workspace_fk;
ALTER TABLE rag_chunks DROP CONSTRAINT rag_file_workspace_fk;
DROP INDEX agent_runs_id_workspace_uq,agents_id_workspace_uq,files_id_workspace_uq,providers_id_workspace_uq;
DROP TABLE legacy_imports;
COMMIT;
