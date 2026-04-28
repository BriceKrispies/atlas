/**
 * Shared type interfaces used by every page-editor surface contract.
 *
 * Extracted from `page-editor.surface.ts` so the six sub-surface contracts
 * (left-panel / right-panel / bottom-panel / preview / command-palette /
 * structure-grid) can import the same shapes without duplicating them. The
 * field shapes here are byte-identical to the previously inlined definitions
 * — do not change them without a coordinated update across every contract
 * file in this directory and the matching Playwright assertions.
 *
 * See `specs/frontend/surface-contract.md` for the format spec and
 * `specs/frontend/constitution.md` C1/C2/C4/C5 for the rules these shapes
 * encode (auth, required states, telemetry naming, auto-generated test
 * IDs).
 */

export interface SurfaceAuth {
  required: boolean;
  roles: readonly string[];
  permissions: readonly string[];
}

export interface SurfaceStateSpec {
  description: string;
  testId: string;
  applies: boolean;
  rationale?: string;
}

export interface SurfaceElementSpec {
  name: string;
  type: string;
  testId: string;
  parameterized?: boolean;
  purpose?: string;
}

export interface SurfaceTelemetryEventSpec {
  eventName: string;
  trigger: string;
  properties: readonly string[];
}

export interface SurfaceAcceptanceScenario {
  name: string;
  given: string;
  when: string;
  then: string;
}

export interface SurfaceContract {
  surfaceId: string;
  kind: 'page' | 'widget' | 'dialog';
  route: string;
  purpose: string;
  auth: SurfaceAuth;
  states: Record<string, SurfaceStateSpec>;
  elements: readonly SurfaceElementSpec[];
  telemetryEvents: readonly SurfaceTelemetryEventSpec[];
  acceptanceScenarios: readonly SurfaceAcceptanceScenario[];
}
