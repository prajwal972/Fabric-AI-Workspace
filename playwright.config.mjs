import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export default defineConfig({
  testDir: './integration', testMatch: '**/browser.spec.mjs',
  timeout: 60000, workers: 1, retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:27887', headless: true,
    viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure',
    launchOptions: process.env.FABRIC_TEST_CHROMIUM ? { executablePath: process.env.FABRIC_TEST_CHROMIUM } : {},
  },
  webServer: {
    command: 'node src/server.mjs', url: 'http://127.0.0.1:27887/api/live', reuseExistingServer: false,
    env: { NODE_ENV: 'test', FABRIC_HOST: '127.0.0.1', FABRIC_PORT: '27887', FABRIC_PUBLIC_URL:'http://127.0.0.1:27887', FABRIC_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-browser-')), FABRIC_MASTER_KEY: 'disposable-browser-test-key-32-characters', FABRIC_NATIVE_DISABLE: '1', DATABASE_URL: '', REDIS_URL: '', S3_ENDPOINT: '', FABRIC_UPLOAD_SCAN_MODE: 'optional' },
  },
});
