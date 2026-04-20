const PRINCIPALS = {
  'tenant-admin': 'user:admin:tenant-001',
  'portal-user': 'user:portal:tenant-001',
  'no-permissions': 'user:none:tenant-001',
};

/**
 * Simulate authentication for a given role.
 *
 * Sets X-Debug-Principal header on all requests from this page.
 * Currently a thin wrapper — when real auth is implemented, this
 * will set cookies/tokens instead.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'tenant-admin' | 'portal-user' | 'no-permissions'} role
 */
export async function loginAs(page, role) {
  const principal = PRINCIPALS[role];
  if (!principal) {
    throw new Error(`Unknown role: "${role}". Available: ${Object.keys(PRINCIPALS).join(', ')}`);
  }

  await page.setExtraHTTPHeaders({
    'X-Debug-Principal': principal,
  });
}
