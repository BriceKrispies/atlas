/**
 * Playwright fixture composition for the IDB-backed BDD harness.
 *
 * What's provided:
 *   - `tenantId`             — unique per test, namespaces the IDB database
 *   - `principalId`          — derived from `tenantId` (default TenantAdmin)
 *   - `simPage`              — `page` after navigating to `apps/sim` and
 *                              waiting for `window.__atlas_ready === true`
 *   - `world`                — per-scenario scratchpad (see `world.ts`)
 *   - `reauthenticate`       — navigates `simPage` with a new principalId
 *                              (and optionally a new tenantId)
 *   - `mintAdditionalTenant` — boots a second tab on a fresh tenant for
 *                              cross-tenant scenarios (Invariant I7)
 *
 * Lazy: fixtures only initialize when a step references them. The legacy
 * `tests/bdd/features/example-domain/` smoke test never touches `simPage`,
 * so it never boots `apps/sim`.
 */
import type { Page } from '@playwright/test';
import { test as base } from 'playwright-bdd';
import { principalIdForRole } from './principal-roles.ts';
import { createWorld, type BddWorld } from './world.ts';
const SIM_BASE_URL = 'http://localhost:5182';
const READY_TIMEOUT_MS = 15000;
let counter = 0;
function uniqueTenantId(prefix: string): string {
    counter += 1;
    return `${prefix}-${counter}-${Date.now().toString(36)}`;
}
function buildSimUrl(tenantId: string, principalId: string): string {
    const url = new URL(SIM_BASE_URL);
    url.searchParams.set('tenantId', tenantId);
    url.searchParams.set('principalId', principalId);
    return url.toString();
}
async function waitForReady(page: Page): Promise<void> {
    await page.waitForFunction(function () {
        return window.__atlas_ready === true;
    }, undefined, {
        timeout: READY_TIMEOUT_MS,
    });
    // Surface any boot error captured in main.ts's catch block before we
    // hand the page to the test — otherwise the first probe call will
    // fail with a confusing "window.__atlas is undefined" instead of the
    // real exception.
    const bootError = await page.evaluate(function () {
        return window.__atlas_boot_error;
    });
    if (bootError) {
        throw new Error(`apps/sim boot failed:\n${bootError}`);
    }
}
async function deleteSimDb(page: Page, tenantId: string): Promise<void> {
    // Best-effort — if the page closed first (e.g., teardown order races)
    // we skip silently. The next test uses a fresh tenantId anyway.
    try {
        await page.evaluate(function (tid) {
            return new Promise<void>(function (resolve) {
                const req = indexedDB.deleteDatabase(`atlas-sim-${tid}`);
                req.onsuccess = function () {
                    return resolve();
                };
                req.onerror = function () {
                    return resolve();
                };
                req.onblocked = function () {
                    return resolve();
                };
            });
        }, tenantId);
    }
    catch {
        // page already closed — nothing to clean up.
    }
}
export interface AdditionalTenant {
    alias: string;
    tenantId: string;
    principalId: string;
    page: Page;
}
export interface SimFixtures {
    tenantId: string;
    principalId: string;
    simPage: Page;
    world: BddWorld;
    /**
     * Shared registry of every additional tenant the scenario has minted.
     * The `mintAdditionalTenant` fixture mutates this array as tenants are
     * created; the `After` hook in `hooks.ts` reads it to snapshot each
     * tenant's IndexedDB into the Playwright report.
     */
    mintedTenants: AdditionalTenant[];
    reauthenticate: (opts: {
        role?: string;
        tenantId?: string;
    }) => Promise<{
        tenantId: string;
        principalId: string;
    }>;
    mintAdditionalTenant: (opts: {
        alias: string;
        role?: string;
    }) => Promise<AdditionalTenant>;
}
export const test = base.extend<SimFixtures>({
    tenantId: async function ({}, use) {
        await use(uniqueTenantId('bdd'));
    },
    principalId: async function ({ tenantId }, use) {
        await use(principalIdForRole('TenantAdmin', tenantId));
    },
    simPage: async function ({ page, tenantId, principalId }, use) {
        await page.goto(buildSimUrl(tenantId, principalId));
        await waitForReady(page);
        await use(page);
        await deleteSimDb(page, tenantId);
    },
    world: async function ({}, use) {
        const w = createWorld();
        await use(w);
    },
    reauthenticate: async function ({ simPage, tenantId, principalId }, use) {
        let currentTenant = tenantId;
        let currentPrincipal = principalId;
        const fn: SimFixtures['reauthenticate'] = async function (opts) {
            const nextTenant = opts.tenantId ?? currentTenant;
            const nextPrincipal = opts.role
                ? principalIdForRole(opts.role, nextTenant)
                : currentPrincipal;
            await simPage.goto(buildSimUrl(nextTenant, nextPrincipal));
            await waitForReady(simPage);
            currentTenant = nextTenant;
            currentPrincipal = nextPrincipal;
            return { tenantId: nextTenant, principalId: nextPrincipal };
        };
        await use(fn);
    },
    mintedTenants: async function ({}, use) {
        const list: AdditionalTenant[] = [];
        await use(list);
    },
    mintAdditionalTenant: async function ({ context, world, mintedTenants }, use) {
        const fn: SimFixtures['mintAdditionalTenant'] = async function (opts) {
            const tenantId = uniqueTenantId(`bdd-${opts.alias}`);
            const principalId = principalIdForRole(opts.role ?? 'TenantAdmin', tenantId);
            const newPage = await context.newPage();
            await newPage.goto(buildSimUrl(tenantId, principalId));
            await waitForReady(newPage);
            const record: AdditionalTenant = { alias: opts.alias, tenantId, principalId, page: newPage };
            mintedTenants.push(record);
            world.tenantsByAlias.set(opts.alias, tenantId);
            return record;
        };
        await use(fn);
        for (const m of mintedTenants) {
            await deleteSimDb(m.page, m.tenantId);
            await m.page.close().catch(function () {
                return undefined;
            });
        }
    },
});
