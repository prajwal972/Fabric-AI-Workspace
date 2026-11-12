# Security

- Passwords: scrypt with random salt; generic login failure.
- Sessions: opaque random tokens; only hashes persist; 7-day expiry; HttpOnly, SameSite=Strict, Secure in production; CSRF header for mutations.
- Authorization: workspace ownership on every tenant resource.
- Credentials: AES-256-GCM under an external master key; never returned; sensitive log keys redacted.
- XSS: escaped model/tool content, deliberately small Markdown subset, strict CSP, no inline scripts.
- SSRF: HTTP(S) only, metadata/internal names blocked, private networks denied except explicit Ollama mode, public-tool redirects disabled.
- Files: 5 MB limit, basename normalization, extension allowlist, NUL removal, no execution, explicit outbound-context consent.
- Tools/agents: fixed registry, validation, timeouts, workflow/node bounds, arbitrary code disabled, external observations treated as untrusted.
- Availability: auth/chat rate limits, provider timeouts, bounded message context and audit retention.

## Production checklist

Set a random 32+ character `Fabric_MASTER_KEY`; use TLS; run non-root; protect and back up data and key separately; use an egress proxy for public HTTP tools; add distributed rate limiting and PostgreSQL for multiple replicas; rotate secrets via re-encryption; commission penetration testing before public exposure.

## Residual risk

The JSON store is single-instance. URL validation alone cannot fully prevent DNS rebinding. Credential key rotation tooling, MFA, account recovery, OAuth scopes, malware scanning, and formal prompt-injection evals remain future work.

## Research and generated artifacts

Research page URLs are revalidated after redirects and private-network targets are blocked. Only explicit local SearXNG hostnames are allowed for research configuration. Retrieved pages are labeled untrusted before model use. Generated artifact paths are normalized, traversal segments are removed, and output size/file-count limits are enforced. Generated code is stored and exported but never executed.

## Universal uploads

Uploads stream to owner-only files with a 250 MB hard cap and generated storage names. Original paths are discarded. Extraction uses fixed binaries with argument arrays and no shell. Archive extraction limits entry count, individual size, and total decompression to reduce zip-bomb risk. Unknown formats are stored, never executed. Image bytes are sent only to a selected local Ollama provider after explicit file-context consent.

## 1.10.1 hardening additions

Argon2id is used for new passwords with legacy scrypt upgrade on login. RBAC now denies privileged routes to members/viewers. HTTP headers are centralized. Native artifacts require approved SHA-256 values in production. Plugin execution ignores arbitrary client endpoints and uses fixed read actions. Retrieved evidence is kept out of system instructions. Production uploads require malware scanning, block executables, inspect content type, and use bounded text/XLSX extraction. Remaining blockers are tracked in `KNOWN_LIMITATIONS.md` and must not be hidden or waived by weakening tests.
