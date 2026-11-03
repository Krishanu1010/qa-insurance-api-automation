import type { APIResponse } from '@playwright/test';
import { expect, test } from '@playwright/test';

function redactBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as unknown;
    const redact = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(redact);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [
          key,
          /token|secret|password|authorization/i.test(key) ? '[REDACTED]' : redact(item),
        ]));
      }
      return value;
    };
    return JSON.stringify(redact(parsed), null, 2);
  } catch {
    return body.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]');
  }
}

/** Attach safe response diagnostics to the Playwright/Allure result only when status differs. */
export async function expectStatus(response: APIResponse, expectedStatus: number): Promise<void> {
  if (response.status() !== expectedStatus) {
    const headers = response.headers();
    const safeHeaders = Object.fromEntries(
      ['content-type', 'x-request-id', 'retry-after', 'location'].flatMap(name => headers[name] ? [[name, headers[name]]] : []),
    );
    const body = redactBody(await response.text());
    await test.info().attach('Unexpected API response', {
      body: Buffer.from(`HTTP ${response.status()}\n${JSON.stringify(safeHeaders, null, 2)}\n\n${body}`),
      contentType: 'text/plain',
    });
  }
  expect(response.status()).toBe(expectedStatus);
}
