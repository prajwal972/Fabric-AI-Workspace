# Fabric V1.0.1 Delivery Report

## 1–3. Architecture, stack, structure

Dependency-free Node.js 20+ server and responsive browser SPA. HTTP/SSE API, versioned atomic JSON persistence, Web Crypto-compatible browser client, Docker. Structure: `src/server.mjs`, `public/`, `test/`, `docs/`, Docker and environment files.

## 4. Implemented

Local accounts; strict sessions/CSRF; workspace boundaries; encrypted provider credentials; provider validation/model discovery; streaming chat; stop generation; histories, rename API, search UI, delete, system instructions, temperature, Markdown/code display, file attachments; explicit file-context consent; multi-model comparison with latency/usage only when reported; model routing; text knowledge extraction; memory controls; calculator/clock/safe-HTTP tools; bounded agent runs; persisted linear workflows with approval halt; audit logs; health endpoint; Docker; dark/responsive UI.

## 5. Providers

- Fabric Mock: tested development adapter, not real inference.
- OpenAI-compatible: implemented; live account validation not executed in this environment.
- Ollama native API: implemented; live local daemon validation not executed in this environment.

## 6. Tools

Calculator, clock, and SSRF-restricted public HTTP GET. Arbitrary code and destructive tools are disabled.

## 7–10. Data, security, agents, workflows

Collections: users, workspaces, members, sessions, providers, conversations, messages, files, memories, workflows, runs, audit. Security includes scrypt, AES-256-GCM, hashed session tokens, HttpOnly/SameSite cookies, CSRF, CSP, escaping, size/context bounds, rate limits, redaction, SSRF checks, abort/timeout paths, workspace authorization. Agents execute plan → optional allowlisted tool → untrusted observation → model synthesis → final. Workflows execute typed nodes with node/iteration bounds and stop at human approval.

## 11. Tests

Automated suite covers password hashing, encryption/tamper failure, log redaction, SSRF checks, bounded calculation, mock streaming, and end-to-end registration → session/CSRF → conversation → SSE response → persisted messages. Run with `npm test`. Syntax is checked with `npm run check`. Desktop login/dashboard visual QA passed with zero viewport overflow, clipping, failed resources, or console errors.

## 12–13. Bugs found and fixed

V1.0.1 hardening also adds DNS-aware SSRF checks for remote providers, strict model selection validation, attachment workspace validation, temperature bounds, tool rate limiting, safer cookie parsing, provider response-shape validation, and robust static-path containment.

- Decorative login rings triggered clipped-overflow diagnostics: replaced pseudo-element overflow with bounded radial-gradient art.
- Initial server URL construction was malformed during generation: corrected to a valid host-based base URL and regression tested.
- Private IPv6 loopback/link-local cases were missing from SSRF checks: added.
- Login attempts were not rate-limited while registration was: added the same bounded policy.

## 14. Remaining limitations

| Feature | Status | Reason | Workaround | Next step |
|---|---|---|---|---|
| Live provider certification | Unverified | No user credential/Ollama daemon supplied | Use mock; validate from Providers | Add credential-safe provider CI |
| PDF/DOCX/XLSX parsing | Not implemented | Secure parser pipeline excluded from V1 | Convert to TXT/MD/CSV | Isolated parser workers + malware scan |
| Vector retrieval | Not implemented | Not needed for small text context | Attach selected files | PostgreSQL + pgvector after quality eval |
| Visual DAG editor | Partial | V1 persists linear typed chains | Choose middle node template | Add edge validation/canvas editor |
| Human approval resume | Partial | Runs halt safely | Re-run after review | Signed resume endpoint |
| OAuth marketplace | Not implemented | Requires provider registrations | OpenAI/Ollama credentials | Scoped OAuth connector SDK |
| Multi-instance deployment | Not supported | Atomic JSON store is single-process | Run one instance | PostgreSQL repository adapter |
| Arbitrary code | Disabled | Host execution is unsafe | Use built-in tools | Isolated, network-denied worker |

## 15–17. Install, run, environment

```bash
export Fabric_MASTER_KEY="$(openssl rand -hex 32)"
npm start
npm test
```

Variables: `Fabric_PORT` (8787), `Fabric_HOST` (127.0.0.1), `Fabric_DATA_DIR` (`./data`), `Fabric_MASTER_KEY` (required in production), `NODE_ENV`.

## 18. Roadmap

PostgreSQL repository, object storage and parser workers; OAuth/plugin SDK and scoped approvals; capability/cost registry sourced from providers; pgvector retrieval and injection evaluations; resumable DAG workflows; sandbox worker; MFA/account recovery; distributed queues/rate limits; browser E2E matrix and live-provider contract tests.

## Quality-gate statement

The local application, frontend, backend, persistence, authentication, mock abstraction, SSE streaming, conversations, supported text file handling, error paths, tests, and documentation are verified. The project is **not labeled “PROJECT COMPLETE”** because a real external provider could not be credential-tested in this environment and the limitations above remain explicit.

## 1.0.2 fixes

Corrected dark-mode button, logo, status, hover, and disabled-state contrast; added provider presets and configuration editing; added manual default-model support; mapped 401/403/404/429/5xx provider errors to actionable messages; persisted provider errors on cards; and removed runtime data/master keys from the distributable.

## 1.0.3 fixes

Added explicit provider and model selectors in Chat, an active provider/model badge, per-message provider/model/latency metadata, a prominent development-mock warning, and prevention of silent mock-model fallback for real providers and comparison runs.

## 1.0.4 fixes

Added OpenAI Responses API streaming for o1/o3/o4 reasoning models, automatic retry without unsupported temperature, provider error details, and persisted inline failed-generation messages so errors no longer appear as blank Fabric responses.

## 1.0.5 fixes

Deprecated provider models are now detected, persisted in a blocked-model list, removed from chat selection, cleared as defaults, and filtered from later model reloads. The client refreshes provider/model state automatically after the error.

## 1.0.6 fixes

Provider configuration can now change adapter type. Switching an existing OpenAI-compatible card to Ollama enables local endpoints, disables the API-key field, clears obsolete credentials, resets stale model state, and validates using Ollama local-mode rules.

## 1.1.0 fixes

OpenRouter requests now include a bounded max-output value (default 512), HTTP 402 receives a credits-specific explanation, and the Chat toolbar exposes Max output. Added a native Anthropic provider with credential validation, model discovery, `/messages` streaming, normalized usage, and secure credential handling.

## 1.2.0 local intelligence

Added eight task modes, local Ollama quick setup, optional SearXNG research with SSRF-safe retrieval, cited source metadata, broader source-file analysis, generated report/project storage, and dependency-free ZIP export. Generated code is never executed automatically.

## 1.4.0 experience release

Added stream-to-disk multi-file upload, broad background extraction, original-file downloads, Ollama image attachments, three performance profiles, model keep-alive/warm-up, generation status and TTFT metrics, throttled token rendering, and a complete minimal sci-fi visual system.
