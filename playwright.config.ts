import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 4329;
const DATA_DIR = join(tmpdir(), 'wefood-e2e-data');

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: 'chrome',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: `rm -rf "${DATA_DIR}" && npm run build && node dist/server/index.js`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR, TRUSTED_ORIGINS: `http://127.0.0.1:${PORT}`, WEFOOD_SETUP_TOKEN: 'e2e-setup-token-0001', SECURE_COOKIE: 'false' }
  }
});
