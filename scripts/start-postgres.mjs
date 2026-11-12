import { startApplication } from "../src/application/server.mjs";
if (!process.env.DATABASE_URL)
  throw new Error(
    "DATABASE_URL is required for the PostgreSQL launch. Use Local Windows (demo only) for the separate local runtime.",
  );
await startApplication();
