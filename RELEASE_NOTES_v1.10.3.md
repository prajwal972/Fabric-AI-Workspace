# Fabric 1.10.3 — simplified conversation canvas

## Changes

- Removed the Task mode and Performance bar from the top of Chat.
- Moved Task mode, Performance, research sources, temperature, token limit, and system instructions into the composer three-dot Conversation controls dialog.
- Removed the top-right Settings and overflow controls; Providers, Security, and Logs remain available in the Settings page.
- Removed the redundant provider gear beside the model selector because provider management is available under Settings → Providers.
- Relocated New chat to the upper-right area inside the conversation canvas while preserving the sidebar new-conversation shortcut.
- Added responsive placement and regression coverage for the new control locations.

## Verification

Run `npm test`. No persistent-data migration is required.

## Rollback

Revert the `feat(chat): move modes into conversation controls` commit or check out tag `fabric-v1.10.2-ui-update`.
