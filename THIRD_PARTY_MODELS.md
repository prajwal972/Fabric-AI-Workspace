# Fabric native runtime and model notices

Fabric 1.0 is Fabric's local orchestration, task-mode, tool, file-context, research, dashboard, workflow, and safety layer. It is not a claim that the included installer created new foundation-model weights.

On first installation Fabric downloads and manages:

- **Qwen2.5-7B-Instruct GGUF** base weights (default Q4_K_M build from the bartowski repository). Qwen2.5 is distributed under its upstream license.
- **llama.cpp** native inference runtime from the official ggml-org GitHub releases.
- **whisper.cpp** native speech runtime and `ggml-base.en.bin` model from the official whisper.cpp project.

These assets are not stored in the release ZIP. They are downloaded over HTTPS into `data/native/`, their SHA-256 digests are recorded in `data/native/manifest.json`, and they remain subject to their upstream licenses and notices. Set the documented environment overrides if your organization mirrors or approves specific builds.
