import { randomUUID } from 'node:crypto';

export type CreateClaimInput = {
  policyId: string;
  incidentDate: string;
  description: string;
  claimedAmount: number;
};

export function newIdempotencyKey(prefix = 'claim'): string {
  return `${prefix}-${randomUUID()}`;
}

export function newClaim(policyId: string, overrides: Partial<CreateClaimInput> = {}): CreateClaimInput {
  return {
    policyId,
    incidentDate: '2026-02-01',
    description: `Synthetic claim ${randomUUID()}`,
    claimedAmount: 500,
    ...overrides,
  };
}
