import { test as base, expect as baseExpect } from '@playwright/test';

/**
 * Shape of a telemetry event emitted via `console.debug('[telemetry]', …)`.
 */
export interface TelemetryEvent {
  eventName: string;
  surfaceId?: string;
  [key: string]: unknown;
}

/**
 * Spy returned by the `telemetrySpy` fixture — captures telemetry events
 * forwarded through `console.debug`.
 */
export interface TelemetrySpy {
  events: TelemetryEvent[];
  clear(): void;
}

/**
 * Atlas-specific Playwright fixtures.
 */
export interface AtlasFixtures {
  telemetrySpy: TelemetrySpy;
}

/**
 * Extended Playwright test with Atlas-specific fixtures.
 *
 * Provides:
 * - telemetrySpy: captures console.debug('[telemetry]', ...) from AtlasElement.emit()
 */
export const test = base.extend<AtlasFixtures>({
  telemetrySpy: async ({ page }, use) => {
    const events: TelemetryEvent[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'debug') {
        const text = msg.text();
        if (text.startsWith('[telemetry]')) {
          // Second arg to console.debug is the telemetry object
          const argHandle = msg.args()[1];
          if (argHandle) {
            argHandle
              .jsonValue()
              .then((val: unknown) => {
                if (val && typeof val === 'object') {
                  events.push(val as TelemetryEvent);
                }
              })
              .catch(() => {
                // Browser context may be gone — ignore
              });
          }
        }
      }
    });

    const spy: TelemetrySpy = {
      events,
      clear() {
        events.length = 0;
      },
    };

    await use(spy);
  },
});

/**
 * Shape accepted by the `toHaveEmitted` matcher.
 */
export interface ToHaveEmittedShape {
  eventName: string;
  surfaceId?: string;
}

/**
 * Extended expect with Atlas-specific matchers.
 */
export const expect = baseExpect.extend({
  toHaveEmitted(spy: TelemetrySpy, expected: ToHaveEmittedShape) {
    const match = spy.events.find(
      (e) =>
        e.eventName === expected.eventName &&
        (expected.surfaceId === undefined || e.surfaceId === expected.surfaceId),
    );

    return {
      pass: !!match,
      message: () =>
        match
          ? `Expected telemetry NOT to have emitted ${JSON.stringify(expected)}`
          : `Expected telemetry to have emitted ${JSON.stringify(expected)} but received:\n${
              spy.events.map((e) => `  - ${e.eventName}`).join('\n') || '  (none)'
            }`,
      name: 'toHaveEmitted',
    };
  },
});
