# Plugin security

Connectors use provider OAuth and least-privilege read scopes. Runtime execution is restricted to `PLUGIN_CHAT_ACTIONS`; client-supplied paths/methods/bodies are ignored. New actions require a typed schema, explicit permission, timeout, audit event, response-size bound, and tests. Sending, deleting, publishing, purchasing, or modifying external data requires a short-lived user confirmation grant. Provider-side token revocation and refresh remain required before production connector certification.
