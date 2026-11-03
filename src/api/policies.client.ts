import type { APIResponse } from '@playwright/test';
import { ApiClient } from './api-client';
import type { CreatePolicyInput } from '../data/policy-factory';

export class PoliciesClient extends ApiClient {
  constructor(request: import('@playwright/test').APIRequestContext, accessToken: string) {
    super(request, accessToken);
  }

  async create(input: CreatePolicyInput): Promise<APIResponse> {
    return this.request.post('/v1/policies', { headers: this.headers(), data: input });
  }

  async list(query: { page?: number; pageSize?: number; status?: string } = {}): Promise<APIResponse> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
    return this.request.get(`/v1/policies${params.size ? `?${params}` : ''}`, { headers: this.headers() });
  }

  async get(id: string): Promise<APIResponse> {
    return this.request.get(`/v1/policies/${encodeURIComponent(id)}`, { headers: this.headers() });
  }

  async replace(id: string, input: CreatePolicyInput): Promise<APIResponse> {
    return this.request.put(`/v1/policies/${encodeURIComponent(id)}`, { headers: this.headers(), data: input });
  }

  async update(id: string, patch: Partial<Pick<CreatePolicyInput, 'coverageAmount'>> & { status?: 'active' | 'cancelled' }): Promise<APIResponse> {
    return this.request.patch(`/v1/policies/${encodeURIComponent(id)}`, { headers: this.headers(), data: patch });
  }

  async delete(id: string): Promise<APIResponse> {
    return this.request.delete(`/v1/policies/${encodeURIComponent(id)}`, { headers: this.headers() });
  }
}
