# Fabric1.0 training and adaptation

This directory is a safe starting point for adapting Fabric1.0. It does not contain model weights or a claim of training on the whole internet.

## Recommended approach

1. Collect only data that you own, are licensed to use, or are explicitly permitted to process.
2. Remove secrets, personal data, copyrighted material without permission, and prompt-injection payloads.
3. Convert examples to JSONL with `messages` containing `system`, `user`, and `assistant` turns.
4. Validate the dataset with `node scripts/prepare-fabric-dataset.mjs input.jsonl output.jsonl`.
5. Use QLoRA/LoRA with an approved open-weight base model.
6. Keep current knowledge in retrieval indexes with citations instead of repeatedly retraining.

Training from scratch requires substantially more data, compute, evaluation, and licensing work than the current 16 GB/basic-GPU target.

## Example

See `dataset.example.jsonl`. The application can use the resulting model through `FABRIC_NATIVE_BASE_URL`; the model selector remains `Fabric1.0`.
