import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", testIgnore: ["**/persistent/**", "**/production/**"], fullyParallel: false, workers: 1, timeout: 120000,
  use: { baseURL: "http://127.0.0.1:5173", browserName: "chromium", channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === "win32" ? "msedge" : "chromium"), viewport: { width: 1440, height: 1000 }, screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: [
    { command: "npm run dev", url: "http://127.0.0.1:5173", reuseExistingServer: !process.env.CI, timeout: 60000 },
    { command: "npm run server", env: { MATCH_STORAGE: "memory", LOG_LEVEL: "silent" }, port: 8787, reuseExistingServer: !process.env.CI, timeout: 60000 },
  ],
});
