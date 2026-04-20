const API_BASE = '**/api/v1';

/**
 * Declarative API mocking for Atlas Playwright tests.
 *
 * Intercepts fetch requests at the network level via page.route().
 * Must be called BEFORE page.goto() so routes are active from first request.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Object} config - Resource-keyed mock configuration
 * @param {Array<Object> | string} [config.pages] - Page data or error sentinel
 * @param {Function | Object | string} [config.intents] - Intent handler, data, or error sentinel
 *
 * Error sentinels: 'error-500', 'error-403', 'error-timeout'
 * Delay sentinel: 'delay-2000' (responds after 2s with empty array)
 */
export async function mockApi(page, config) {
  if (config.pages !== undefined) {
    await page.route(`${API_BASE}/pages`, async (route) => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }

      const response = resolveConfig(config.pages, []);
      if (response.delay) {
        await new Promise((r) => setTimeout(r, response.delay));
      }

      return route.fulfill({
        status: response.status,
        contentType: 'application/json',
        body: JSON.stringify(response.body),
      });
    });
  }

  if (config.intents !== undefined) {
    await page.route(`${API_BASE}/intents`, async (route) => {
      if (typeof config.intents === 'function') {
        return config.intents(route);
      }

      const response = resolveConfig(config.intents, { ok: true });
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
function resolveConfig(value, fallbackBody) {
  if (typeof value === 'string') {
    if (value === 'error-500') {
      return { status: 500, body: { error: 'internal_error', message: 'Internal Server Error' } };
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
