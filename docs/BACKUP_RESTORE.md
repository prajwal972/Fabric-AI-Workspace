# Backup and restoration

`scripts/backup.sh` creates a PostgreSQL custom-format dump, encrypts it with AES-256-GCM, writes a SHA-256 checksum, and can copy it to an S3 backup URI. Keep the encryption key separate from backups.

```bash
DATABASE_URL=... BACKUP_DIR=/secure/backups \
FABRIC_BACKUP_ENCRYPTION_KEY_FILE=/run/secrets/backup-key \
./scripts/backup.sh
```

Restoration is destructive and requires an explicit confirmation:

```bash
FABRIC_RESTORE_CONFIRM=RESTORE DATABASE_URL=... \
FABRIC_BACKUP_ENCRYPTION_KEY_FILE=/run/secrets/backup-key \
./scripts/restore.sh /secure/backups/fabric-YYYYMMDDTHHMMSSZ.dump.enc
```

After restoration, run migrations, row/object counts, workspace isolation checks, upload retrieval, login, and chat smoke tests before routing traffic. Schedule restoration rehearsals at least quarterly.
