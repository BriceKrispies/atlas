/**
 * Seed data for test fixtures.
 * Matches the shape of GET /api/v1/pages response.
 */

export interface PageFixture {
  pageId: string;
  title: string;
  slug: string;
  status: 'published' | 'draft';
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export const pages: PageFixture[] = [
  {
    pageId: 'pg_001',
    title: 'Welcome Page',
    slug: 'welcome',
    status: 'published',
    tenantId: 'tenant-001',
    createdAt: '2026-04-10T12:00:00Z',
    updatedAt: '2026-04-14T09:30:00Z',
  },
  {
    pageId: 'pg_002',
    title: 'Getting Started Guide',
    slug: 'getting-started',
    status: 'published',
    tenantId: 'tenant-001',
    createdAt: '2026-04-11T08:00:00Z',
    updatedAt: '2026-04-13T15:45:00Z',
  },
  {
    pageId: 'pg_003',
    title: 'About Us',
    slug: 'about',
    status: 'draft',
    tenantId: 'tenant-001',
    createdAt: '2026-04-12T10:30:00Z',
    updatedAt: '2026-04-12T10:30:00Z',
  },
  {
    pageId: 'pg_004',
    title: 'Contact Information',
    slug: 'contact',
    status: 'published',
    tenantId: 'tenant-001',
    createdAt: '2026-04-09T14:00:00Z',
    updatedAt: '2026-04-14T11:00:00Z',
  },
  {
    pageId: 'pg_005',
    title: 'FAQ',
    slug: 'faq',
    status: 'draft',
    tenantId: 'tenant-001',
    createdAt: '2026-04-13T16:20:00Z',
    updatedAt: '2026-04-13T16:20:00Z',
  },
];
