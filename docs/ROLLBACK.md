> Historical/local-mode guidance. For the PostgreSQL runtime use `PRODUCTION_SETUP.md` and the current engineering upgrade report. Do not use local JSON backup/deployment instructions as the production runbook.

# Rollback guide

Stop traffic growth, preserve evidence, and decide whether application-only rollback is compatible with the migrated schema. Deploy the previous immutable image, run only the reviewed down migration when required, restore data only for confirmed integrity loss, and verify readiness, login, workspace isolation, chat, uploads, and jobs. Never roll back by deleting migration records or editing production tables manually. Local Git checkpoints are tagged `audit-baseline-v1.10.1` and `phase-*`.
