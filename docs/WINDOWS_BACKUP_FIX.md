# Windows backup-permission follow-up for checkpoint 4

## Observed user result

Windows 11 / Node 24.15: syntax checks passed; 223 tests ran, 222 passed and one failed. The assertion compared stat().mode 438 (octal 0666) against 384 (octal 0600). Windows mode bits do not establish POSIX-style confidentiality. This was a platform mismatch and exposed the need to enforce native Windows permissions for backup staging/publication.

## Targeted change

- New `src/security/private-path.mjs`: POSIX 0700 directories / 0600 files remain verified on Unix. On Windows, built-in Windows PowerShell establishes and verifies a protected current-user-only DACL, removing inherited/other explicit grants, with inherited protection for directory children. Reparse points are refused. ACL failures fail closed.
- `scripts/crypt-backup.mjs` protects the empty staging directory before sensitive bytes are written, then protects/verifies the staged payload before authenticated same-volume publication. Cleanup now runs when permission setup fails. AES-GCM authentication, corrupt/truncated input refusal and output preservation remain unchanged.
- `test/backup-crypto.test.mjs` verifies actual platform-native private permissions rather than assuming Windows stat().mode is POSIX. All content, authentication, replacement and cleanup assertions remain.
- New `test/private-path.test.mjs` checks private files/directories and bounded argument-safe Windows invocation. Windows also executes a real negative ACL fixture using icacls: Users-group read access must be rejected, then removed by protection. No existing backup test is skipped or disabled.

The PowerShell child receives only the target/operation/SystemRoot variables, not database URLs or application secrets. It uses a system executable, no user profile, no shell-interpolated target path, no execution-policy bypass, and a bounded deadline/output.

## Verification boundary

Linux: syntax checks passed and 225 tests passed, 0 failed/skipped. Native Windows ACL execution is not available in this agent computer; it must be confirmed by the user's rerun. This is not Windows certification, an antivirus test, or a production release approval. PostgreSQL/Redis/S3 revalidation and all checkpoint-4 release blockers remain open. Native PowerShell/NTFS ACL operations must be available; unsupported filesystems or blocked ACL commands fail rather than silently omit protection.

No Node dependencies, UI, deterministic analyst, user data, provider configuration, or migration files changed. Do not keep private key files or decrypted production backups in OneDrive, shared folders or source control: a local NTFS ACL does not control cloud copies.
