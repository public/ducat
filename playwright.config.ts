import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'test/browser',
  testMatch: '*.spec.ts',
  timeout: 120_000,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
