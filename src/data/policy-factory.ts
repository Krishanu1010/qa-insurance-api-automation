import { randomUUID } from 'node:crypto';

export type PolicyType = 'auto' | 'home' | 'life';
export type CreatePolicyInput = {
  policyholderId: string;
  type: PolicyType;
  effectiveDate: string;
  coverageAmount: number;
};

export function newPolicy(overrides: Partial<CreatePolicyInput> = {}): CreatePolicyInput {
  return {
    policyholderId: `PH-${randomUUID()}`,
    type: 'auto',
    effectiveDate: '2026-01-01',
    coverageAmount: 25_000,
    ...overrides,
  };
}
