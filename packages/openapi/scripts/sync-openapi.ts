#!/usr/bin/env tsx
/**
 * Generates specs/openapi.tenant.json + specs/openapi.operator.json
 * from authoritative Atlas sources (manifests + bundled action schemas
 * + envelope schemas).
 *
 * Wired as `pnpm sync-openapi`. Output is committed to git so external
 * consumers can read the spec without standing up a build.
 *
 * Per specs/crosscut/openapi.md.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { moduleManifests } from '@atlas/schemas';
import type { ModuleManifest } from '@atlas/platform-core';
import { buildOpenApi } from '../src/index.ts';
import type { ActionAudienceOverrides, JsonSchema } from '../src/index.ts';
// Repo root: this file → /packages/openapi/scripts/ → up 3 levels
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const SPECS_DIR = join(repoRoot, 'specs');
const SCHEMAS_DIR = join(SPECS_DIR, 'schemas', 'contracts');
const GENERATED_DIR = join(repoRoot, 'packages', 'schemas', 'src', 'generated');
/**
 * Action-audience overrides. Most actions default to 'tenant'; operator-
 * only actions list here. As of slice B-1 there are NO operator-routed
 * intent actions — Tenancy.Signup.{Approve,Deny} are admin REST routes,
 * not intent-routed. This list is extension-ready when that changes.
 */
const ACTION_AUDIENCE_OVERRIDES: ActionAudienceOverrides = {};
function readJson(path: string): JsonSchema {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as JsonSchema;
}
/**
 * Walk every bundled per-action JSON schema and build a map
 * `actionId → schema`. The convention is that every action schema has
 * `properties.actionId.const === <actionId>` — see the schema files
 * under packages/schemas/src/generated/. This avoids hard-coding the
 * snake_case naming convention.
 */
function loadActionPayloadSchemas(): Record<string, JsonSchema> {
    const files = readdirSync(GENERATED_DIR);
    const result: Record<string, JsonSchema> = {};
    for (const f of files) {
        if (!f.endsWith('.schema.json'))
            continue;
        const raw = readJson(join(GENERATED_DIR, f));
        const props = (raw['properties'] as Record<string, unknown> | undefined) ?? undefined;
        if (props === undefined)
            continue;
        const actionIdProp = props['actionId'] as Record<string, unknown> | undefined;
        if (actionIdProp === undefined)
            continue;
        const constValue = actionIdProp['const'];
        if (typeof constValue !== 'string' || constValue.length === 0)
            continue;
        result[constValue] = raw;
    }
    return result;
}
function gitCommit(): string | undefined {
    try {
        return execSync('git rev-parse --short HEAD', { cwd: repoRoot })
            .toString()
            .trim();
    }
    catch {
        return undefined;
    }
}
function main(): void {
    const envelopeSchema = readJson(join(SCHEMAS_DIR, 'event_envelope.schema.json'));
    const errorEnvelopeSchema = readJson(join(SCHEMAS_DIR, 'error_envelope.schema.json'));
    const manifests = moduleManifests() as ModuleManifest[];
    const actionPayloadSchemas = loadActionPayloadSchemas();
    const buildMetadata = {
        atlasVersion: '0.1.0',
        generatedAt: new Date().toISOString(),
        ...(gitCommit() !== undefined ? { gitCommit: gitCommit()! } : {}),
    };
    const tenantDoc = buildOpenApi({
        audience: 'tenant',
        manifests,
        actionAudienceOverrides: ACTION_AUDIENCE_OVERRIDES,
        actionPayloadSchemas,
        envelopeSchema,
        errorEnvelopeSchema,
        routeAnnotations: [],
        buildMetadata,
    });
    const operatorDoc = buildOpenApi({
        audience: 'operator',
        manifests,
        actionAudienceOverrides: ACTION_AUDIENCE_OVERRIDES,
        actionPayloadSchemas,
        envelopeSchema,
        errorEnvelopeSchema,
        routeAnnotations: [],
        buildMetadata,
    });
    const tenantPath = join(SPECS_DIR, 'openapi.tenant.json');
    const operatorPath = join(SPECS_DIR, 'openapi.operator.json');
    writeFileSync(tenantPath, JSON.stringify(tenantDoc, null, 2) + '\n');
    writeFileSync(operatorPath, JSON.stringify(operatorDoc, null, 2) + '\n');
    process.stdout.write(`${JSON.stringify({
        event: 'OpenAPI.SyncCompleted',
        tenant: tenantPath,
        operator: operatorPath,
        manifests: manifests.length,
        actionsExpanded: Object.keys(tenantDoc.paths).filter(function (p) {
            return p.startsWith('/api/v1/intents#');
        }).length,
        payloadSchemas: Object.keys(actionPayloadSchemas).length,
    })}\n`);
}
main();
