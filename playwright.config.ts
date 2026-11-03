import 'dotenv/config';
import { defineConfig } from '@playwright/test';
import { environment } from './src/config/environment';
import { apiClients } from './src/data/client-credentials';
import type { FrameworkOptions } from './src/fixtures/test';

export default defineConfig<FrameworkOptions>({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['allure-playwright', {
      resultsDir: 'allure-results',
      environmentInfo: {
        test_environment: environment.name,
        node_version: process.version,
        operating_system: process.platform,
      },
    }],
  ],
  use: {
    baseURL: environment.baseURL,
    apiClients,
    trace: 'retain-on-failure',
  },
  webServer: environment.startsDemoServer ? {
    command: 'node demo/server.js',
    url: `${environment.baseURL}/health`,
    reuseExistingServer: false,
    timeout: 15_000,
    env: {
      PORT: String(environment.port),
      QA_CUSTOMER_CLIENT_ID: apiClients.customer.clientId,
      QA_CUSTOMER_CLIENT_SECRET: apiClients.customer.clientSecret,
      QA_ADJUSTER_CLIENT_ID: apiClients.adjuster.clientId,
      QA_ADJUSTER_CLIENT_SECRET: apiClients.adjuster.clientSecret,
    },
  } : undefined,
});
