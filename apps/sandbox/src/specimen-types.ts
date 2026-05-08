/**
 * Specimen data model — the shape registered with `AtlasSandbox.register`
 * and consumed by the shell + sidebar.
 *
 * Lives in its own file so `sandbox-app.ts` (the shell) and `sidebar.ts`
 * (a child component that needs to render specimen rows) can both depend
 * on it without forming a cycle.
 */

import type { Category, Status } from './registry/index.ts';

export interface SpecimenVariant {
  name: string;
  html: string;
  dark?: boolean;
}

export interface SpecimenConfigVariant {
  name: string;
  config: Record<string, unknown>;
  isolation?: string;
}

export type SpecimenMountFn = (
  demoEl: HTMLElement,
  ctx: {
    config: Record<string, unknown>;
    isolation?: string;
    onLog: (kind: string, payload: unknown) => void;
  },
) => (() => void) | void;

export interface Specimen {
  id: string;
  name: string;
  tag: string;
  category?: Category;
  subcategory?: string;
  status?: Status;
  tags?: readonly string[];
  variants?: SpecimenVariant[];
  states?: Record<string, string>;
  mount?: SpecimenMountFn;
  configVariants?: SpecimenConfigVariant[];
}

export interface ResolvedSpecimen extends Specimen {
  category: Category;
  subcategory?: string;
  status: Status;
  tags: readonly string[];
}
