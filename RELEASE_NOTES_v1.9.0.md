# Fabric 1.9.0 — Native Model + Voice

- Separates Fabric 1.0 from Ollama and every external provider.
- Adds a protected built-in `fabric-native` provider and selects it by default.
- Installs llama.cpp, managed Qwen2.5-7B-Instruct GGUF weights, whisper.cpp, and a local speech model from Studio.
- Adds resumable downloads, progress, retry, manifest digests, automatic process startup, and graceful shutdown.
- Records voice as 16 kHz PCM/WAV for dependable private transcription.
- Keeps Ollama and paid APIs optional rather than required.
- Adds honest third-party model/runtime attribution.

First install requires internet, approximately 5 GB of free disk space, and may take several minutes to over an hour depending on connection speed. Model response speed depends on the computer. Microphone permission is still controlled by the browser and operating system.
