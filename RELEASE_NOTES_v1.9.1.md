# Fabric 1.9.1

## Fixed
- Windows x64 native runtime selection now scans recent official releases and selects portable CPU ZIPs.
- Fabric 1.0 and Fabric Voice can install, retry, and start independently.
- Voice capture uses local Fabric Voice directly and reports permission, device, installation, and no-speech errors clearly.
- Restored a transparent, visible Fabric wordmark and favicon-safe branding.

## Changed
- Plugins now show a ChatGPT-style official authorization dialog and continue to the provider website.
- Manual plugin API-key/base-URL forms and endpoints are disabled. Unsupported connectors show Coming soon.
- Workflow navigation and UI were removed; legacy workflow API calls return HTTP 410 while stored data is preserved.

## Validation boundary
Release metadata selection and offline fixtures are tested for Windows x64. This source package does not bundle or execute the multi-gigabyte model download; upstream binaries and weights download during installation and keep their upstream licenses.
