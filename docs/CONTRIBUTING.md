# Contributing

Run `npm test && npm run check`. Every route must authenticate, enforce workspace ownership, validate bounded input, and return structured errors. Provider adapters must honor abort signals, normalize errors, and expose only verified capabilities. Tools must declare permissions and enforce timeouts; destructive tools require explicit confirmation. Add migrations for persistent shape changes. Never weaken controls or replace real behavior with fake responses to pass a test; reproduce, fix root cause, run focused and regression tests.
