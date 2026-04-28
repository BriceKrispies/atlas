import type { Page, Route } from '@playwright/test';

const API_BASE = '**/api/v1';

/** Error sentinels recognised by `resolveConfig`. */
export type ErrorSentinel = 'error-500' | 'error-403' | 'error-timeout';

/** Delay sentinel, e.g. `delay-2000` — respond after 2s with fallback body. */
export type DelaySentinel = `delay-${number}`;

export type MockValue<T> = T | ErrorSentinel | DelaySentinel;

/** Route handler signature for intent mocks. */
export type IntentRouteHandler = (route: Route) => unknown | Promise<unknown>;

export interface MockApiConfig {
  /** Page data or error sentinel. */
  pages?: MockValue<unknown[]>;
  /** Intent handler, data, or error sentinel. */
  intents?: IntentRouteHandler | MockValue<unknown>;
}

interface ResolvedResponse {
  status: number;
  body: unknown;
  delay?: number;
}

/**
 * Declarative API mocking for Atlas Playwright tests.
 *
 * Intercepts fetch requests at the network level via page.route().
 * Must be called BEFORE page.goto() so routes are active from first request.
 *
 * Error sentinels: 'error-500', 'error-403', 'error-timeout'
 * Delay sentinel: 'delay-2000' (responds after 2s with empty array)
 */
export async function mockApi(page: Page, config: MockApiConfig): Promise<void> {
  if (config.pages !== undefined) {
    const pagesConfig = config.pages;
    await page.route(`${API_BASE}/pages`, async (route) => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }

      const response = resolveConfig(pagesConfig, []);
      if (response.delay !== undefined) {
        await new Promise<void>((r) => setTimeout(r, response.delay));
      }

      return route.fulfill({
        status: response.status,
        contentType: 'application/json',
        body: JSON.stringify(response.body),
      });
    });
  }

  if (config.intents !== undefined) {
    const intentsConfig = config.intents;
    await page.route(`${API_BASE}/intents`, async (route) => {
      if (typeof intentsConfig === 'function') {
        return intentsConfig(route);
      }

      const response = resolveConfig(intentsConfig, { ok: true });
      return route.fulfill({
        status: response.status,
        contentType: 'application/json',
        body: JSON.stringify(response.body),
      });
    });
  }
}

/**
 * Resolve a config value into { status, body, delay }.
 * Handles error sentinels, delay sentinels, and raw data.
 */
function resolveConfig(value: unknown, fallbackBody: unknown): ResolvedResponse {
  if (typeof value === 'string') {
    if (value === 'error-500') {
      return {
        status: 500,
        body: { error: 'internal_error', message: 'Internal Server Error' },
      };
    }
    if (value === 'error-403') {
      return { status: 403, body: { error: 'forbidden', message: 'Access denied' } };
    }
    if (value === 'error-timeout') {
      return { status: 504, body: { error: 'timeout', message: 'Gateway Timeout' } };
    }
    if (value.startsWith('delay-')) {
      const ms = parseInt(value.replace('delay-', ''), 10);
      return { status: 200, body: fallbackBody, delay: ms };
    }
  }

  return { status: 200, body: value };
}
