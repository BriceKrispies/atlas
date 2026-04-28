/**
 * Convention-based mapping from a manifest `actionId` to its payload-schema
 * `schemaId` + `schemaVersion`.
 *
 * Rule:
 *   `Catalog.SeedPackage.Apply`  -> `catalog.seed_package.apply.v1`
 *   `Catalog.Family.Publish`     -> `catalog.family.publish.v1`
 *
 * Each dot-separated segment of the actionId is converted from PascalCase
 * to lower_snake_case, then the segments are rejoined with `.` and a
 * fixed `.v1` suffix is appended (the manifest version field is the
 * runtime override; today every shipped action is v1).
 */

export interface ActionSchemaRef {
  schemaId: string;
  schemaVersion: number;
}

const PASCAL_BOUNDARY = /(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g;

function toSnake(segment: string): string {
  return segment.replace(PASCAL_BOUNDARY, '_').toLowerCase();
}

export function actionIdToSchemaId(actionId: string): ActionSchemaRef {
  const segments = actionId.split('.').map(toSnake).filter((s) => s.length > 0);
  return {
    schemaId: `${segments.join('.')}.v1`,
    schemaVersion: 1,
  };
}
