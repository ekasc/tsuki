import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
  },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 3100',
    port: 3100,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit-iphone15pro',
      use: {
        ...devices['iPhone 15 Pro'],
        colorScheme: 'light',
      },
    },
    {
      name: 'chromium-galaxys24',
      use: {
        ...devices['Galaxy S24'],
        colorScheme: 'light',
      },
    },
    {
      name: 'webkit-ipadpro11',
      use: {
        ...devices['iPad Pro 11'],
        colorScheme: 'light',
      },
    },
  ],
})
