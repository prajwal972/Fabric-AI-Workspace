#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${FABRIC_BACKUP_ENCRYPTION_KEY_FILE:?Encryption key file is required}"
backup="${1:?Usage: restore.sh BACKUP.dump.enc}"
checksum="${backup}.sha256"

[[ -f "$backup" && -f "$checksum" ]] || {
  echo "Backup or checksum file is missing" >&2
  exit 1
}
read -r expected _ < "$checksum"
[[ "$expected" =~ ^[a-fA-F0-9]{64}$ ]] || { echo "Invalid backup checksum" >&2; exit 1; }
actual="$(sha256sum "$backup" | cut -d ' ' -f 1)"
[[ "$actual" == "$expected" ]] || { echo "Backup checksum mismatch" >&2; exit 1; }

if [[ "${FABRIC_RESTORE_CONFIRM:-}" != "RESTORE" ]]; then
  echo "Set FABRIC_RESTORE_CONFIRM=RESTORE after verifying the target DATABASE_URL." >&2
  exit 2
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
node scripts/crypt-backup.mjs decrypt "$backup" "$tmp" "$FABRIC_BACKUP_ENCRYPTION_KEY_FILE"

node scripts/postgres-client.mjs restore "$tmp"
node scripts/migrate.mjs
echo "Restore completed; run integrity and smoke checks before serving traffic."
