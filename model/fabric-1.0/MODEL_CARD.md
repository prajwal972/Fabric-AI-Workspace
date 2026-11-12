# Fabric1.0 Conversational Runtime

Fabric1.0 is an application-level conversational profile integrated into Fabric AI Workspace. It combines an open-weight instruct model, the Fabric Native llama.cpp-compatible runtime, task-mode instructions, file context, research tools, data analysis, project generation, and secure application routing.

## Honest capability statement

This release does not claim that Fabric trained new foundation weights. The default local asset is an upstream Qwen2.5 7B Instruct GGUF quantization selected for local use. Upstream model, runtime, and dataset licenses remain applicable.

## Runtime

- Model ID exposed in Fabric: `fabric:1.0`
- Native runtime: Fabric-managed llama.cpp-compatible server
- Default quantization: Q4_K_M
- Default model source: configured by `FABRIC_NATIVE_MODEL_URL`
- Optional managed endpoint: `FABRIC_NATIVE_BASE_URL`

## Supported modes

General, Deep research, Report writer, Document analyst, Code writer, Code debugger, Project builder, and Website builder.

## Limitations

Quality, speed, context length, vision support, and tool reliability depend on the installed base model and hardware. Current web information comes from retrieval tools and is not silently copied into model weights.
