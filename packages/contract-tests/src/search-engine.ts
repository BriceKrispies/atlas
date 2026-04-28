import { describe, test, expect, beforeEach } from 'vitest';
import type { SearchDocument } from '@atlas/platform-core';
import type { SearchEngine } from '@atlas/ports';

interface MakeDocOptions {
  documentId?: string;
  documentType?: string;
  tenantId?: string;
  title?: string;
  summary?: string;
  bodyText?: string;
  taxonomyPath?: string;
  allowedPrincipals?: string[] | null;
}

function makeDoc(opts: MakeDocOptions = {}): SearchDocument {
  const fields: Record<string, unknown> = {
    title: opts.title ?? 'Untitled',
    summary: opts.summary ?? '',
    body_text: opts.bodyText ?? '',
    taxonomy_path: opts.taxonomyPath ?? '/',
  };
  const doc: SearchDocument = {
    documentId: opts.documentId ?? 'doc-1',
    documentType: opts.documentType ?? 'family',
    tenantId: opts.tenantId ?? 'tenant-a',
    fields,
    permissionAttributes:
      opts.allowedPrincipals === undefined
        ? null
        : opts.allowedPrincipals === null
          ? null
          : { allowedPrincipals: opts.allowedPrincipals },
  };
  return doc;
}

export function searchEngineContract(makeEngine: () => Promise<SearchEngine>): void {
  describe('SearchEngine contract', () => {
    let engine: SearchEngine;
    beforeEach(async () => {
      engine = await makeEngine();
    });

    test('index then search returns the document', async () => {
      await engine.index(
        makeDoc({
          documentId: 'fam-anniv',
          tenantId: 'tenant-a',
          title: 'Service Anniversary Badge',
        }),
      );
      const results = await engine.search('anniversary', 'tenant-a', 'user:any');
      expect(results.length).toBe(1);
      expect(results[0]!.documentId).toBe('fam-anniv');
    });

    test('search returns ranked results, descending by relevance', async () => {
      await engine.index(
        makeDoc({
          documentId: 'doc-title',
          tenantId: 'tenant-rank',
          title: 'anniversary celebration',
          summary: 'unrelated',
          bodyText: 'unrelated',
        }),
      );
      await engine.index(
        makeDoc({
          documentId: 'doc-summary',
          tenantId: 'tenant-rank',
          title: 'unrelated',
          summary: 'anniversary roundup',
          bodyText: 'unrelated',
        }),
      );
      await engine.index(
        makeDoc({
          documentId: 'doc-body',
          tenantId: 'tenant-rank',
          title: 'unrelated',
          summary: 'unrelated',
          bodyText: 'mention of anniversary deep in body',
        }),
      );

      const results = await engine.search('anniversary', 'tenant-rank', 'user:any');
      expect(results.length).toBe(3);
      // Title match beats summary beats body. The contract says descending order.
      const ids = results.map((r) => r.documentId);
      expect(ids[0]).toBe('doc-title');
      expect(ids[ids.length - 1]).toBe('doc-body');
    });

    test('tenant isolation: tenant A docs are invisible to tenant B', async () => {
      await engine.index(
        makeDoc({
          documentId: 'a-only',
          tenantId: 'tenant-a',
          title: 'anniversary alpha',
        }),
      );
      await engine.index(
        makeDoc({
          documentId: 'b-only',
          tenantId: 'tenant-b',
          title: 'anniversary bravo',
        }),
      );

      const a = await engine.search('anniversary', 'tenant-a', 'user:any');
      const b = await engine.search('anniversary', 'tenant-b', 'user:any');

      expect(a.map((d) => d.documentId)).toEqual(['a-only']);
      expect(b.map((d) => d.documentId)).toEqual(['b-only']);
    });

    test('permission filter: doc with allowedPrincipals is hidden from non-listed principals', async () => {
      await engine.index(
        makeDoc({
          documentId: 'restricted',
          tenantId: 'tenant-perm',
          title: 'anniversary briefing',
          allowedPrincipals: ['u_alice'],
        }),
      );
      const bob = await engine.search('anniversary', 'tenant-perm', 'u_bob');
      expect(bob).toEqual([]);
    });

    test('permission filter: doc with allowedPrincipals IS returned to a listed principal', async () => {
      await engine.index(
        makeDoc({
          documentId: 'restricted',
          tenantId: 'tenant-perm',
          title: 'anniversary briefing',
          allowedPrincipals: ['u_alice'],
        }),
      );
      const alice = await engine.search('anniversary', 'tenant-perm', 'u_alice');
      expect(alice.map((d) => d.documentId)).toEqual(['restricted']);
    });

    test('doc with no permissionAttributes is returned to any principal in the tenant', async () => {
      await engine.index(
        makeDoc({
          documentId: 'public',
          tenantId: 'tenant-pub',
          title: 'public anniversary post',
        }),
      );
      const u1 = await engine.search('anniversary', 'tenant-pub', 'u_anyone');
      const u2 = await engine.search('anniversary', 'tenant-pub', 'u_someone-else');
      expect(u1.map((d) => d.documentId)).toEqual(['public']);
      expect(u2.map((d) => d.documentId)).toEqual(['public']);
    });

    test('upsert on the same (tenantId, documentType, documentId) replaces, not duplicates', async () => {
      await engine.index(
        makeDoc({
          documentId: 'fam-1',
          tenantId: 'tenant-up',
          title: 'first version',
        }),
      );
      await engine.index(
        makeDoc({
          documentId: 'fam-1',
          tenantId: 'tenant-up',
          title: 'anniversary reissue',
        }),
      );
      const r = await engine.search('anniversary', 'tenant-up', 'user:any');
      expect(r.length).toBe(1);
      expect(r[0]!.fields['title']).toBe('anniversary reissue');
    });

    test('empty query returns no results', async () => {
      // Both adapters: IDB returns []; Postgres uses plainto_tsquery('') which
      // produces an empty tsquery and matches nothing.
      await engine.index(
        makeDoc({
          documentId: 'doc-x',
          tenantId: 'tenant-empty-q',
          title: 'whatever',
        }),
      );
      const r = await engine.search('', 'tenant-empty-q', 'user:any');
      expect(r).toEqual([]);
    });

    test('query that does not match any field returns no results', async () => {
      await engine.index(
        makeDoc({
          documentId: 'doc-y',
          tenantId: 'tenant-nomatch',
          title: 'anniversary celebration',
        }),
      );
      const r = await engine.search('zzznope', 'tenant-nomatch', 'user:any');
      expect(r).toEqual([]);
    });

    test('deleteByDocument removes the row from search results', async () => {
      await engine.index(
        makeDoc({
          documentId: 'to-delete',
          tenantId: 'tenant-del',
          title: 'anniversary doomed',
        }),
      );
      const before = await engine.search('anniversary', 'tenant-del', 'user:any');
      expect(before.length).toBe(1);

      await engine.deleteByDocument('tenant-del', 'family', 'to-delete');

      const after = await engine.search('anniversary', 'tenant-del', 'user:any');
      expect(after).toEqual([]);
    });

    test('deleteByDocument scoped by tenantId — does not delete cross-tenant rows', async () => {
      await engine.index(
        makeDoc({
          documentId: 'shared-id',
          tenantId: 'tenant-a',
          title: 'anniversary alpha',
        }),
      );
      await engine.index(
        makeDoc({
          documentId: 'shared-id',
          tenantId: 'tenant-b',
          title: 'anniversary bravo',
        }),
      );
      await engine.deleteByDocument('tenant-a', 'family', 'shared-id');

      const a = await engine.search('anniversary', 'tenant-a', 'user:any');
      const b = await engine.search('anniversary', 'tenant-b', 'user:any');
      expect(a).toEqual([]);
      expect(b.length).toBe(1);
      expect(b[0]!.documentId).toBe('shared-id');
    });

    test('search filter matches across documentType: family + variant in the same tenant', async () => {
      await engine.index(
        makeDoc({
          documentId: 'fam-1',
          documentType: 'family',
          tenantId: 'tenant-mt',
          title: 'service anniversary',
        }),
      );
      await engine.index(
        makeDoc({
          documentId: 'var-5y',
          documentType: 'variant',
          tenantId: 'tenant-mt',
          title: '5 year anniversary',
        }),
      );
      const r = await engine.search('anniversary', 'tenant-mt', 'user:any');
      const types = r.map((d) => d.documentType).sort();
      expect(types).toEqual(['family', 'variant']);
    });

    test('[concurrency] concurrent index calls produce a stable, deduplicated result set', async () => {
      const ops: Promise<void>[] = [];
      for (let i = 0; i < 5; i++) {
        ops.push(
          engine.index(
            makeDoc({
              documentId: `doc-c-${i}`,
              tenantId: 'tenant-conc',
              title: `anniversary ${i}`,
            }),
          ),
        );
      }
      await Promise.all(ops);
      const r = await engine.search('anniversary', 'tenant-conc', 'user:any');
      expect(r.length).toBe(5);
      const ids = new Set(r.map((d) => d.documentId));
      expect(ids.size).toBe(5);
    });
  });
}
