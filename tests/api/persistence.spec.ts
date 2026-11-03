import { readClaimRow, readPolicyRow } from '../../src/database/sqlite-validation';
import { newClaim, newIdempotencyKey } from '../../src/data/claim-factory';
import { newPolicy } from '../../src/data/policy-factory';
import { environment } from '../../src/config/environment';
import { expect, test } from '../../src/fixtures/test';

test.describe('API persistence mapping', () => {
  test.skip(environment.name === 'staging', 'The read-only SQLite check applies to the included local demo target.');

  test('persists policy and claim API writes with the expected relational links', async ({ api }) => {
    const policyResponse = await api.customerPolicies.create(newPolicy({ coverageAmount: 42_000 }));
    expect(policyResponse.status()).toBe(201);
    const policy = await policyResponse.json();

    const policyRow = await readPolicyRow(policy.id);
    expect(policyRow).toMatchObject({
      id: policy.id,
      policyholder_id: policy.policyholderId,
      type: policy.type,
      status: 'active',
      coverage_amount: 42_000,
    });

    const claimResponse = await api.customerClaims.submit(newClaim(policy.id), newIdempotencyKey('db-claim'));
    expect(claimResponse.status()).toBe(201);
    const claim = await claimResponse.json();
    const claimRow = await readClaimRow(claim.id);
    expect(claimRow).toMatchObject({
      id: claim.id,
      policy_id: policy.id,
      status: 'submitted',
      claimed_amount: claim.claimedAmount,
    });
  });
});
