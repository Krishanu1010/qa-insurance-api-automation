import { randomBytes } from 'node:crypto';
import { environment } from '../config/environment';

export type ClientCredential = { clientId: string; clientSecret: string };
export type ApiClients = { customer: ClientCredential; adjuster: ClientCredential };

function resolveClient(prefix: 'CUSTOMER' | 'ADJUSTER'): ClientCredential {
  const idName = `QA_${prefix}_CLIENT_ID`;
  const configuredId = process.env[idName]?.trim();
  if (environment.name === 'staging' && !configuredId) throw new Error(`${idName} must be configured for staging.`);
  const clientId = configuredId || `northstar-${prefix.toLowerCase()}-test`;
  const secretName = `QA_${prefix}_CLIENT_SECRET`;
  const configuredSecret = process.env[secretName]?.trim();
  if (configuredSecret) return { clientId, clientSecret: configuredSecret };
  if (environment.name === 'staging') throw new Error(`${secretName} must be configured for staging.`);
  const generatedSecret = randomBytes(32).toString('base64url');
  // Keep config, webServer, and worker processes on the same ephemeral local credential.
  process.env[secretName] = generatedSecret;
  return { clientId, clientSecret: generatedSecret };
}

export const apiClients: ApiClients = {
  customer: resolveClient('CUSTOMER'),
  adjuster: resolveClient('ADJUSTER'),
};
