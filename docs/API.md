# API

Errors: `{ "error": { "code", "message", "requestId" } }`. Authenticated mutations require `x-csrf-token`.

- Health/auth: `GET /api/health`, `POST /api/auth/register|login|logout`, `GET /api/me`
- Providers: `GET|POST /api/providers`, `POST /api/providers/:id/validate|default`, `GET /api/providers/:id/models`, `DELETE /api/providers/:id`
- Chat: `GET|POST /api/conversations`, `GET|PATCH|DELETE /api/conversations/:id`, `POST /api/chat/stream`, `POST /api/chat/compare`
- Knowledge: `GET|POST /api/files`, `DELETE /api/files/:id`
- Tools/agents: `GET /api/tools`, `POST /api/tools/execute`, `POST /api/agents/run`
- Workflows: `GET|POST /api/workflows`, `POST /api/workflows/:id/run`
- Controls: `GET|DELETE /api/memory`, `PATCH /api/memory/settings`, `GET /api/logs`, `GET /api/dashboard`

Provider contract: `validate()`, `models()`, and async `stream({model,messages,temperature,signal})`; chunks contain `{text}` or `{usage}`. Unknown usage is omitted.

## Provider adapters

Native adapters: Ollama and Anthropic. OpenAI-compatible adapters: OpenAI, OpenRouter, Groq, Mistral, Gemini compatibility endpoint, and custom services. Chat accepts `maxTokens` from 1 to 8192; default 512.

## Local Intelligence APIs

- `GET /api/modes` lists task modes.
- `GET/PATCH /api/research/settings` configures optional SearXNG.
- `GET/POST /api/artifacts` lists or creates generated output bundles.
- `GET /api/artifacts/:id/download` downloads a ZIP.
- Chat accepts `mode` and up to five `researchUrls`.

## Streaming files and performance

`POST /api/files/upload` accepts the raw file body with `x-file-name` and `x-file-type` headers, up to 250 MB. `GET /api/files/:id/download` returns the original. Chat accepts `performance` (`fast`, `balanced`, or `quality`) and returns status plus time-to-first-token telemetry over SSE. Ollama providers support `POST /api/providers/:id/warm`.

## Conversational BI / Data Analyst

All routes use the existing Fabric session, CSRF protection for mutations, workspace file ownership, extraction wait, rate limits, audit log, and durable state.

- `POST /api/agents/data-profile` with `{ "fileIds": [...] }` returns previews, semantic metadata, and quality.
- `POST /api/agents/data-analyst` with `{ "fileIds": [...], "query": "Create a dashboard" }` returns intent, answer, operation, executed stages, dashboard, profile, semantic model, analytical questions, and a safe state summary.
- `GET /api/agents/data-state` returns `{ "state": ... }`, including the persisted active dashboard and conversation.
- `POST /api/agents/dashboard-operation` accepts `{ "fileIds": [...], "operation": { "type": "APPLY_FILTER", "value": "Germany" } }` and returns the same analytical response contract.

Structured operations cover create/refresh, cleaning, filters, metric and visual changes, layout/theme, analysis, insights, explain, and undo. Numeric results are produced only by deterministic row operations.

## Operations endpoints

- `GET /api/live` — process liveness; 503 while draining.
- `GET /api/ready` — dependency readiness with bounded PostgreSQL, Redis, and object-storage checks when configured.
- `GET /api/health` — compatibility alias for readiness.
- `GET /api/metrics` — Prometheus text; requires `Authorization: Bearer $FABRIC_METRICS_TOKEN`.

All API responses receive request IDs and centralized security headers. Mutations require a valid session, same-origin request when an Origin header is present, CSRF token, workspace ownership, and RBAC permission.
