/**
 * Typed wrappers for the ContentPages HTTP surface.
 *
 * Reads (`listPages`, `getPage`, `getRenderTree`) hit dedicated GET
 * endpoints under `/api/v1/pages`. Writes go through the standard intent
 * pipeline (`POST /api/v1/intents`) — same pattern as `authz.ts`.
 *
 * The mock backend (`packages/api-client/src/mock/index.ts`) already
 * simulates `ContentPages.Page.{Create,Delete}`; this real-mode wrapper
 * mirrors the payload shape.
 */

import { backend } from './index.ts';

export type PageStatus = 'draft' | 'published' | 'archived';

export interface PageSummary {
  pageId: string;
  title: string;
  slug: string;
  status: PageStatus;
  updatedAt: string;
}

export interface PageDocument extends PageSummary {
  tenantId: string;
  createdAt: string;
  content?: string;
  authorId?: string | null;
  templateId?: string;
  templateVersion?: string;
}

export interface RenderNode {
  type: string;
  props?: Record<string, string | number | boolean | null>;
  children?: RenderNode[];
}

export interface RenderTree {
  version: 1;
  nodes: RenderNode[];
}

export async function listPages(): Promise<readonly PageSummary[]> {
  // Path matches the mock backend (`/pages`) so admin surfaces work in
  // both modes. The server route mounts under the same prefix.
  const result = await backend.query('/pages');
  return (result as readonly PageSummary[] | null) ?? [];
}

export async function getPage(pageId: string): Promise<PageDocument | null> {
  const result = await backend.query(`/pages/${pageId}`);
  return (result as PageDocument | null) ?? null;
}

export async function getRenderTree(pageId: string): Promise<RenderTree | null> {
  const result = await backend.query(`/pages/${pageId}/render-tree`);
  return (result as RenderTree | null) ?? null;
}

export interface CreatePageInput {
  pageId: string;
  title: string;
  slug: string;
  status?: PageStatus;
  content?: string;
  templateId?: string;
  templateVersion?: string;
}

export async function createPage(input: CreatePageInput): Promise<unknown> {
  return backend.mutate('/intents', {
    actionId: 'ContentPages.Page.Create',
    resourceType: 'Page',
    resourceId: input.pageId,
    pageId: input.pageId,
    title: input.title,
    slug: input.slug,
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.content !== undefined ? { content: input.content } : {}),
    ...(input.templateId !== undefined ? { templateId: input.templateId } : {}),
    ...(input.templateVersion !== undefined
      ? { templateVersion: input.templateVersion }
      : {}),
  });
}

export interface UpdatePageInput {
  pageId: string;
  title?: string;
  slug?: string;
  status?: PageStatus;
  content?: string;
  templateId?: string;
  templateVersion?: string;
}

export async function updatePage(input: UpdatePageInput): Promise<unknown> {
  return backend.mutate('/intents', {
    actionId: 'ContentPages.Page.Update',
    resourceType: 'Page',
    resourceId: input.pageId,
    pageId: input.pageId,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.slug !== undefined ? { slug: input.slug } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.content !== undefined ? { content: input.content } : {}),
    ...(input.templateId !== undefined ? { templateId: input.templateId } : {}),
    ...(input.templateVersion !== undefined
      ? { templateVersion: input.templateVersion }
      : {}),
  });
}

export async function deletePage(pageId: string): Promise<unknown> {
  return backend.mutate('/intents', {
    actionId: 'ContentPages.Page.Delete',
    resourceType: 'Page',
    resourceId: pageId,
    pageId,
  });
}
