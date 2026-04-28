export interface EventEnvelope {
  eventId: string;
  eventType: string;
  schemaId: string;
  schemaVersion: number;
  occurredAt: string;
  tenantId: string;
  correlationId: string;
  idempotencyKey: string;
  causationId?: string | null;
  principalId?: string | null;
  userId?: string | null;
  cacheInvalidationTags?: string[] | null;
  payload: unknown;
}

export interface IntentEnvelope {
  eventId?: string;
  eventType: string;
  schemaId: string;
  schemaVersion: number;
  occurredAt?: string;
  tenantId: string;
  correlationId: string;
  idempotencyKey: string;
  causationId?: string | null;
  principalId?: string | null;
  userId?: string | null;
  payload: IntentPayload;
}

export interface IntentPayload {
  actionId: string;
  resourceType: string;
  resourceId?: string | null;
  [k: string]: unknown;
}

export interface IntentResponse {
  eventId: string;
  tenantId: string;
  principalId: string | null;
}

export interface Principal {
  principalId: string;
  tenantId: string;
}

export interface SearchDocument {
  documentId: string;
  documentType: string;
  tenantId: string;
  fields: Record<string, unknown>;
  permissionAttributes?: { allowedPrincipals: string[] } | null;
}

export interface CacheSetOptions {
  ttlSeconds: number;
  tags: ReadonlyArray<string>;
}
