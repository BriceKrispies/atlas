# ADR-001: Four Frontends on a Shared Platform

**Status:** Accepted
**Date:** 2026-04-14
**Decision makers:** Platform architecture team

## Context

Atlas is a multi-tenant enterprise CMS + workflow platform. It needs to serve four distinct audiences:

1. **Tenant administrators** — configure modules, manage content, users, policies
2. **End users** — consume content, earn badges, view points, receive announcements
3. **Unauthenticated visitors** — view published public pages and media
4. **Platform operators** — manage tenants, bundles, schemas, platform-wide configuration

Each audience has different:
- Security postures (no auth vs. OIDC vs. OIDC + MFA)
- Feature sets (CRUD admin vs. read-heavy portal vs. minimal renderer)
- Deployment constraints (CDN-friendly public renderer vs. auth-gated admin)
- Change velocity (admin gets new features with every module; public renderer is stable)

We need to decide how to organize the frontend code.

## Decision

Atlas will implement **4 separate frontend applications** built on top of a **shared frontend platform layer**.

### The 4 Applications

| App | Package | Audience |
|-----|---------|----------|
| Admin Console | `@atlas/admin` | Tenant administrators |
| Portal | `@atlas/portal` | End users |
| Public Renderer | `@atlas/public` | Unauthenticated visitors |
| Platform Control | `@atlas/platform-control` | Platform operators |

### The Shared Platform

All 4 apps depend on a set of shared packages that provide:

- Component system (`@atlas/core`) — tagged template rendering, signals reactivity, router, data fetching
- Design system (`@atlas/design`) — tokens, primitives, layouts (built on `@atlas/core`)
- Surface contracts (`@atlas/contracts`) — shape definitions for surface specs
- Telemetry (`@atlas/telemetry`) — event emission, correlation ID propagation
- Test IDs (`@atlas/test-ids`) — `testId()` helper, naming convention enforcement
- Test fixtures (`@atlas/test-fixtures`) — Playwright helpers, mock API, auth simulation
- Auth (`@atlas/auth`) — OIDC client, session, role guards
- API client (`@atlas/api-client`) — typed HTTP client with tenant context
- Accessibility (`@atlas/a11y`) — live region announcer, focus management, skip links
- Error handling (`@atlas/errors`) — error boundaries, error state components
- Loading (`@atlas/loading`) — skeletons, spinners
- Shell (`@atlas/shell`) — app shell primitives, breadcrumbs, nav items

## Alternatives Considered

### Alternative A: One Monolithic Frontend

A single SPA that serves all 4 audiences with route-based access control.

**Pros:**
- Simplest initial setup
- Maximum code sharing (it's all one app)
- One build, one deploy

**Cons:**
- **Bundle size:** Admin users download portal code; public visitors download everything. The admin console alone will be substantial (8 module editors); forcing portal users to download it is wasteful.
- **Security surface:** A single app means a vulnerability in the public renderer can potentially be leveraged to access admin functionality. Separate apps have separate attack surfaces.
- **Deployment coupling:** Changing the admin badge editor requires redeploying the public renderer. With 4 separate apps, each deploys independently.
- **Auth complexity:** One app must handle no-auth (public), standard auth (portal), admin auth, and elevated auth (platform control) — with careful UI gating at every level.
- **Change velocity:** The admin console will change frequently as modules are built. The public renderer will be stable. Coupling them means the stable app is redeployed for every admin change.

**Verdict:** Rejected. The coupling costs exceed the simplicity benefits at Atlas's scale.

### Alternative B: Fully Isolated Frontends

Four completely independent frontends with no shared code. Each has its own design system, auth library, API client, and test infrastructure.

**Pros:**
- Maximum independence
- Teams can make different technology choices
- No coordination overhead

**Cons:**
- **Drift:** Without shared design tokens, the admin console and portal will look like different products within months.
- **Duplicated correctness:** Auth, telemetry, error handling, and accessibility patterns must be implemented correctly 4 times. If a telemetry bug is found, it must be fixed in 4 codebases.
- **Inconsistent testing:** Without shared Playwright fixtures, each app invents its own testing patterns. Test quality diverges.
- **Onboarding cost:** A developer (or AI agent) working across apps must learn 4 different conventions.
- **Maintenance burden:** 4 separate copies of OIDC integration, 4 separate API clients, 4 separate error normalization layers.

**Verdict:** Rejected. The duplication and drift costs are unacceptable for a platform product.

### Alternative C (Chosen): Shared Platform, Separate Apps

Four separate applications that share a common platform layer. The platform layer provides infrastructure (design, auth, telemetry, testing). The apps provide domain-specific features.

**Pros:**
- **Correct boundaries:** Each app owns its own routing, shell, and features. No cross-app coupling at the feature level.
- **Shared correctness:** Auth, telemetry, accessibility, and testing are implemented once and shared. A fix in `@atlas/telemetry` benefits all 4 apps.
- **Independent deployment:** Each app has its own build and deploy pipeline.
- **Consistent UX:** Shared design tokens and primitives ensure visual consistency.
- **AI-friendly:** An AI agent learns one set of conventions (the platform layer) and applies them to any app.
- **Appropriate bundle sizes:** The public renderer doesn't include admin code. The admin console doesn't include platform control code.

**Cons:**
- **More packages to manage:** 12+ shared packages (including `@atlas/core`) require versioning and coordination.
- **Cross-package changes are harder:** Changing the `Button` component in `@atlas/design` affects all 4 apps. This is mitigated by semantic versioning and CI that runs all apps' tests on platform package changes.
- **Initial setup cost:** More scaffolding than a single app. This is a one-time cost.

**Verdict:** Accepted. The tradeoffs are favorable for a multi-audience platform product.

## Consequences

### Positive

1. Each audience gets a purpose-built application optimized for their needs.
2. Shared infrastructure ensures consistency in design, telemetry, accessibility, and testing.
3. Independent deployment means the stable public renderer is unaffected by admin console changes.
4. The platform layer creates a "pit of success" — using it correctly is easier than using it incorrectly.
5. AI agents can reliably add features by following the shared conventions.

### Negative

1. Initial scaffolding of 4 app shells + 11 platform packages is substantial.
2. Platform package changes require testing across all 4 apps.
3. Developers must understand the package boundary rules (what goes in platform vs. app vs. feature).

### Risks

1. **Over-sharing:** Risk of putting feature logic into platform packages "because the other app might need it." Mitigated by the rule: share infrastructure, never share features.
2. **Under-sharing:** Risk of duplicating logic in apps because the sharing mechanism feels heavy. Mitigated by keeping platform packages focused and well-documented.
3. **Version skew:** Risk of apps running different versions of platform packages. Mitigated by using workspace dependencies (all apps always use the latest workspace version).

## Follow-On Work

1. Bootstrap the `frontend/` monorepo with pnpm workspace configuration.
2. Build `@atlas/core` — component system, `html` tagged templates, signals, router, `query()`, context.
3. Create `@atlas/design` with design tokens and the first primitives (`<atlas-button>`, `<atlas-input>`, `<atlas-table>`, `<atlas-dialog>`, `<atlas-toast>`).
4. Create `@atlas/contracts` with the `SurfaceContract` shape definition.
5. Create `@atlas/test-ids` with the `testId()` helper.
6. Create `@atlas/test-fixtures` with `atlasTest`, `mockApi`, `loginAs`, and `telemetrySpy`.
7. Create `@atlas/auth` with OIDC client and auth context.
8. Create `@atlas/api-client` with typed HTTP client.
9. Create `@atlas/telemetry` with event emission and correlation ID propagation.
10. Bootstrap the `@atlas/admin` app shell as the first frontend.
11. Implement the first surface: `admin.content.pages-list` (full contract → Playwright → implementation cycle).
12. Set up CI to run Playwright tests on every frontend PR.
