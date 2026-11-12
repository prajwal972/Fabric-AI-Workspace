#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_DIR:?BACKUP_DIR is required}"
: "${FABRIC_BACKUP_ENCRYPTION_KEY_FILE:?Encryption key file is required}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
tmp="$(mktemp "$BACKUP_DIR/.fabric-${timestamp}.XXXXXX.dump")"
trap 'rm -f "$tmp"' EXIT
suffix="$(basename "$tmp" .dump)"
out="$BACKUP_DIR/${suffix#.}.dump.enc"

node scripts/postgres-client.mjs dump "$tmp"
node scripts/crypt-backup.mjs encrypt "$tmp" "$out" "$FABRIC_BACKUP_ENCRYPTION_KEY_FILE"
sha256sum "$out" > "$out.sha256"
rm -f "$tmp"

if [[ -n "${S3_BACKUP_URI:-}" ]]; then
  aws s3 cp "$out" "$S3_BACKUP_URI/" --only-show-errors
  aws s3 cp "$out.sha256" "$S3_BACKUP_URI/" --only-show-errors
fi

find "$BACKUP_DIR" -type f -name 'fabric-*.dump.enc*' \
  -mtime "+${FABRIC_BACKUP_RETENTION_DAYS:-30}" -delete
printf 'Created %s\n' "$out"
