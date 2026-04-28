import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

export interface AssertA11yOptions {
  /** CSS selector to scope the scan to. */
  include?: string;
  /** CSS selectors to exclude from scan. */
  exclude?: string[];
}

/**
 * Run axe-core accessibility scan and throw on violations.
 */
export async function assertA11y(page: Page, options: AssertA11yOptions = {}): Promise<void> {
  const builder = new AxeBuilder({ page });

  if (options.include !== undefined) {
    builder.include(options.include);
  }

  if (options.exclude !== undefined) {
    for (const selector of options.exclude) {
      builder.exclude(selector);
    }
  }

  const results = await builder.analyze();

  if (results.violations.length > 0) {
    const summary = results.violations
      .map((v) => {
        const nodes = v.nodes.map((n) => `    ${n.html}`).join('\n');
        return `  ${v.id} (${v.impact}): ${v.description}\n${nodes}`;
      })
      .join('\n\n');

    throw new Error(`${results.violations.length} accessibility violation(s):\n\n${summary}`);
  }
}
