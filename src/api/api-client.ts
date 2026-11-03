import type { APIRequestContext } from '@playwright/test';

export abstract class ApiClient {
  protected constructor(
    protected readonly request: APIRequestContext,
    private readonly accessToken: string,
  ) {}

  protected headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-Version': '1',
      ...extra,
    };
  }
}
