# Local development

```bash
cp .env.example .env
# Set a development-only FABRIC_MASTER_KEY.
npm ci
npm run check
npm test
npm start
```

The development server binds to `127.0.0.1:8787` by default and uses `./data`. Malware scanning is optional outside production when `FABRIC_UPLOAD_SCAN_MODE=optional`. Never reuse development keys or data in production. Ollama is optional. Azure Speech, OAuth, PostgreSQL, Redis, and S3 require explicit configuration.
