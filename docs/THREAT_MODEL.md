# Threat model

## Assets

Accounts, workspace membership, sessions, provider/OAuth credentials, conversations, uploads, analyst outputs, voice data, native binaries, audit events, backups, and billing usage.

## Trust boundaries

Browser → API; API → PostgreSQL/Redis/S3; API/worker → model and speech providers; API → plugins/OAuth; uploads/retrieved pages/model output → orchestration; installer → upstream release systems.

## Principal threats and controls

| Threat | Current controls | Remaining work |
|---|---|---|
| Broken access control | deny-by-default RBAC classifier; workspace ownership | full role/IDOR HTTP matrix and invite administration |
| Session theft/fixation | hashed opaque cookies, Secure/HttpOnly/SameSite, CSRF, rotation on login | inactivity, device sessions, MFA, recovery |
| Credential disclosure | AES-GCM, redacted logger, server-side Azure keys | key-version rotation/KMS |
| Prompt injection | evidence kept out of system message; external-action allowlist | formal eval corpus and policy engine |
| SSRF/rebinding | scheme/private-IP/DNS checks, redirect denial | socket IP pinning and egress proxy |
| XSS/CSRF | escaping, small Markdown subset, CSP, same-origin and CSRF checks | browser security regression suite |
| SQL injection | parameterized migration runner and planned repositories | repository implementation and SAST |
| Path/command injection | random object names, path containment, spawn without shell | parser sandbox |
| Upload malware/bombs | type inspection, executable blocking, size/decompression limits, ClamAV gate | worker isolation and nested-archive policy |
| Supply chain | lockfile, audit gate, runtime SHA-256, SBOM CI | signatures/SLSA provenance and digest verification policy |
| Denial of service | request limits, timeouts, rate limits | distributed limits, quotas, load evidence |
| Voice privacy | server-only keys, no default persistence, explicit language | processor agreements and state-machine browser tests |
