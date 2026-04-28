import type { ValidateFunction } from 'ajv/dist/2020.js';

export interface ActionEntry {
  actionId: string;
  resourceType: string;
  schemaId: string;
  schemaVersion: number;
}

export interface ControlPlaneRegistry {
  hasAction(actionId: string): boolean;
  getAction(actionId: string): ActionEntry | null;
  getSchemaValidator(schemaId: string, version: number): ValidateFunction | null;
}
