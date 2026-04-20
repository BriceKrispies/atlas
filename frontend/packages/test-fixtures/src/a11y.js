import AxeBuilder from '@axe-core/playwright';

/**
 * Run axe-core accessibility scan and throw on violations.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Object} [options]
 * @param {string} [options.include] - CSS selector to scope the scan to
 * @param {string[]} [options.exclude] - CSS selectors to exclude from scan
 */
export async function assertA11y(page, options = {}) {
  const builder = new AxeBuilder({ page });

  if (options.include) {
    builder.include(options.include);
  }

  if (options.exclude) {
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
