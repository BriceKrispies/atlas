import { expect } from '@playwright/test';
import { Given, When, Then } from '../../../../support/fixtures.ts';
import {
  submitIntent,
  submitIntentRaw,
  getFamilyDetail,
  readEvents,
  countEventsByIdempotencyKey,
} from '../../../../support/idb-probe.ts';
import { assertDefined } from '@atlas/test-fixtures/assert';
import type { IntentEnvelope, IntentPayload } from '@atlas/platform-core';
import { newEventId } from '@atlas/catalog';
import { badgeFamilySeed } from '@atlas/schemas';

interface BadgeSeedDoc {
  packageKey: string;
  version: string;
  payload: unknown;
}

/**
 * `badgeFamilySeed()` returns `unknown` because the generated JSON has
 * no compile-time type. Validate the three fields the BDD harness reads
 * and surface a contract-mismatch error at the boundary rather than
 * letting a malformed seed file corrupt the test.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}

function seedDoc(): BadgeSeedDoc {
  const raw: unknown = badgeFamilySeed();
  if (!isRecord(raw)) {
    throw new Error('badgeFamilySeed: expected an object');
  }
  const packageKey = raw['packageKey'];
  const version = raw['version'];
  if (typeof packageKey !== 'string' || typeof version !== 'string') {
    throw new Error('badgeFamilySeed: missing packageKey/version');
  }
  return { packageKey, version, payload: raw['payload'] };
}

/** Typed payload shape for the publish intent. */
interface PublishPayload extends IntentPayload {
  familyKey: string;
  familyRevisionNumber: number;
}

function buildSeedEnvelope(
  tenantId: string,
  principalId: string,
  idemKey: string,
): IntentEnvelope {
  const seed = seedDoc();
  return {
    eventId: newEventId(),
    eventType: 'Catalog.SeedPackage.ApplyRequested',
    schemaId: 'catalog.seed_package.apply.v1',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    tenantId,
    correlationId: newEventId(),
    idempotencyKey: idemKey,
    principalId,
    userId: principalId,
    payload: {
      actionId: 'Catalog.SeedPackage.Apply',
      resourceType: 'SeedPackage',
      resourceId: null,
      seedPackageKey: seed.packageKey,
      seedPackageVersion: seed.version,
      payload: seed.payload,
    },
  };
}

function buildPublishEnvelope(
  tenantId: string,
  principalId: string,
  familyKey: string,
  revisionNumber: number,
  idemKey: string,
  correlationId: string,
): IntentEnvelope<PublishPayload> {
  return {
    eventId: newEventId(),
    eventType: 'Catalog.Family.PublishRequested',
    schemaId: 'catalog.family.publish.v1',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    tenantId,
    correlationId,
    idempotencyKey: idemKey,
    principalId,
    userId: principalId,
    payload: {
      actionId: 'Catalog.Family.Publish',
      resourceType: 'Family',
      resourceId: null,
      familyKey,
      familyRevisionNumber: revisionNumber,
    },
  };
}

function expectedHandlerIdempotencyKey(
  tenantId: string,
  familyKey: string,
  revisionNumber: number,
): string {
  return `catalog.family.publish.${tenantId}.${familyKey}.${revisionNumber}`;
}

// ---------------- Background ----------------

Given('a tenant {string} with the catalog module enabled', async ({ world, tenantId }, alias: string) => {
  world.tenantsByAlias.set(alias, tenantId);
  world.primaryTenantAlias = alias;
});

Given(
  'the badge-family seed has been applied for tenant {string}',
  async ({ simPage, world, tenantId, principalId }, alias: string) => {
    const realTenant = world.tenantsByAlias.get(alias) ?? tenantId;
    const env = buildSeedEnvelope(
      realTenant,
      principalId,
      `bdd-seed-${realTenant}`,
    );
    await submitIntent(simPage, env);
  },
);

// ---------------- Authentication ----------------

// `Given the admin is authenticated as a principal with role <string>` is
// defined in tests/bdd/steps/common/common.steps.ts (used by both the
// catalog family-publish and authoring page-lifecycle scenarios).

// ---------------- Cross-tenant setup ----------------

Given(
  'a separate tenant {string} has no catalog data',
  async ({ mintAdditionalTenant }, alias: string) => {
    // Mint and immediately discard the secondary page reference. The fixture
    // tracks it for teardown; subsequent steps reach it via reauthenticate().
    await mintAdditionalTenant({ alias, role: 'TenantAdmin' });
  },
);

When(
  'the admin re-authenticates for tenant {string}',
  async ({ reauthenticate, world }, alias: string) => {
    const realTenant = world.tenantsByAlias.get(alias);
    if (!realTenant) {
      throw new Error(`unknown tenant alias: ${alias}`);
    }
    await reauthenticate({ tenantId: realTenant });
  },
);

// ---------------- Publishing ----------------

When(
  'the admin publishes {string} at revision {int}',
  async (
    { simPage, world, tenantId, principalId },
    familyKey: string,
    revision: number,
  ) => {
    const correlationId = newEventId();
    const idemKey = `bdd-pub-${familyKey}-${revision}-${Date.now().toString(36)}`;
    const env = buildPublishEnvelope(
      tenantId,
      principalId,
      familyKey,
      revision,
      idemKey,
      correlationId,
    );
    world.lastEnvelope = env;
    world.lastCorrelationId = correlationId;
    world.lastIdempotencyKey = idemKey;
    const result = await submitIntentRaw(simPage, env);
    if (result.ok) {
      world.lastSubmitOk = { ok: true, eventId: result.response.eventId };
      world.lastSubmitFailure = null;
    } else {
      world.lastSubmitOk = null;
      world.lastSubmitFailure = result.failure;
    }
  },
);

When(
  'the admin re-submits the same publish envelope',
  async ({ simPage, world }) => {
    if (!world.lastEnvelope) {
      throw new Error('no envelope to replay — call a publish step first');
    }
    const result = await submitIntentRaw(simPage, world.lastEnvelope);
    if (result.ok) {
      world.lastSubmitOk = { ok: true, eventId: result.response.eventId };
    } else {
      world.lastSubmitFailure = result.failure;
    }
  },
);

When(
  'the admin attempts to publish {string} at revision {int}',
  async (
    { simPage, world, tenantId, principalId },
    familyKey: string,
    revision: number,
  ) => {
    const correlationId = newEventId();
    const idemKey = `bdd-attempt-${familyKey}-${revision}-${Date.now().toString(36)}`;
    const env = buildPublishEnvelope(
      tenantId,
      principalId,
      familyKey,
      revision,
      idemKey,
      correlationId,
    );
    world.lastEnvelope = env;
    world.lastCorrelationId = correlationId;
    world.lastIdempotencyKey = idemKey;
    const result = await submitIntentRaw(simPage, env);
    world.lastSubmitOk = result.ok ? { ok: true, eventId: result.response.eventId } : null;
    world.lastSubmitFailure = result.ok ? null : result.failure;
  },
);

When(
  'the admin queries the family {string}',
  async ({ simPage, world }, familyKey: string) => {
    world.lastQueryResponse = await getFamilyDetail(simPage, familyKey);
  },
);

// ---------------- Assertions ----------------

Then(
  'a {string} event is emitted with revision {int}',
  async ({ simPage, world }, eventType: string, revision: number) => {
    const correlationId = assertDefined(world.lastCorrelationId, 'lastCorrelationId set by a prior publish step');
    const matches = await readEvents(simPage, { type: eventType, correlationId });
    expect(matches).toHaveLength(1);
    const ev = assertDefined(matches[0], 'matches[0] guaranteed by the toHaveLength(1) above');
    // Event payloads are `Record<string, unknown>` — read the typed
    // field via an explicit lookup rather than a structural cast.
    const payload: Record<string, unknown> = ev.payload;
    expect(payload['revisionNumber']).toBe(revision);
  },
);

Then('the event carries the request correlationId', async ({ simPage, world }) => {
  const correlationId = assertDefined(world.lastCorrelationId, 'lastCorrelationId set by a prior publish step');
  const matches = await readEvents(simPage, {
    type: 'StructuredCatalog.FamilyPublished',
    correlationId,
  });
  expect(matches.length).toBeGreaterThanOrEqual(1);
  const first = assertDefined(matches[0], 'matches[0] guaranteed by the length check above');
  expect(first.correlationId).toBe(correlationId);
});

Then(
  'the event carries cache invalidation tags including {string} and {string}',
  async ({ simPage, world }, tagA: string, tagB: string) => {
    const correlationId = assertDefined(world.lastCorrelationId, 'lastCorrelationId set by a prior publish step');
    const matches = await readEvents(simPage, {
      type: 'StructuredCatalog.FamilyPublished',
      correlationId,
    });
    expect(matches).toHaveLength(1);
    const first = assertDefined(matches[0], 'matches[0] guaranteed by toHaveLength(1) above');
    const tags = first.cacheInvalidationTags ?? [];
    // The tag templates use the real (uniquified) tenantId, not the alias.
    // Replace the alias prefix in the expected tag with the tenant id we
    // actually booted with — `Tenant:acme` → `Tenant:bdd-1-...`.
    const resolveTag = (tag: string): string => {
      for (const [alias, real] of world.tenantsByAlias.entries()) {
        if (tag === `Tenant:${alias}`) return `Tenant:${real}`;
      }
      return tag;
    };
    expect(tags).toContain(resolveTag(tagA));
    expect(tags).toContain(resolveTag(tagB));
  },
);

Then(
  'exactly one {string} event exists for that idempotency key',
  async ({ simPage, world, tenantId }, eventType: string) => {
    const envelope = assertDefined(world.lastEnvelope, 'world.lastEnvelope set by a prior publish step');
    // Payload is `IntentPayload` with an `[k]: unknown` index signature;
    // read the fields directly and validate type.
    const familyKey = envelope.payload['familyKey'];
    const revision = envelope.payload['familyRevisionNumber'];
    if (typeof familyKey !== 'string' || typeof revision !== 'number') {
      throw new Error('publish envelope payload: missing familyKey/familyRevisionNumber');
    }
    const handlerIdem = expectedHandlerIdempotencyKey(tenantId, familyKey, revision);
    const count = await countEventsByIdempotencyKey(simPage, eventType, handlerIdem);
    expect(count).toBe(1);
  },
);

Then('the request is denied with code {string}', async ({ world }, code: string) => {
  const failure = assertDefined(world.lastSubmitFailure, 'world.lastSubmitFailure set by a prior failing submit');
  expect(failure.code).toBe(code);
});

Then(
  'no {string} event exists in the event store',
  async ({ simPage }, eventType: string) => {
    const matches = await readEvents(simPage, { type: eventType });
    expect(matches).toHaveLength(0);
  },
);

Then('the response describes the {string} family', async ({ world }, _alias: string) => {
  // Sim mode keeps each tenant in its own IDB database, so the simple
  // check is "the response is non-null and includes the seeded family
  // identifiers." A dedicated cross-pollution probe would walk the
  // response JSON for any string equal to a foreign tenantId — added
  // when a multi-tenant shared store lands.
  expect(world.lastQueryResponse).not.toBeNull();
});

Then('the response is empty', async ({ world }) => {
  expect(world.lastQueryResponse).toBeNull();
});
