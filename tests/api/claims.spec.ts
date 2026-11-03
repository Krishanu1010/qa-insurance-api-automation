import claimSchema from '../../src/schemas/claim.schema.json';
import { assertSchema } from '../../src/api/response-schema';
import { expectStatus } from '../../src/api/assert-status';
import { newClaim, newIdempotencyKey } from '../../src/data/claim-factory';
import { newPolicy } from '../../src/data/policy-factory';
import { expect, test } from '../../src/fixtures/test';

test.describe('Claims API', () => {
  test('chains policy creation, claim submission, idempotent replay, and adjuster review @smoke', async ({ api }) => {
    const policyResponse = await api.customerPolicies.create(newPolicy({ coverageAmount: 50_000 }));
    await expectStatus(policyResponse, 201);
    const policy = await policyResponse.json();

    const claimInput = newClaim(policy.id);
    const idempotencyKey = newIdempotencyKey();
    const first = await api.customerClaims.submit(claimInput, idempotencyKey);
    await expectStatus(first, 201);
    const claim = await first.json();
    assertSchema(claimSchema, claim);
    expect(claim.policyId).toBe(policy.id);
    expect(first.headers()['idempotency-replayed']).toBe('false');

    const replay = await api.customerClaims.submit(claimInput, idempotencyKey);
    await expectStatus(replay, 200);
    expect(replay.headers()['idempotency-replayed']).toBe('true');
    expect(await replay.json()).toMatchObject({ id: claim.id });

    const conflict = await api.customerClaims.submit({ ...claimInput, claimedAmount: 600 }, idempotencyKey);
    expect(conflict.status()).toBe(409);
    expect((await conflict.json()).error.code).toBe('idempotency_conflict');

    const submittedClaim = await api.adjusterClaims.get(claim.id);
    expect(submittedClaim.status()).toBe(200);
    assertSchema(claimSchema, await submittedClaim.json());

    const underReview = await api.adjusterClaims.updateStatus(claim.id, 'under_review');
    expect(await underReview.json()).toMatchObject({ id: claim.id, status: 'under_review' });
    const approved = await api.adjusterClaims.updateStatus(claim.id, 'approved');
    expect(await approved.json()).toMatchObject({ id: claim.id, status: 'approved' });
    expect((await api.adjusterClaims.updateStatus(claim.id, 'rejected')).status()).toBe(409);
  });

  test('rejects claim data outside valid partitions and policy coverage', async ({ api }) => {
    const policyResponse = await api.customerPolicies.create(newPolicy({ coverageAmount: 5_000 }));
    const policy = await policyResponse.json();
    const cases = [
      { input: newClaim(policy.id, { claimedAmount: 0 }), status: 422 },
      { input: newClaim(policy.id, { claimedAmount: 5_001 }), status: 422 },
      { input: newClaim(policy.id, { description: 'short' }), status: 422 },
      { input: newClaim(policy.id, { incidentDate: '2026-02-31' }), status: 422 },
      { input: newClaim(policy.id, { incidentDate: '2025-12-31' }), status: 422 },
      { input: newClaim('POL-FFFFFFFF'), status: 422 },
    ];

    for (const [index, scenario] of cases.entries()) {
      const response = await api.customerClaims.submit(scenario.input, newIdempotencyKey(`invalid-claim-${index}`));
      expect(response.status()).toBe(scenario.status);
      expect((await response.json()).error.code).toBe('validation_error');
    }

    const missingIdempotencyKey = await api.customerClaims.submit(newClaim(policy.id), '');
    expect(missingIdempotencyKey.status()).toBe(400);
    expect((await missingIdempotencyKey.json()).error.code).toBe('idempotency_key_required');
  });

  test('enforces customer and adjuster permissions', async ({ api }) => {
    const policyResponse = await api.customerPolicies.create(newPolicy());
    const policy = await policyResponse.json();
    const submitted = await api.customerClaims.submit(newClaim(policy.id), newIdempotencyKey('role-claim'));
    const claim = await submitted.json();

    expect((await api.customerPolicies.delete(policy.id)).status()).toBe(409);
    expect((await api.adjusterPolicies.create(newPolicy())).status()).toBe(403);
    expect((await api.customerClaims.updateStatus(claim.id, 'approved')).status()).toBe(403);
    expect((await api.adjusterClaims.updateStatus(claim.id, 'under_review')).status()).toBe(200);
  });

  test('returns 429 with Retry-After when the isolated probe quota is exceeded', async ({ api }) => {
    const headers = { Authorization: `Bearer ${api.customerToken.access_token}` };
    expect((await api.request.get('/v1/rate-limit/probe', { headers })).status()).toBe(200);
    expect((await api.request.get('/v1/rate-limit/probe', { headers })).status()).toBe(200);
    const limited = await api.request.get('/v1/rate-limit/probe', { headers });
    expect(limited.status()).toBe(429);
    expect(limited.headers()['retry-after']).toBe('1');
    expect((await limited.json()).error.code).toBe('rate_limit_exceeded');
  });
});
