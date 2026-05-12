import { describe, test, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { assertDefined } from '@atlas/test-fixtures/assert';
import {
  ValidationError,
  validateEventEnvelope,
  validateModuleManifest,
  validateSearchDocuments,
  validateAnalyticsEvents,
} from './validation.ts';
import { loadAndStrip, stripDocFields } from './spec-validate/json.ts';
import { parseFilename, discover } from './spec-validate/discover.ts';
import { runValidation } from './spec-validate/run.ts';

// ---------------------------------------------------------------------------
// TS parity tests for `crates/core/src/validation.rs` and the
// `crates/spec_validate` harness. Each fixture under specs/fixtures/ is
// loaded through the same `loadAndStrip` pipeline the runner uses, and the
// validator outcome is checked against the filename's `__valid__` /
// `__invalid__` tag.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/platform-core/src -> repo root is three levels up.
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const FIXTURES_DIR = resolve(REPO_ROOT, 'specs', 'fixtures');

/**
 * Narrow a thrown value to `ValidationError`. The validators reject via
 * `throw new ValidationError(...)`; `catch (e: unknown)` from a `try`
 * around a call we expect to throw is the boundary where typing breaks
 * down. This guard collapses the cast and asserts the discriminator
 * in one place so every test reads as a behavior check, not a cast.
 */
function asValidationError(e: unknown): ValidationError {
  if (!(e instanceof ValidationError)) {
    throw new Error(
      `expected ValidationError, got ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return e;
}

/**
 * Narrow `loadAndStrip()`'s `unknown` return when we know the fixture
 * shape is a top-level JSON object. Runtime-guarded; one boundary
 * readback replaces ad-hoc casting.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function asRecord(v: unknown, what: string): Record<string, unknown> {
  if (!isRecord(v)) {
    throw new Error(`${what}: expected plain object record, got ${typeof v}`);
  }
  return v;
}

// ---------- ValidationError taxonomy --------------------------------------

describe('ValidationError taxonomy', () => {
  test('every Rust variant has a constructor', () => {
    expect(ValidationError.missingField('foo').kind).toBe('MissingField');
    expect(ValidationError.invalidFormat('foo').kind).toBe('InvalidFormat');
    expect(ValidationError.duplicate('foo').kind).toBe('Duplicate');
    expect(ValidationError.invalidReference('foo').kind).toBe('InvalidReference');
    expect(ValidationError.constraintViolation('foo').kind).toBe('ConstraintViolation');
  });

  test('messages include the field/message tag', () => {
    expect(ValidationError.missingField('idempotencyKey').message).toBe(
      'Missing required field: idempotencyKey',
    );
  });
});

// ---------- stripDocFields ------------------------------------------------

describe('stripDocFields', () => {
  test('drops $-prefixed keys at every depth', () => {
    const input = {
      $schema: 'x',
      $comment: 'top',
      keep: 1,
      nested: {
        $invariants: { a: 1 },
        keep: 2,
        deep: { $meta: 'gone', kept: 3 },
      },
    };
    expect(stripDocFields(input)).toEqual({
      keep: 1,
      nested: { keep: 2, deep: { kept: 3 } },
    });
  });

  test('strips inside arrays', () => {
    const input = [
      { $comment: 'first', id: 1 },
      { $comment: 'second', id: 2 },
      [{ $nested: true, val: 'x' }],
    ];
    expect(stripDocFields(input)).toEqual([{ id: 1 }, { id: 2 }, [{ val: 'x' }]]);
  });

  test('preserves dollar signs in values', () => {
    expect(stripDocFields({ price: '$100', $comment: 'x' })).toEqual({ price: '$100' });
  });

  test('primitives unchanged', () => {
    expect(stripDocFields(null)).toBe(null);
    expect(stripDocFields(true)).toBe(true);
    expect(stripDocFields(42)).toBe(42);
    expect(stripDocFields('hello')).toBe('hello');
  });
});

// ---------- parseFilename -------------------------------------------------

describe('parseFilename', () => {
  test('valid event_envelope', () => {
    const r = parseFilename('specs/fixtures/event_envelope__valid__sample.json');
    expect(r.tag).toBe('ok');
    if (r.tag === 'ok') {
      expect(r.case.kind).toBe('event_envelope');
      expect(r.case.expect).toBe('valid');
      expect(r.case.name).toBe('sample');
    }
  });

  test('invalid module_manifest', () => {
    const r = parseFilename('module_manifest__invalid__broken.json');
    expect(r.tag).toBe('ok');
    if (r.tag === 'ok') {
      expect(r.case.kind).toBe('module_manifest');
      expect(r.case.expect).toBe('invalid');
      expect(r.case.name).toBe('broken');
    }
  });

  test('non-json extension', () => {
    expect(parseFilename('event_envelope__valid__sample.txt').tag).toBe('not_json');
  });

  test('unknown kind', () => {
    expect(parseFilename('unknown_type__valid__sample.json').tag).toBe('no_match');
  });

  test('unknown expect', () => {
    expect(parseFilename('event_envelope__maybe__sample.json').tag).toBe('no_match');
  });

  test('missing parts', () => {
    expect(parseFilename('event_envelope__valid.json').tag).toBe('no_match');
  });

  test('legacy filename', () => {
    expect(parseFilename('valid_event_envelope.json').tag).toBe('no_match');
  });
});

// ---------- Direct validator unit tests -----------------------------------

describe('validateEventEnvelope (direct)', () => {
  const valid = {
    eventId: 'evt-1',
    eventType: 'Test.Event',
    schemaId: 'test.event.v1',
    schemaVersion: 1,
    occurredAt: '2025-01-01T00:00:00.000Z',
    tenantId: 'tenant-1',
    correlationId: 'corr-1',
    idempotencyKey: 'idem-1',
    payload: {},
  };

  test('happy path', () => {
    expect(() => validateEventEnvelope(valid)).not.toThrow();
  });

  test('missing idempotencyKey', () => {
    expect(() => validateEventEnvelope({ ...valid, idempotencyKey: '' })).toThrowError(
      ValidationError,
    );
    try {
      validateEventEnvelope({ ...valid, idempotencyKey: '' });
    } catch (e) {
      const err = asValidationError(e);
      expect(err.kind).toBe('MissingField');
      expect(err.field).toBe('idempotencyKey');
    }
  });

  test('eventType without dot', () => {
    try {
      validateEventEnvelope({ ...valid, eventType: 'NoDot' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(asValidationError(e).kind).toBe('InvalidFormat');
    }
  });

  test('schemaVersion < 1', () => {
    try {
      validateEventEnvelope({ ...valid, schemaVersion: 0 });
      throw new Error('should have thrown');
    } catch (e) {
      expect(asValidationError(e).kind).toBe('InvalidFormat');
    }
  });
});

describe('validateModuleManifest (direct)', () => {
  const valid = {
    moduleId: 'm',
    displayName: 'M',
    version: '1.0.0',
    actions: [{ actionId: 'A', resourceType: 'R', verb: 'create', auditLevel: 'INFO' }],
    resources: [{ resourceType: 'R', ownership: 'module' }],
    events: [
      { eventType: 'M.Created', category: 'DOMAIN', schemaId: 's.v1', compatibility: 'BACKWARD' },
    ],
    projections: [],
    migrations: [],
    uiRoutes: [],
    jobs: [],
    cacheArtifacts: [],
    capabilities: [],
  };

  test('happy path', () => {
    expect(() => validateModuleManifest(valid)).not.toThrow();
  });

  test('duplicate actionId', () => {
    const firstAction = assertDefined(valid.actions[0], 'fixture has one action');
    const bad = { ...valid, actions: [firstAction, firstAction] };
    try {
      validateModuleManifest(bad);
      throw new Error('should have thrown');
    } catch (e) {
      expect(asValidationError(e).kind).toBe('Duplicate');
    }
  });

  test('action references undeclared resource', () => {
    const firstAction = assertDefined(valid.actions[0], 'fixture has one action');
    const bad = {
      ...valid,
      actions: [{ ...firstAction, resourceType: 'NotDeclared' }],
    };
    try {
      validateModuleManifest(bad);
      throw new Error('should have thrown');
    } catch (e) {
      expect(asValidationError(e).kind).toBe('InvalidReference');
    }
  });

  test('cacheArtifact ttlSeconds=0', () => {
    const bad = {
      ...valid,
      cacheArtifacts: [
        {
          artifactId: 'a',
          varyBy: ['TENANT'],
          ttlSeconds: 0,
          tags: [],
          privacy: 'TENANT',
        },
      ],
    };
    try {
      validateModuleManifest(bad);
      throw new Error('should have thrown');
    } catch (e) {
      expect(asValidationError(e).kind).toBe('ConstraintViolation');
    }
  });
});

describe('validateSearchDocuments (direct)', () => {
  test('happy path', () => {
    expect(() =>
      validateSearchDocuments([
        { documentId: 'd1', documentType: 'Page', tenantId: 't1', fields: {} },
      ]),
    ).not.toThrow();
  });

  test('duplicate documentId', () => {
    const dup = [
      { documentId: 'd1', documentType: 'Page', tenantId: 't1', fields: {} },
      { documentId: 'd1', documentType: 'Page', tenantId: 't1', fields: {} },
    ];
    try {
      validateSearchDocuments(dup);
      throw new Error('should have thrown');
    } catch (e) {
      expect(asValidationError(e).kind).toBe('Duplicate');
    }
  });
});

describe('validateAnalyticsEvents (direct)', () => {
  const valid = [
    {
      eventId: 'a-1',
      eventType: 'M.event_one',
      tenantId: 't',
      dimensions: {},
      metrics: {},
      timestamp: '2025-01-01T00:00:00Z',
      schemaId: 's.v1',
    },
  ];

  test('happy path', () => {
    expect(() => validateAnalyticsEvents(valid)).not.toThrow();
  });

  test('eventType without dot', () => {
    const firstEvent = assertDefined(valid[0], 'fixture has one event');
    try {
      validateAnalyticsEvents([{ ...firstEvent, eventType: 'no_dot' }]);
      throw new Error('should have thrown');
    } catch (e) {
      expect(asValidationError(e).kind).toBe('InvalidFormat');
    }
  });
});

// ---------- Fixture parity (loadAndStrip + dispatcher) --------------------

describe('fixture parity (specs/fixtures/*)', () => {
  test('discover finds the spec_validate-naming fixtures', async () => {
    const r = await discover(FIXTURES_DIR);
    expect(r.cases.length).toBeGreaterThan(0);
    const ids = r.cases.map((c) => `${c.kind}__${c.expect}__${c.name}`);
    expect(ids).toContain('event_envelope__valid__canonical');
    expect(ids).toContain('event_envelope__invalid__missing_idempotency');
    expect(ids).toContain('module_manifest__valid__content_pages');
    expect(ids).toContain('search_documents__valid__sample');
    expect(ids).toContain('analytics_events__valid__sample');
  });

  // Fixtures that fail under the Rust spec_validate runner too (broken
  // content despite the conventional name). Tracked here so the parity
  // test fails fast if the fixture is fixed upstream — at which point we
  // remove the entry.
  const KNOWN_BROKEN_FIXTURES = new Set<string>([
    'event_envelope__valid__page_created_projection',
  ]);

  test('runValidation matches Rust spec_validate on every fixture', async () => {
    const r = await discover(FIXTURES_DIR);
    const summary = await runValidation(r.cases);
    const unexpectedFailures = summary.results.filter(
      (res) =>
        res.outcome.tag !== 'pass' &&
        !KNOWN_BROKEN_FIXTURES.has(`${res.case.kind}__${res.case.expect}__${res.case.name}`),
    );
    if (unexpectedFailures.length > 0) {
      const detail = unexpectedFailures
        .map((res) => `${res.case.kind}__${res.case.expect}__${res.case.name}: ${res.outcome.tag === 'fail' ? res.outcome.reason : ''}`)
        .join('\n');
      throw new Error(`Unexpected fixture failures:\n${detail}`);
    }
    // Total run = all cases; passed should equal total minus known-broken.
    expect(summary.total).toBeGreaterThanOrEqual(5);
    expect(summary.total - summary.passed).toBe(KNOWN_BROKEN_FIXTURES.size);
  });

  test('loadAndStrip drops $-prefixed keys from real fixtures', async () => {
    const stripped = asRecord(
      await loadAndStrip(resolve(FIXTURES_DIR, 'analytics_events__valid__sample.json')),
      'analytics_events__valid__sample.json',
    );
    expect(stripped['$comment']).toBeUndefined();
    expect(stripped['$invariants']).toBeUndefined();
    expect(Array.isArray(stripped['events'])).toBe(true);
  });
});
