import policySchema from '../../src/schemas/policy.schema.json';
import { assertSchema } from '../../src/api/response-schema';
import { expectStatus } from '../../src/api/assert-status';
import { newPolicy } from '../../src/data/policy-factory';
import { expect, test } from '../../src/fixtures/test';

test.describe('Policy API', () => {
  test('creates, reads, replaces, patches, and deletes a policy @smoke', async ({ api }) => {
    const createResponse = await api.customerPolicies.create(newPolicy());
    await expectStatus(createResponse, 201);
    expect(createResponse.headers()['x-api-version']).toBe('1');
    expect(createResponse.headers()['location']).toMatch(/^\/v1\/policies\/POL-[A-F0-9]{8}$/);
    const created = await createResponse.json();
    assertSchema(policySchema, created);

    const readResponse = await api.customerPolicies.get(created.id);
    await expectStatus(readResponse, 200);
    expect(await readResponse.json()).toMatchObject({ id: created.id, status: 'active' });

    const replacement = newPolicy({ policyholderId: created.policyholderId, type: 'home', coverageAmount: 75_000 });
    const replaceResponse = await api.customerPolicies.replace(created.id, replacement);
    await expectStatus(replaceResponse, 200);
    const replaced = await replaceResponse.json();
    assertSchema(policySchema, replaced);
    expect(replaced).toMatchObject({ id: created.id, type: 'home', coverageAmount: 75_000 });

    const patchResponse = await api.customerPolicies.update(created.id, { coverageAmount: 80_000 });
    await expectStatus(patchResponse, 200);
    expect(await patchResponse.json()).toMatchObject({ id: created.id, coverageAmount: 80_000 });

    const deleteResponse = await api.customerPolicies.delete(created.id);
    await expectStatus(deleteResponse, 204);
    expect((await api.customerPolicies.get(created.id)).status()).toBe(404);
  });

  test('accepts exact coverage boundaries and rejects values outside them', async ({ api }) => {
    for (const [amount, expectedStatus] of [[1_000, 201], [1_000_000, 201], [999.99, 422], [1_000_001, 422]] as const) {
      const response = await api.customerPolicies.create(newPolicy({ coverageAmount: amount }));
      expect(response.status(), `coverageAmount ${amount}`).toBe(expectedStatus);
      if (expectedStatus === 201) assertSchema(policySchema, await response.json());
      else expect((await response.json()).error.code).toBe('validation_error');
    }
  });

  const invalidPolicies = [
    { name: 'missing policyholder identifier', data: { type: 'auto', effectiveDate: '2026-01-01', coverageAmount: 10_000 } },
    { name: 'unsupported policy type', data: { ...newPolicy(), type: 'travel' } },
    { name: 'invalid calendar date', data: newPolicy({ effectiveDate: '2026-02-31' }) },
    { name: 'unexpected property', data: { ...newPolicy(), internalStatus: 'approved' } },
  ];

  for (const scenario of invalidPolicies) {
    test(`rejects ${scenario.name}`, async ({ api }) => {
      const response = await api.request.post('/v1/policies', {
        headers: { Authorization: `Bearer ${api.customerToken.access_token}`, 'Content-Type': 'application/json' },
        data: scenario.data,
      });
      expect(response.status()).toBe(422);
      expect((await response.json()).error).toMatchObject({ code: 'validation_error', requestId: expect.any(String) });
      expect(response.headers()['x-request-id']).toBeTruthy();
    });
  }

  test('filters and paginates the policy collection, rejecting invalid page sizes', async ({ api }) => {
    await api.customerPolicies.create(newPolicy());
    await api.customerPolicies.create(newPolicy());

    const page = await api.customerPolicies.list({ page: 1, pageSize: 1, status: 'active' });
    expect(page.status()).toBe(200);
    const body = await page.json();
    expect(body.items).toHaveLength(1);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(1);
    expect(body.total).toBeGreaterThanOrEqual(2);

    expect((await api.customerPolicies.list({ pageSize: 21 })).status()).toBe(400);
    expect((await api.customerPolicies.list({ page: 0 })).status()).toBe(400);
    expect((await api.customerPolicies.list({ status: 'expired' })).status()).toBe(400);
  });

  test('requires bearer authentication and checks OAuth client scopes', async ({ api, apiClients }) => {
    expect(api.customerToken.token_type).toBe('Bearer');
    expect(api.customerToken.expires_in).toBeGreaterThan(0);
    expect(api.customerToken.scope.split(' ')).toContain('claims:submit');
    expect(api.adjusterToken.scope.split(' ')).toContain('claims:adjust');
    expect((await api.request.get('/v1/policies')).status()).toBe(401);
    const insufficientScope = await api.oauth.clientCredentials(apiClients.customer, 'claims:adjust');
    expect(insufficientScope.status()).toBe(400);
    expect((await insufficientScope.json()).error.code).toBe('invalid_scope');

    const wrongSecret = await api.oauth.clientCredentials({ ...apiClients.customer, clientSecret: 'incorrect-secret' });
    expect(wrongSecret.status()).toBe(401);
    expect(wrongSecret.headers()['www-authenticate']).toContain('Basic');

    const malformedJson = await api.request.post('/v1/policies', {
      headers: { Authorization: `Bearer ${api.customerToken.access_token}`, 'Content-Type': 'application/json' },
      data: Buffer.from('{'),
    });
    expect(malformedJson.status()).toBe(400);
    expect((await malformedJson.json()).error.code).toBe('invalid_json');
  });

  test('returns protocol metadata and a scoped region cookie', async ({ api }) => {
    const response = await api.request.get('/v1/metadata', {
      headers: { Authorization: `Bearer ${api.customerToken.access_token}`, 'X-Request-Id': 'portfolio-check-001' },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()['x-request-id']).toBe('portfolio-check-001');
    expect(response.headers()['set-cookie']).toContain('northstar-region=global');
    expect(response.headers()['set-cookie']).toContain('HttpOnly');
  });
});
