import { test as base, expect, type APIRequestContext } from '@playwright/test';
import type { ApiClients } from '../data/client-credentials';
import { OAuthClient, type AccessToken } from '../api/oauth.client';
import { PoliciesClient } from '../api/policies.client';
import { ClaimsClient } from '../api/claims.client';

export type ApiSuite = {
  request: APIRequestContext;
  oauth: OAuthClient;
  customerToken: AccessToken;
  adjusterToken: AccessToken;
  customerPolicies: PoliciesClient;
  customerClaims: ClaimsClient;
  adjusterPolicies: PoliciesClient;
  adjusterClaims: ClaimsClient;
};

export type FrameworkOptions = { apiClients: ApiClients };

export const test = base.extend<FrameworkOptions & { api: ApiSuite }>({
  apiClients: [{ customer: { clientId: '', clientSecret: '' }, adjuster: { clientId: '', clientSecret: '' } }, { option: true }],
  api: async ({ playwright, baseURL, apiClients }, use) => {
    if (!baseURL) throw new Error('A baseURL must be configured to create the API test context.');
    const request = await playwright.request.newContext({ baseURL });
    try {
      const oauth = new OAuthClient(request);
      const [customerResponse, adjusterResponse] = await Promise.all([
        oauth.clientCredentials(apiClients.customer),
        oauth.clientCredentials(apiClients.adjuster),
      ]);
      if (!customerResponse.ok() || !adjusterResponse.ok()) {
        const [customerError, adjusterError] = await Promise.all([customerResponse.json(), adjusterResponse.json()]);
        throw new Error(`OAuth fixture setup failed (customer ${customerResponse.status()}: ${customerError.error?.code}, adjuster ${adjusterResponse.status()}: ${adjusterError.error?.code}).`);
      }
      const customerToken = await customerResponse.json() as AccessToken;
      const adjusterToken = await adjusterResponse.json() as AccessToken;
      await use({
        request,
        oauth,
        customerToken,
        adjusterToken,
        customerPolicies: new PoliciesClient(request, customerToken.access_token),
        customerClaims: new ClaimsClient(request, customerToken.access_token),
        adjusterPolicies: new PoliciesClient(request, adjusterToken.access_token),
        adjusterClaims: new ClaimsClient(request, adjusterToken.access_token),
      });
    } finally {
      await request.dispose();
    }
  },
});

export { expect };
