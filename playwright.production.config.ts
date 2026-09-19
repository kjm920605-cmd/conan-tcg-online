import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e/production', fullyParallel: false, workers: 1, timeout: 120000,
  use: { browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chromium'),
    launchOptions: { args: ['--host-resolver-rules=MAP alpha.example.com 127.0.0.1, MAP game.example.net 127.0.0.1', '--no-proxy-server'] },
    viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'off' },
  // Tests own the real HTTPS service/DB lifecycle. No Vite development server and no WebSocket routing mock.
});
