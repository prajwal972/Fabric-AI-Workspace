# Fabric 1.9.1 — Vision Glass UI

## Scope
Visual and interaction redesign of the existing Fabric application. The backend, native runtime, API contracts, database schema, security controls, provider integrations, workflow retirement state, and model logic are unchanged.

## Created
- `public/vision-glass.css` — four-level glass hierarchy, spatial background, typography, controls, chat, voice, models, files, plugins, analyst, security, logs, motion, responsive and accessibility treatments.
- `test/glass-ui.test.mjs` — static regression coverage for stylesheet order, design tokens, selectors, motion fallbacks, model/voice metadata, and repaired security/log routes.

## Modified
- `public/index.html` — loads the visual override last.
- `public/app.js` — exposes provider/status/native-external metadata in the existing selector, maps existing voice status to visual classes and accessible labels, and restores previously referenced Security and Logs renderers using the existing `/api/logs` endpoint.

## Preserved
All stable IDs, classes, data attributes, navigation hooks, chat streaming, uploads, Fabric Native controls, official connector authorization, Data Analyst behavior, authentication, security mechanisms and API contracts. Workflow UI/API remain intentionally retired as in v1.9.1.

## Motion and accessibility
Transform/opacity entrance motion, restrained hover/press feedback, voice ripples, modal elevation, `:focus-visible`, mobile touch targets, reduced-motion, reduced-transparency, forced-colors, and no-backdrop-filter fallbacks.

## Limitations
Browser/OS microphone permission cannot be bypassed. Official connectors require provider-site approval. Fabric 1.0 remains an orchestration/product layer over upstream weights. Full multi-gigabyte model download and Docker validation were not performed in the sandbox.

## Layout refinement
- Repaired the Fabric wordmark so the full name renders without clipping.
- Moved the live conversation browser into the navigation sidebar directly below Logs.
- Moved Task mode, Performance, and mode context into the upper application bar.
- Preserved all existing conversation, mode, performance, search, model, streaming, and New chat event handlers.

## Composer and history refinement
- Anchored the message composer to the bottom center of the chat surface at desktop and mobile sizes.
- Removed the separate glass container around conversation history.
- Merged conversation history directly into the navigation below Logs with a compact vertical list.

## Brand, model, and agent refinement
- Updated the transparent Fabric wordmark with a premium cool-gradient treatment.
- Removed the Deep Research informational banner shown after task-mode selection; Sources remains available.
- Simplified model dropdown labels to model names only while preserving internal provider routing.
- Added the supplied robot artwork as the Data Analyst Agent avatar.

## Folded-F identity and composer refinement
- Recreated the supplied visual direction as original transparent SVG artwork; the reference image is not embedded.
- Added a full Fabric lockup with folded-F emblem, FABRIC wordmark, and tagline.
- Replaced compact blue F tiles in empty chat and assistant messages with the transparent folded-F emblem.
- Removed the Use files checkbox; attached files now opt into file context automatically.

## Exact supplied logo treatment
- Processed the supplied Fabric artwork into a transparent full-logo PNG.
- Cropped its exact F emblem into a separate transparent asset.
- Replaced the full sidebar/auth logo and every compact chat F tile with these background-free assets.

## Logo sizing refinement
- Increased the transparent Fabric lockup to a balanced best-fit size on the welcome panel, sign-in card, and application sidebar.
- Removed the marked local-install tagline from the welcome panel.
- Added responsive logo sizing to prevent overflow on narrow screens.

## Fabric 1.0 direct-use engine
- Fabric 1.0 now works immediately through the built-in Fabric task engine when no managed native endpoint is configured.
- Removed model and voice download/install controls from Studio and Models.
- Added direct task-mode output paths for conversation, research planning, reports, document analysis, code, debugging, project bundles, and website bundles.
- Voice conversation now uses browser speech recognition and speech synthesis directly; no Fabric Voice download is offered.
- Removed only the small tagline from the transparent logo artwork while preserving the original F emblem and FABRIC wordmark.
- Fabric 1.0 remains accurately described as a built-in task/orchestration engine, not a newly trained foundation-weight model.


## Windows reliability and full-function repair
- Moved the default Windows data store out of synchronized project folders into Local AppData, with one-time migration of existing accounts, uploads, and encrypted credentials.
- Added serialized, retryable persistence with a safe fallback when OneDrive or antivirus software blocks atomic rename operations.
- Repaired Fabric 1.0 chat persistence and added direct project-idea and continuation responses.
- Added a direct data-analysis engine that computes KPIs and charts from uploaded CSV/TSV/JSON data without an external provider.
- Data Analyst uploads now wait for extraction instead of failing immediately with a processing warning.
- Provider validation/model discovery now survives storage retries and reports an actionable Ollama connection message.
- Voice now falls back from the browser speech service to Windows Speech Recognition when available, without a Fabric Voice download.
