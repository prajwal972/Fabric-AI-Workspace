# Fabric v1.10.4 — PostgreSQL-runtime upgrade

**Tested upgrade checkpoint; not production-certified.** The existing Fabric UI and deterministic analyst are preserved. Production state now uses PostgreSQL, Redis/BullMQ, encrypted S3 and pgvector. Missing infrastructure fails closed; production never defaults to `flux.json`.

## Start here

- Engineering report and test results: `docs/engineering/UPGRADE_REPORT.md`.
- Deployment/configuration/import: `docs/PRODUCTION_SETUP.md` and `.env.example`.
- Release blockers: `docs/KNOWN_LIMITATIONS.md`.
- Architecture/tests: `docs/ARCHITECTURE.md`, `docs/TESTING.md`.
- Complete file inventory: `docs/engineering/FILES_CHANGED.json`.

```sh
npm ci
npm run check
npm test
# Configure migrated PostgreSQL, Redis and encrypted S3 before the production runtime:
npm start
npm run worker
```

Without `DATABASE_URL`, development/demo can run the original local server. Staging/production refuse that fallback. See the runbook for mandatory scanner, migrations, HTTPS, least-privilege roles and deployment verification. No dependencies or real credentials are bundled.

## Latest checkpoint 8

374 Linux unit cases, syntax and two local browser journeys pass. Shared CSV/XLSX correctness, signed charts/real scatter coordinates, percentage interpretation and hash/worksheet provenance are corrected in place. Targeted engine edits are intentional; unrelated deterministic code is retained. Fresh offline install and real-service setup remain blocked (ENOTCACHED / DATABASE_UNAVAILABLE). Native Windows, live AI, secure execution and public deployment are not certified. See `FINAL_REPORT.md`; historical results are not current release approval.

---
## Historical original/local documentation

The material below records the original build and earlier checkpoints. Use the documents above for current upgrade status; historical readiness and persistence claims do not apply to this delivery.

# Fabric 1.9 native intelligence

Fabric1.0 and Fabric Voice are built into the product experience and require no Ollama configuration, provider account, or API key. The first Studio installation requires internet access and approximately 5 GB of free disk space. Downloads are resumable; progress is visible in Studio. After installation, chat and speech recognition run locally and offline.

## First run

1. Copy `.env.example` to `.env` and change `FABRIC_MASTER_KEY`.
2. Run `npm start`, then open `http://127.0.0.1:8787`.
3. Create an account and open **Studio**.
4. Click **Install Fabric1.0** and keep Fabric running until progress reaches 100%.
5. Open Chat. **Fabric1.0** is already selected. Voice automatically uses Fabric Voice when browser recognition is unavailable.

For a 16 GB computer, keep `FABRIC_NATIVE_GPU_LAYERS=0` unless you know the GPU supports llama.cpp offload. Model speed depends on CPU, RAM, GPU, and context size. See `THIRD_PARTY_MODELS.md` for the exact distinction between Fabric's orchestration and upstream base weights.

# Fabric

**One workspace → many models → many tools → intelligent orchestration → one workflow.**

Fabric V1.0.1 is a local-first, provider-independent AI workspace. This V1 runs on Node.js built-ins: no dependency installation is needed. It includes secure authentication, encrypted provider credentials, streaming chat, conversation persistence/search, file context with explicit consent, multi-model comparison, allowlisted tools, bounded agents, reusable workflows, logs, Docker, and tests.

## Run locally

Requirements: Node.js 20+.

```bash
export Fabric_MASTER_KEY="$(openssl rand -hex 32)"
npm start
# http://127.0.0.1:8787
```

Development: `npm run dev` · Tests: `npm test` · Syntax: `npm run check`.

Docker:

```bash
export Fabric_MASTER_KEY="$(openssl rand -hex 32)"
docker compose up --build
```

## Providers

- **Fabric Mock:** deterministic development/testing only; clearly labeled.
- **OpenAI-compatible:** `/models` discovery and streaming chat-completions. Works with services implementing that contract; validate each endpoint before use.
- **Ollama:** local `/api/tags` discovery and `/api/chat` streaming.

Keys are AES-256-GCM encrypted and never returned by APIs. Fabric does not bypass billing, quotas, authentication, rate limits, or model context limits. Unknown capabilities and costs stay unknown rather than being fabricated.

## File pipeline

Upload → extension/size validation → text extraction/normalization → chunk count → workspace-scoped persistence → explicit context opt-in. Implemented: TXT, Markdown, CSV, JSON, YAML, XML, HTML, and source. PDF, DOCX, XLSX adapters are intentionally disabled in V1 and return a clear error.

## Architecture and docs

See `docs/ARCHITECTURE.md`, `docs/DATA_ANALYST.md`, `docs/SECURITY.md`, `docs/API.md`, and `docs/CONTRIBUTING.md`.

## Current limitations

The durable JSON store targets one local instance, not clustered production. The workflow UI saves linear typed chains rather than arbitrary graph edges. Agent planning is bounded and currently recognizes calculator tasks before model synthesis. OAuth plugins, resumed approvals, embeddings/vector retrieval, Office/PDF parsing, workspace invitations, code execution, and live-provider CI are not implemented. Use PostgreSQL/object storage/isolated workers before multi-tenant internet deployment.

## Provider troubleshooting

Select the preset that issued the API key. HTTP 401 means the key was rejected; 403 means the provider denied access due to URL/preset, permissions, project/organization, billing, or region; 429 means rate limit/quota. Use **Configure** to correct the base URL, rotate the key, or set a default model when model-list permission is unavailable. Fabric never bypasses provider access controls.

## Selecting a model

The Chat toolbar shows separate **Provider** and **Model** selectors plus an active `Provider · Model` badge. Every assistant message records and displays the provider, model ID, and latency. The Fabric Mock adapter is deterministic and only echoes prompts; choose a connected external provider for real inference. Use only model IDs returned by **Load models** or accepted by the configured provider.

## OpenAI reasoning models

OpenAI `o1`, `o3`, and `o4` model IDs are routed through the official Responses API rather than Chat Completions. For compatible chat endpoints, Fabric retries once without `temperature` when the provider reports that the parameter is unsupported. Failed generations are persisted and displayed inline instead of leaving an empty assistant response.

## Deprecated models

When a provider reports that a model is deprecated, Fabric records the failure, removes that model from the provider selector, clears it as the configured default, and prevents **Load models** from re-adding it. Reload models and choose another model currently exposed by the provider. Fabric cannot restore a model that the provider has retired.

## Switching a provider to Ollama

Configure the provider, select **Ollama (local)**, and use `http://127.0.0.1:11434` when Fabric runs directly on the host. The provider type is updated server-side, the API-key field is disabled, and any old external-provider credential is removed. When Fabric runs in Docker Desktop, use `http://host.docker.internal:11434`.

## OpenRouter credits and output limits

Fabric now sends an explicit **Max output** value (default 512) instead of allowing an OpenRouter model to assume a very large output such as 65,536 tokens. Lower the value further if OpenRouter reports HTTP 402, or add credits. Fabric does not bypass provider billing.

## Anthropic

Select the native **Anthropic** preset, use `https://api.anthropic.com/v1`, enter an Anthropic API key, validate, and load models. Fabric uses Anthropic's native `/messages` streaming API and `/models` discovery endpoint. Live access still depends on the user's Anthropic account, credits, key permissions, and available model IDs.


## Local Intelligence Studio

Fabric 1.3 adds task modes for general conversation, deep research, report writing, document analysis, code writing, debugging, project generation, and website generation. Use **Local Ollama** to avoid paid model APIs. The model itself runs on your machine, so capability, speed, and context size depend on the installed model and hardware.

Project and website modes emit `file path="..."` blocks. Use **Save output** on an assistant response, then download a clean ZIP from **Studio**. Generated code is not executed automatically.

### Local research

Deep research can query a self-hosted SearXNG endpoint and safely retrieve public result pages. Configure it in Studio or set `Fabric_RESEARCH_URL`. Search results and page content are treated as untrusted data. Docker Compose includes SearXNG with JSON results enabled. Research requires internet access from SearXNG and is not guaranteed when sites block retrieval.

### Current document formats

Text, Markdown, CSV, JSON, YAML, XML, HTML, SQL, shell scripts, and common source-code formats are supported. PDF, DOCX, image OCR, and spreadsheet extraction are not yet included in the dependency-free runtime.

### All-local Docker stack

`docker compose up -d --build` starts Fabric and the optional SearXNG research service on loopback-only ports. Open `http://127.0.0.1:8787`, visit Studio, and select **Install Fabric1.0**. Fabric downloads and manages its native inference and speech assets in the persistent Fabric data volume. No Ollama service or API key is required.


## 1.3 performance and universal intake

Fabric streams uploads directly to encrypted-local workspace storage instead of converting them into oversized JSON. Multiple files up to 250 MB each are accepted. Text and source files are decoded directly; DOCX, XLSX, PPTX, OpenDocument, EPUB, and ZIP-family containers use dependency-free extraction; Docker adds Poppler PDF extraction, Tesseract OCR, and FFmpeg media metadata. Images can also be attached to an Ollama vision model. Unknown formats are stored safely for download even when no analyzer exists.

Local generation now defaults to **Fast** mode with 256 output tokens, an 8-message history, a 12k-character file budget, a 4k context, throttled browser rendering, and a 30-minute Ollama keep-alive. Balanced and Quality modes remain available. The Models page can warm an Ollama model before the first prompt.


## Fabric 1.4 conversation interface

The provider toolbar and per-message technical metadata are hidden from normal chat. Choose a combined provider/model from the composer. The gear button opens provider management, and the ellipsis opens system instructions, output length, temperature, comparison, and deletion. User messages align right; Fabric responses align left.

**Voice conversation** uses the browser Speech Recognition and Speech Synthesis APIs. In current Chrome or Edge, click Voice, allow microphone access, and speak. Fabric sends the completed transcript, reads the answer aloud, and listens again until Voice is turned off. Browser speech services may use an online vendor service and are not guaranteed to be offline. Typed chat and Ollama inference remain local.

Preferred environment variables now start with `FABRIC_`. Existing `FLUX_` server variables remain accepted for upgrades.


## Fabric1.0 local model

Fabric1.0 is a protected built-in conversational model profile, separate from all external providers. When the managed native runtime and GGUF weights are installed, Fabric starts them automatically and streams normal multi-turn answers through the same chat interface. `FABRIC_NATIVE_BASE_URL` can point to a compatible managed endpoint. Ollama remains optional and is not required by Fabric1.0.

Fabric1.0 is an application-level profile built on approved open local weights, not a new foundation model trained from scratch. The repository includes a model card and a dataset-validation scaffold under `model/fabric-1.0` and `training/`. Deep research uses retrieval with supplied sources and citations; it does not silently train on the whole internet. Model quality and speed depend on the installed base model and hardware.


## Data Analyst Agent

The Agents area now provides a persistent, local-first conversational BI analyst. Select structured workspace files, inspect the initial raw-row and semantic-profile tables, then ask Fabric to calculate, clean, segment, filter, explain, or build and refine a dashboard. The deterministic engine owns every KPI and chart value, selects metrics by semantic role, attaches formulas/provenance, produces an evidence-backed AI Data Story, persists state and versions, and supports undo. It intentionally avoids meaningless KPIs such as Total Age.

Provider/model and native-runtime systems remain available to Fabric, but analytical numbers come only from parsed rows and declared calculations. Dashboard export is JSON rather than `.pbix` or a Tableau workbook. See `docs/DATA_ANALYST.md` for workflow, contracts, schema, examples, tests, limitations, and verification.

## Voice conversation

Voice now requests microphone permission explicitly, reports listening/speaking states, handles missing devices and browser speech-service failures, and resumes listening after Fabric speaks. Use current Chrome or Edge on `localhost` or HTTPS and allow microphone access in the address bar. Browser speech recognition can require internet access even when the selected LLM runs locally.

## Plugin marketplace and visual automation

Fabric 1.7 replaces the small Tools screen with an extensible plugin marketplace and an n8n-inspired workflow builder. The bundled catalog includes common communication, productivity, development, storage, CRM, commerce, data, analytics, support, and AI services. Universal Webhook and REST API templates cover services not listed in the catalog.

Connections use public HTTPS API endpoints and encrypted API keys or access tokens. Some vendors require you to create an OAuth application and supply an access token; Fabric does not pretend to bypass a vendor OAuth, billing, permission, or API policy. Database plugins should be exposed through a properly secured API gateway rather than opening a database port to the internet.

The visual builder supports triggers, plugin actions, AI, transforms, conditions, bounded delays, approval pauses, and outputs. Outbound plugin calls are restricted to the configured origin, checked against SSRF controls, rate limited by the application, and limited to GET and POST.

## Voice permission fix in 1.7.1

Fabric now explicitly permits same-origin microphone access in its HTTP Permissions-Policy header. Voice conversation works in current Chrome or Edge when Fabric is opened from `http://localhost` on the computer running it, or from a trusted HTTPS address. The browser still requires the user to approve microphone access. If access was previously denied, open the browser site controls, change Microphone to Allow, reload Fabric, and press Voice again. Browsers do not let a website silently override a denied permission.


## Fabric 1.8: voice, official plugins, adaptive analytics, automation

- Voice first tries browser/on-device recognition and automatically falls back to Fabric Voice. Fabric records 16 kHz PCM/WAV locally, starts its managed whisper.cpp service, transcribes privately, sends the message, and reads the response aloud. No separate Whisper command is required after the Studio installation finishes. Advanced deployments can still override `FABRIC_STT_URL`.
- Official OAuth is supported for GitHub, Slack, Notion, Google, and Microsoft plugin families. Register an OAuth app with the vendor, set `FABRIC_PUBLIC_URL`, `FABRIC_OAUTH_<PROVIDER>_CLIENT_ID`, and `FABRIC_OAUTH_<PROVIDER>_CLIENT_SECRET`, then use the callback `FABRIC_PUBLIC_URL/api/plugins/oauth/<plugin-id>/callback`. Fabric cannot supply or bypass vendor OAuth registrations.
- Connected read-capable plugins can be selected from the chat composer. Fabric fetches bounded app context before inference. External write actions remain explicit workflow nodes.
- Data Analyst automatically profiles uploaded structured files before a query, including columns, inferred types, missing values, uniqueness, ranges, row counts, and a quality score. Adaptive dashboards support bar, line, area, pie, scatter, histogram, heatmap, and table views with a Shuffle visuals action.
- The automation editor adds an n8n-style grid canvas and zoom controls while preserving bounded execution, encrypted credentials, SSRF protection, and human-approval nodes. It is an original Fabric implementation and is not a full copy of every n8n capability.


## Fabric 1.9.1 patch

- Repairs official Windows x64 CPU archive discovery by scanning recent llama.cpp and whisper.cpp releases instead of relying on a potentially asset-free `latest` release.
- Installs or retries Fabric1.0 and Fabric Voice independently.
- Uses Fabric Voice directly for private local transcription; browser microphone permission is still required.
- Plugins use official-site OAuth authorization dialogs. Manual plugin API keys and arbitrary endpoints are disabled.
- The Workflow section has been removed from navigation and its API returns `410 Gone`; existing stored records are retained for migration safety.
- Restores the transparent Fabric wordmark as `/fabric-logo.svg`.

## Fabric 1.9.2 Windows reliability notes

- On Windows, Fabric now stores mutable workspace data under `%LOCALAPPDATA%\Fabric AI\data` by default instead of inside the extracted project folder. This avoids OneDrive/antivirus locks on `flux.json`. When updating the same folder, Fabric migrates an existing `data` directory automatically, including the master key required for encrypted provider credentials.
- Fabric1.0 includes the conversational runtime integration and can run from managed local weights or a configured managed endpoint. Without model weights or a reachable endpoint, it falls back to built-in workflow responses and clearly cannot provide unrestricted general knowledge.
- The Data Analyst Agent can directly profile CSV, TSV, and JSON files, calculate KPIs, and create charts with Fabric1.0. File extraction is awaited automatically after upload.
- Voice first uses Chrome/Edge browser speech. If that browser service reports a network error on Windows, Fabric records locally and uses installed Windows Speech Recognition. A Windows speech language and microphone permission are still required; Fabric cannot bypass operating-system permissions.
- Provider validation requires the provider service to be reachable and correctly configured. For local Ollama, start Ollama and keep the default URL `http://127.0.0.1:11434`, or enter the port used by your Ollama service.

## Fabric Voice assistant

Chat now includes **Fabric Voice** hands-free mode and **Hold to talk**. It supports English (India), Hindi, and Marathi, with Auto language comparison, automatic end-of-turn detection, spoken model responses, echo/noise controls, and the existing local/browser fallback.

To enable Azure neural speech, create an Azure Speech resource and configure these values locally (never in browser code or source control):

```bash
AZURE_SPEECH_KEY=your-resource-key
AZURE_SPEECH_REGION=your-resource-region
```

The browser sends microphone audio only to Fabric's authenticated server. The server calls Azure Speech and keeps the key private. Without Azure configuration, Fabric uses the existing native, Windows, or browser speech path. Use localhost or trusted HTTPS and allow microphone access.
