import type { Page } from '@playwright/test';
import { After, AfterStep } from './fixtures.ts';
import { snapshot, type AtlasSnapshot } from './idb-probe.ts';
import { cleanupInviteRun, cleanupServerStackRun, openControlPlaneSql } from './server-stack.ts';
const screenshotMode = process.env['BDD_SCREENSHOT_MODE'] ?? 'on-failure';
const idbSnapshotMode = process.env['BDD_IDB_SNAPSHOT'] ?? 'on-failure';
// playwright-bdd hook callbacks take a single fixtures arg (see
// node_modules/playwright-bdd/dist/hooks/step.d.ts:17). testInfo lands as
// the auto-injected `$testInfo` fixture, not a second positional parameter.
AfterStep(async function ({ page, $step, $testInfo }) {
    if (screenshotMode !== 'always')
        return;
    const safeTitle = $step.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 80);
    const buf = await page.screenshot({ fullPage: true });
    // Unique attachment name per step. Date.now() is sufficient because two
    // AfterStep callbacks within a single test never run concurrently.
    await $testInfo.attach(`step-${Date.now()}-${safeTitle}`, {
        body: buf,
        contentType: 'image/png',
    });
});
// IDB snapshot dump — attaches the full IndexedDB contents (events,
// projections, cache, search docs, render trees, catalog state) for each
// tenant the scenario touched. Visible in the Playwright HTML report under
// the test's Attachments section.
//
// Mode controlled by `BDD_IDB_SNAPSHOT`:
//   - `on-failure` (default) — only when the scenario fails
//   - `always`              — every scenario
//   - `off`                 — disabled
//
// The hook is gated on the `@sim` tag so it only fires for scenarios that
// actually boot the harness. The legacy `tests/bdd/features/example-domain/`
// placeholder is untagged and therefore skipped — accessing `simPage` here
// would otherwise force-boot `apps/sim` for tests that don't need it.
After('@sim', async function ({ simPage, mintedTenants, world, $testInfo }) {
    if (idbSnapshotMode === 'off')
        return;
    if (idbSnapshotMode === 'on-failure' && $testInfo.status === 'passed')
        return;
    const tenants: Array<{
        alias: string;
        page: Page;
    }> = [];
    // Primary tenant first. We don't have its alias in a single canonical
    // place, so prefer `world.primaryTenantAlias` when set, fall back to a
    // generic label.
    tenants.push({
        alias: world.primaryTenantAlias ?? 'primary',
        page: simPage,
    });
    for (const t of mintedTenants) {
        tenants.push({ alias: t.alias, page: t.page });
    }
    for (const t of tenants) {
        let body: string;
        try {
            const dump: AtlasSnapshot = await snapshot(t.page);
            body = JSON.stringify(dump, null, 2);
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            body = JSON.stringify({ error: `failed to read IDB snapshot for tenant '${t.alias}'`, detail: message }, null, 2);
        }
        await $testInfo.attach(`idb-snapshot-${t.alias}.json`, {
            body,
            contentType: 'application/json',
        });
    }
});
// Row-level cleanup for `@server`-tagged scenarios that drive the real
// apps/server + Postgres stack. Mirrors the cleanup pattern in
// `tests/integration/public-signup.itest.ts` so reruns don't trip the
// unique index on `(email, tenant_slug)`. Gated on the tag (rather than
// `world.serverStack` truthiness) so a scenario that fails before the
// Given that initialises postgres still gets a no-op clean exit.
After('@server', async function ({ world }) {
    const ctx = world.serverStack;
    if (!ctx)
        return;
    const sql = await openControlPlaneSql();
    if (!sql)
        return;
    try {
        if (ctx.email && ctx.tenantSlug) {
            await cleanupServerStackRun(sql, {
                email: ctx.email,
                tenantSlug: ctx.tenantSlug,
            });
        }
        if (ctx.invite) {
            await cleanupInviteRun(sql, {
                tenantId: ctx.invite.tenantId,
                adminEmail: ctx.invite.adminEmail,
                inviteeEmail: ctx.invite.inviteeEmail,
            });
        }
    }
    finally {
        await sql.end({ timeout: 5 });
    }
});
