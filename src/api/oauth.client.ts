import type { APIRequestContext, APIResponse } from '@playwright/test';
import type { ClientCredential } from '../data/client-credentials';

export type AccessToken = { access_token: string; token_type: 'Bearer'; expires_in: number; scope: string };

export class OAuthClient {
  constructor(private readonly request: APIRequestContext) {}

  async clientCredentials(credentials: ClientCredential, scope?: string): Promise<APIResponse> {
    const headers = {
      Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };
    const form = new URLSearchParams({ grant_type: 'client_credentials', ...(scope ? { scope } : {}) });
    return this.request.post('/oauth/token', { headers, data: form.toString() });
  }
}
