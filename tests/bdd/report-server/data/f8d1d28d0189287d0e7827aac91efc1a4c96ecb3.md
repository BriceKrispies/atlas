# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests\bdd\features\identity\tenant-admin-invites-user\admin-invites-user-and-user-logs-in.feature.spec.js >> Tenant admin invites a user and the new user logs in with a real password >> tenant admin invites a viewer, viewer sets a password, viewer logs in
- Location: .features-gen\bdd-server\tests\bdd\features\identity\tenant-admin-invites-user\admin-invites-user-and-user-logs-in.feature.spec.js:13:3

# Error details

```
TimeoutError: page.waitForFunction: Timeout 10000ms exceeded.
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - text: Welcome to
    - strong [ref=e3]: BDD Acme
  - paragraph [ref=e4]: Not signed in.
  - list [ref=e5]:
    - listitem [ref=e6]:
      - link "My sessions (JSON)" [ref=e7] [cursor=pointer]:
        - /url: /api/v1/identity/sessions
    - listitem [ref=e8]:
      - link "Sign out" [ref=e9] [cursor=pointer]:
        - /url: /api/v1/identity/session/logout
```

# Test source

```ts
  617 |   // → poll throws → we catch and pass.
  618 |   const ctx = assertDefined(world.serverStack, 'world.serverStack initialised');
  619 |   const outsider = (ctx as unknown as { outsiderEmail?: string }).outsiderEmail;
  620 |   if (!outsider) {
  621 |     expect(count).toBe(0);
  622 |     return;
  623 |   }
  624 |   if (count === 0) {
  625 |     try {
  626 |       await pollSmtp4DevFor(outsider, { timeoutMs: 2_000 });
  627 |       throw new Error(`smtp4dev unexpectedly received a message for ${outsider}`);
  628 |     } catch {
  629 |       // expected — no email arrived
  630 |     }
  631 |   } else {
  632 |     const messages = await pollSmtp4DevFor(outsider, { timeoutMs: SMTP4DEV_TIMEOUT_MS });
  633 |     expect(messages.length).toBe(count);
  634 |   }
  635 | });
  636 | 
  637 | // ─────────────────────────────────────────────────────────────────────
  638 | // Helpers
  639 | // ─────────────────────────────────────────────────────────────────────
  640 | 
  641 | function makeEmptyServerStack(): import('../../../support/world.ts').ServerStackContext {
  642 |   return {
  643 |     runId: newRunId(),
  644 |     email: '',
  645 |     tenantSlug: '',
  646 |     organizationName: '',
  647 |     correlationId: newCorrelationId(),
  648 |     signupId: null,
  649 |     tenantId: null,
  650 |     hasPostgres: false,
  651 |   };
  652 | }
  653 | 
  654 | async function seedTenantAdmin(
  655 |   request: import('@playwright/test').APIRequestContext,
  656 |   ctx: import('../../../support/world.ts').ServerStackContext,
  657 | ): Promise<void> {
  658 |   const invite = assertDefined(ctx.invite, 'invite context initialised');
  659 |   // Seed under platform-admin via real intents. Errors are tolerated —
  660 |   // a prior run may have already populated these rows.
  661 |   const ts = (action: string, payload: Record<string, unknown>) => ({
  662 |     eventId: `evt-${newRunId()}`,
  663 |     eventType: `${(action.split('.').slice(0, 2).join('.'))}${(action.split('.')[2] ?? '')}Requested`,
  664 |     schemaId: `${action.toLowerCase().replace(/\./g, '.')}.v1`,
  665 |     schemaVersion: 1,
  666 |     occurredAt: new Date().toISOString(),
  667 |     tenantId: invite.tenantId,
  668 |     correlationId: ctx.correlationId,
  669 |     idempotencyKey: `bdd-seed-${action}-${invite.adminUserId}`,
  670 |     payload: { actionId: action, ...payload },
  671 |   });
  672 |   // We use the tenant-add-admin script's underlying intent calls. Each
  673 |   // step is best-effort.
  674 |   const post = async function (action: string, payload: Record<string, unknown>): Promise<void> {
  675 |     try {
  676 |       await request.post('/api/v1/intents', {
  677 |         headers: {
  678 |           'Content-Type': 'application/json',
  679 |           'X-Debug-Principal': PLATFORM_ADMIN_DEBUG_PRINCIPAL,
  680 |           'X-Correlation-Id': ctx.correlationId,
  681 |         },
  682 |         data: ts(action, payload),
  683 |       });
  684 |     } catch {
  685 |       // best-effort
  686 |     }
  687 |   };
  688 |   await post('Identity.User.Create', {
  689 |     resourceType: 'User',
  690 |     email: invite.adminEmail,
  691 |     userId: invite.adminUserId,
  692 |   });
  693 |   await post('Identity.Membership.Create', {
  694 |     resourceType: 'Membership',
  695 |     userId: invite.adminUserId,
  696 |     roles: ['TenantAdmin'],
  697 |   });
  698 |   await post('Identity.User.SetPassword', {
  699 |     resourceType: 'User',
  700 |     userId: invite.adminUserId,
  701 |     newPassword: invite.adminPassword,
  702 |   });
  703 | }
  704 | 
  705 | interface SurfaceSnapshot {
  706 |   state?: string;
  707 |   surfaceId?: string;
  708 |   data?: unknown;
  709 |   actions?: unknown;
  710 | }
  711 | 
  712 | async function waitForSurface(
  713 |   page: import('@playwright/test').Page,
  714 |   surfaceId: string,
  715 |   timeoutMs = 10_000,
  716 | ): Promise<void> {
> 717 |   await page.waitForFunction(
      |              ^ TimeoutError: page.waitForFunction: Timeout 10000ms exceeded.
  718 |     function (id: string): boolean {
  719 |       return Boolean(
  720 |         (window as unknown as { __atlasTest?: { keys(): string[] } }).__atlasTest?.keys().includes(id),
  721 |       );
  722 |     },
  723 |     surfaceId,
  724 |     { timeout: timeoutMs },
  725 |   );
  726 | }
  727 | 
  728 | async function getSurfaceSnapshot(
  729 |   page: import('@playwright/test').Page,
  730 |   surfaceId: string,
  731 | ): Promise<SurfaceSnapshot> {
  732 |   return page.evaluate(function (id: string): SurfaceSnapshot {
  733 |     const api = (window as unknown as {
  734 |       __atlasTest?: { getState(): Record<string, unknown> };
  735 |     }).__atlasTest;
  736 |     if (!api) return {};
  737 |     const all = api.getState();
  738 |     const snap = all[id];
  739 |     return (snap as SurfaceSnapshot) ?? {};
  740 |   }, surfaceId);
  741 | }
  742 | 
  743 | async function expectSurfaceState(
  744 |   page: import('@playwright/test').Page,
  745 |   surfaceId: string,
  746 |   expected: string,
  747 |   timeoutMs: number,
  748 | ): Promise<void> {
  749 |   await page.waitForFunction(
  750 |     function (args: { id: string; want: string }): boolean {
  751 |       const api = (window as unknown as {
  752 |         __atlasTest?: { getState(): Record<string, unknown> };
  753 |       }).__atlasTest;
  754 |       if (!api) return false;
  755 |       const snap = api.getState()[args.id] as { state?: string } | undefined;
  756 |       return snap?.state === args.want;
  757 |     },
  758 |     { id: surfaceId, want: expected },
  759 |     { timeout: timeoutMs },
  760 |   );
  761 | }
  762 | 
  763 | async function typeInto(
  764 |   page: import('@playwright/test').Page,
  765 |   selector: string,
  766 |   value: string,
  767 | ): Promise<void> {
  768 |   // atlas-input wraps a native input; locate the inner input via DOM.
  769 |   await page.locator(selector).first().evaluate((el: Element, v: string) => {
  770 |     const input = (el as HTMLElement).querySelector('input');
  771 |     if (input) {
  772 |       input.value = v;
  773 |       input.dispatchEvent(new Event('input', { bubbles: true }));
  774 |       input.dispatchEvent(new Event('change', { bubbles: true }));
  775 |     } else {
  776 |       // Surface element may itself accept the value
  777 |       (el as HTMLInputElement & { value?: string }).value = v;
  778 |       el.dispatchEvent(new Event('input', { bubbles: true }));
  779 |     }
  780 |   }, value);
  781 | }
  782 | 
  783 | async function clickByName(
  784 |   page: import('@playwright/test').Page,
  785 |   name: string,
  786 | ): Promise<void> {
  787 |   await page.locator(`atlas-button[name="${name}"]`).first().click();
  788 | }
  789 | 
```