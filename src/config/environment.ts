export type TestEnvironment = 'local' | 'ci' | 'staging';

const configuredEnvironment = process.env.TEST_ENV ?? (process.env.CI ? 'ci' : 'local');
const supportedEnvironments: TestEnvironment[] = ['local', 'ci', 'staging'];

if (!supportedEnvironments.includes(configuredEnvironment as TestEnvironment)) {
  throw new Error(`Unsupported TEST_ENV "${configuredEnvironment}". Choose local, ci, or staging.`);
}

const name = configuredEnvironment as TestEnvironment;
const configuredPort = process.env.PORT?.trim() || '4180';
if (!/^\d+$/.test(configuredPort) || Number(configuredPort) < 1 || Number(configuredPort) > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}
const port = Number(configuredPort);
const localBaseURL = `http://127.0.0.1:${port}`;
const configuredBaseURL = process.env.BASE_URL?.trim();
const baseURL = configuredBaseURL || (name === 'staging' ? undefined : localBaseURL);

if (!baseURL) throw new Error('BASE_URL is required when TEST_ENV=staging.');

let parsedBaseUrl: URL;
try {
  parsedBaseUrl = new URL(baseURL);
} catch {
  throw new Error('BASE_URL must be an absolute URL.');
}

if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) {
  throw new Error('BASE_URL must use HTTP or HTTPS.');
}

if (name !== 'staging' && parsedBaseUrl.toString().replace(/\/$/, '') !== localBaseURL) {
  throw new Error(`The ${name} environment starts the local demo at ${localBaseURL}; use TEST_ENV=staging for an external target.`);
}

export const environment = {
  name,
  port,
  baseURL: parsedBaseUrl.toString().replace(/\/$/, ''),
  startsDemoServer: name !== 'staging',
} as const;
