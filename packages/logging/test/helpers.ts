import {
  CollectorSink,
  InMemoryLevelController,
  LogPipeline,
  createRootContext,
} from '../src/index.ts';
import type {
  AtlasEnvironment,
  AtlasExecutionContext,
  CreateRootContextInput,
  LogLevel,
  Sink,
} from '../src/index.ts';

export interface TestRig {
  pipeline: LogPipeline;
  collector: CollectorSink;
  levelController: InMemoryLevelController;
}

export interface TestRigOptions {
  defaultLevel?: LogLevel;
  extraSinks?: ReadonlyArray<Sink>;
  redactionExtraKeys?: ReadonlyArray<string>;
}

export function makeTestRig(options: TestRigOptions = {}): TestRig {
  const collector = new CollectorSink();
  const levelController = new InMemoryLevelController(options.defaultLevel ?? 'debug');
  const sinks: Sink[] = [collector, ...(options.extraSinks ?? [])];
  const pipelineOpts =
    options.redactionExtraKeys !== undefined
      ? { redactionExtraKeys: options.redactionExtraKeys }
      : {};
  const pipeline = new LogPipeline(sinks, levelController, pipelineOpts);
  return { pipeline, collector, levelController };
}

export interface TestCtxInput {
  pipeline: LogPipeline;
  tenantId?: string;
  principalId?: string;
  environment?: AtlasEnvironment;
  incomingCorrelationId?: string | null;
  userId?: string;
  sessionId?: string;
}

export function makeTestContext(input: TestCtxInput): AtlasExecutionContext {
  const cri: CreateRootContextInput = {
    pipeline: input.pipeline,
    tenantId: input.tenantId ?? 'tenant-test',
    principalId: input.principalId ?? 'user-test',
    environment: input.environment ?? 'test',
  };
  if (input.incomingCorrelationId !== undefined) {
    cri.incomingCorrelationId = input.incomingCorrelationId;
  }
  if (input.userId !== undefined) cri.userId = input.userId;
  if (input.sessionId !== undefined) cri.sessionId = input.sessionId;
  return createRootContext(cri);
}
