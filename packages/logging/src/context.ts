import type {
  AtlasEnvironment,
  AtlasExecutionContext,
  AtlasExecutionContextPatch,
  Logger,
} from '@atlas/platform-core';
import { newSpanId } from './ids.ts';
import { createContextLogger } from './logger-impl.ts';
import type { LogPipeline } from './pipeline.ts';

/**
 * Internal carrier for context fields. Kept private; constructors don't
 * accept this directly — go through createRootContext or the .with*()
 * builders on an existing context.
 */
export interface ContextFields {
  tenantId: string;
  principalId: string;
  userId: string | undefined;
  sessionId: string | undefined;
  correlationId: string;
  causationId: string | undefined;
  traceId: string;
  spanId: string;
  requestId: string | undefined;
  moduleId: string | undefined;
  actionId: string | undefined;
  resourceType: string | undefined;
  resourceId: string | undefined;
  surfaceId: string | undefined;
  environment: AtlasEnvironment;
}

class AtlasExecutionContextImpl implements AtlasExecutionContext {
  readonly logger: Logger;

  constructor(
    private readonly fields: ContextFields,
    private readonly pipeline: LogPipeline,
  ) {
    this.logger = createContextLogger(this, pipeline);
  }

  // Identity
  get tenantId(): string {
    return this.fields.tenantId;
  }
  get principalId(): string {
    return this.fields.principalId;
  }
  get userId(): string | undefined {
    return this.fields.userId;
  }
  get sessionId(): string | undefined {
    return this.fields.sessionId;
  }
  // Trace
  get correlationId(): string {
    return this.fields.correlationId;
  }
  get causationId(): string | undefined {
    return this.fields.causationId;
  }
  get traceId(): string {
    return this.fields.traceId;
  }
  get spanId(): string {
    return this.fields.spanId;
  }
  get requestId(): string | undefined {
    return this.fields.requestId;
  }
  // Operation
  get moduleId(): string | undefined {
    return this.fields.moduleId;
  }
  get actionId(): string | undefined {
    return this.fields.actionId;
  }
  get resourceType(): string | undefined {
    return this.fields.resourceType;
  }
  get resourceId(): string | undefined {
    return this.fields.resourceId;
  }
  get surfaceId(): string | undefined {
    return this.fields.surfaceId;
  }
  get environment(): AtlasEnvironment {
    return this.fields.environment;
  }

  with(patch: AtlasExecutionContextPatch): AtlasExecutionContext {
    // Use 'in' checks so the caller can explicitly clear an optional
    // field by passing { userId: undefined } vs simply omit to keep
    // the parent's value. This matches exactOptionalPropertyTypes.
    const next: ContextFields = {
      tenantId: this.fields.tenantId,
      principalId: patch.principalId ?? this.fields.principalId,
      userId: 'userId' in patch ? patch.userId : this.fields.userId,
      sessionId: 'sessionId' in patch ? patch.sessionId : this.fields.sessionId,
      correlationId: this.fields.correlationId,
      causationId:
        'causationId' in patch ? patch.causationId : this.fields.causationId,
      traceId: this.fields.traceId,
      spanId: this.fields.spanId,
      requestId: 'requestId' in patch ? patch.requestId : this.fields.requestId,
      moduleId: 'moduleId' in patch ? patch.moduleId : this.fields.moduleId,
      actionId: 'actionId' in patch ? patch.actionId : this.fields.actionId,
      resourceType:
        'resourceType' in patch
          ? patch.resourceType
          : this.fields.resourceType,
      resourceId:
        'resourceId' in patch ? patch.resourceId : this.fields.resourceId,
      surfaceId:
        'surfaceId' in patch ? patch.surfaceId : this.fields.surfaceId,
      environment: this.fields.environment,
    };
    return new AtlasExecutionContextImpl(next, this.pipeline);
  }

  withModule(moduleId: string): AtlasExecutionContext {
    return this.with({ moduleId });
  }
  withAction(actionId: string): AtlasExecutionContext {
    return this.with({ actionId });
  }
  withResource(resourceType: string, resourceId: string): AtlasExecutionContext {
    return this.with({ resourceType, resourceId });
  }
  withSurface(surfaceId: string): AtlasExecutionContext {
    return this.with({ surfaceId });
  }
  withCausation(causationId: string): AtlasExecutionContext {
    return this.with({ causationId });
  }
  childSpan(_name: string): AtlasExecutionContext {
    // `name` is reserved for the future OTEL adapter — not stored on
    // the context today since LogEvent has no spanName field. We just
    // mint a fresh spanId; the parent span context is preserved via
    // the unchanged correlationId / traceId.
    const next: ContextFields = { ...this.fields, spanId: newSpanId() };
    return new AtlasExecutionContextImpl(next, this.pipeline);
  }
}

/** Internal: build an impl from prepared fields. */
export function makeContext(
  fields: ContextFields,
  pipeline: LogPipeline,
): AtlasExecutionContext {
  return new AtlasExecutionContextImpl(fields, pipeline);
}
