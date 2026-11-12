# Fabric 1.10.4 — full-height Chat canvas

## Changes

- Removed the marked Chat title/header bar.
- Expanded the conversation canvas to use the released vertical space.
- Kept New chat inside the conversation canvas.
- Added a chat-canvas Menu button on mobile so navigation remains accessible after the header is hidden.

## Verification

Run `npm test`. No persistent-data migration is required.

## Rollback

Revert the `feat(chat): remove the chat title header` commit or check out tag `fabric-v1.10.3-chat-controls`.
