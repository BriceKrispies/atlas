import type {
  HandlerRegistry,
  IntentHandler,
  IntentHandlerContext,
  HandlerResult,
} from '@atlas/ports';
import type { IntentEnvelope } from '@atlas/platform-core';
import { handleSeedPackageApply } from './seed-package-apply.ts';
import { handleFamilyPublish } from './family-publish.ts';
import type { SeedPayload } from '../seed-types.ts';

function readString(payload: Record<string, unknown>, key: string): string {
  const v = payload[key];
  if (typeof v !== 'string') {
    throw new Error(`expected string for payload.${key}`);
  }
  return v;
}

function readNumber(payload: Record<string, unknown>, key: string): number {
  const v = payload[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`expected number for payload.${key}`);
  }
  return v;
}

function readSeedPayload(payload: Record<string, unknown>): SeedPayload {
  const v = payload['payload'];
  if (!v || typeof v !== 'object') {
    throw new Error('expected object for payload.payload (seed payload)');
  }
  return v as SeedPayload;
}

const seedPackageApplyHandler: IntentHandler = {
  async handle(ctx: IntentHandlerContext, envelope: IntentEnvelope): Promise<HandlerResult> {
    const result = await handleSeedPackageApply(
      {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        principalId: ctx.principalId,
        seedPackageKey: readString(envelope.payload, 'seedPackageKey'),
        seedPackageVersion: readString(envelope.payload, 'seedPackageVersion'),
        payload: readSeedPayload(envelope.payload),
      },
      ctx.catalogState,
      ctx.eventStore,
    );
    return { primary: result.envelope, follow: [] };
  },
};

const familyPublishHandler: IntentHandler = {
  async handle(ctx: IntentHandlerContext, envelope: IntentEnvelope): Promise<HandlerResult> {
    const result = await handleFamilyPublish(
      {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        principalId: ctx.principalId,
        familyKey: readString(envelope.payload, 'familyKey'),
        familyRevisionNumber: readNumber(envelope.payload, 'familyRevisionNumber'),
      },
      ctx.catalogState,
      ctx.eventStore,
    );
    return { primary: result.familyEnvelope, follow: result.variantEnvelopes };
  },
};

export function catalogHandlerEntries(): ReadonlyArray<readonly [string, IntentHandler]> {
  return [
    ['Catalog.SeedPackage.Apply', seedPackageApplyHandler],
    ['Catalog.Family.Publish', familyPublishHandler],
  ];
}

export function catalogHandlerRegistry(): HandlerRegistry {
  const map = new Map<string, IntentHandler>(catalogHandlerEntries());
  return {
    get(actionId: string): IntentHandler | undefined {
      return map.get(actionId);
    },
  };
}
