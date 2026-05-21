/**
 * @atlas/dsl — handler + queries for `Dsl.<Kind>.Update` and validate.
 *
 * Generic over DSL kinds. Wire each concrete DSL (expression, template,
 * query) via a `DslKind` descriptor passed into `makeDslKindRegistry`.
 * The wiring lives in apps/server's bootstrap (slice #4 wiring lands
 * separately; this slice ships the module surface).
 */

export {
  type DslKind,
  type AnyDslKind,
  type DslKindRegistry,
  makeDslKindRegistry,
} from './kind-registry.ts';

export {
  DslHandlerError,
  type DslHandlerErrorCode,
  codes as dslHandlerErrorCodes,
  API_NAME_PATTERN,
  assertApiName,
} from './errors.ts';

export {
  handleDslUpdate,
  type DslUpdateCommand,
  type DslUpdateDeps,
  type DslUpdateResult,
} from './handlers/dsl-update.ts';

export {
  type DslQueryDeps,
  type ValidateDslSourceInput,
  type ValidateDslSourceResult,
  getDslArtifact,
  getDslArtifactVersion,
  getDslArtifactById,
  listDslArtifacts,
  validateDslSource,
} from './queries.ts';
