/**
 * Typed payload union for every `ContentPages.*` intent dispatched through
 * the platform's `HandlerRegistry`.
 *
 * Each variant carries the discriminating `actionId` literal so the
 * registry can narrow `envelope.payload` without an unsafe `as
 * Record<string, unknown>` cast or per-field `readString` shim.
 *
 * Shapes mirror the handler `XCommand` interfaces one-for-one minus the
 * three fields the registry lifts off `IntentHandlerContext`
 * (`tenantId`, `correlationId`, `principalId`). AJV validates the wire
 * shape against the same JSON schema at ingress, so both contracts
 * MUST agree — add a handler-side field, add it here too.
 */

import type { IntentPayload } from '@atlas/platform-core';
import type { PageStatus } from './types.ts';

export interface PageCreatePayload extends IntentPayload {
  actionId: 'ContentPages.Page.Create';
  resourceType: 'Page';
  pageId: string;
  title: string;
  slug: string;
  status?: PageStatus;
  content?: string;
  authorId?: string;
  templateId?: string;
  templateVersion?: string;
  pluginRef?: string;
}

export interface PageUpdatePayload extends IntentPayload {
  actionId: 'ContentPages.Page.Update';
  resourceType: 'Page';
  pageId: string;
  title?: string;
  slug?: string;
  status?: PageStatus;
  content?: string;
  templateId?: string;
  templateVersion?: string;
}

export interface PageDeletePayload extends IntentPayload {
  actionId: 'ContentPages.Page.Delete';
  resourceType: 'Page';
  pageId: string;
}

/**
 * Discriminated union of every content-pages-action payload the
 * platform's `HandlerRegistry` dispatches. Discriminator: `actionId`.
 */
export type ContentPagesIntentPayload =
  | PageCreatePayload
  | PageUpdatePayload
  | PageDeletePayload;
