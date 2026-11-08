const { defineConfig, devices } = require('@playwright/test');
const fs = require('node:fs');
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (process.platform === 'win32' && fs.existsSync(edgePath) ? edgePath : undefined);

module.exports = defineConfig({
  testDir: './tests/browser', timeout: 30000, expect: { timeout: 6000 },
  fullyParallel: false, workers: 1, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3018', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 }, launchOptions: { executablePath } } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], viewport: { width: 375, height: 812 }, launchOptions: { executablePath } } },
    ...(process.env.CROSS_BROWSER ? [
      { name: 'desktop-firefox', use: { ...devices['Desktop Firefox'] } },
      { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
    ] : []),
  ],
  webServer: { command: 'node tests/browser-server.cjs', url: 'http://127.0.0.1:3018/', reuseExistingServer: false, timeout: 20000 },
});
