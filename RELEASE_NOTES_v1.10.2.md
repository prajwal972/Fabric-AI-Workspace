# Fabric 1.10.2 — simplified chat controls

## Changes

- Added a top-right Settings button and three-dot overflow menu beside New chat.
- Consolidated Providers, Security, and Logs under a tabbed Settings page.
- Replaced the Fabric Voice, Hold to talk, and language selector controls with one hands-free microphone button.
- Enabled automatic English, Hindi, and Marathi detection by default for Azure Speech; Whisper-compatible services receive no forced language when automatic mode is used.
- Added an accessible delete action to every conversation-history entry while retaining the existing confirmation dialog and workspace-scoped deletion API.
- Added responsive, focus-visible, and reduced-motion styles for the new controls.

## Configuration

`FABRIC_VOICE_AUTO_DETECT=1` is now the documented default. Set it to `0` only when Azure multi-language detection must be disabled. Browser-only speech recognition remains limited by the languages supported and selected by the browser/operating system.

## Verification

- JavaScript syntax checks passed.
- Full automated suite: 94 passed, 0 failed.

## Rollback

Revert the `feat(ui): consolidate settings and simplify voice controls` commit. No persistent-data migration is required.
