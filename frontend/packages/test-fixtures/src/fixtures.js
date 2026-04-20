import { test as base, expect as baseExpect } from '@playwright/test';

/**
 * Extended Playwright test with Atlas-specific fixtures.
 *
 * Provides:
 * - telemetrySpy: captures console.debug('[telemetry]', ...) from AtlasElement.emit()
 */
export const test = base.extend({
  telemetrySpy: async ({ page }, use) => {
    const events = [];

    page.on('console', (msg) => {
      if (msg.type() === 'debug') {
        const text = msg.text();
        if (text.startsWith('[telemetry]')) {
          // Second arg to console.debug is the telemetry object
          const argHandle = msg.args()[1];
          if (argHandle) {
            argHandle.jsonValue().then((val) => {
              events.push(val);
            }).catch(() => {
              // Browser context may be gone — ignore
            });
          }
        }
      }
    });

    const spy = {
      events,
      clear() {
        events.length = 0;
      },
    };

    await use(spy);
  },
});

/**
 * Extended expect with Atlas-specific matchers.
 */
export const expect = baseExpect.extend({
  toHaveEmitted(spy, expected) {
    const match = spy.events.find((e) =>
      e.eventName === expected.eventName &&
      (expected.surfaceId === undefined || e.surfaceId === expected.surfaceId)
    );

    return {
      pass: !!match,
      message: () => match
        ? `Expected telemetry NOT to have emitted ${JSON.stringify(expected)}`
        : `Expected telemetry to have emitted ${JSON.stringify(expected)} but received:\n${spy.events.map((e) => `  - ${e.eventName}`).join('\n') || '  (none)'}`,
      name: 'toHaveEmitted',
    };
  },
});
