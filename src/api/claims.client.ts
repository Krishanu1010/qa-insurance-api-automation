import type { APIResponse } from '@playwright/test';
import type { CreateClaimInput } from '../data/claim-factory';
import { ApiClient } from './api-client';

export class ClaimsClient extends ApiClient {
  constructor(request: import('@playwright/test').APIRequestContext, accessToken: string) {
    super(request, accessToken);
  }

  async submit(input: CreateClaimInput, idempotencyKey: string): Promise<APIResponse> {
    return this.request.post('/v1/claims', {
      headers: this.headers({ 'Idempotency-Key': idempotencyKey }),
      data: input,
    });
  }

  async get(id: string): Promise<APIResponse> {
    return this.request.get(`/v1/claims/${encodeURIComponent(id)}`, { headers: this.headers() });
  }

  async updateStatus(id: string, status: 'under_review' | 'approved' | 'rejected'): Promise<APIResponse> {
    return this.request.patch(`/v1/claims/${encodeURIComponent(id)}`, {
      headers: this.headers(),
      data: { status },
    });
  }
}
