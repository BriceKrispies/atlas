import { describe, test, expect } from '@atlas/test';
import {
  getSchemaValidator,
  compileValidator,
  __setSchemaValidatorOverrideForTest,
} from '../src/loader.ts';

// @spec: specs/domains/runtime/capabilities/control-plane-schema-registry/README.md#acceptance
describe('loader — runtime schema compilation (cachedAjv single-instance removed)', function () {
  test('compileValidator compiles a runtime-supplied schema doc without rebuilding the package', function () {
    // A schema document that is NOT in the bundled SCHEMAS array. Before this
    // capability, the only way to get a validator was to add the file to
    // src/generated/ and recompile. The capability removes the permanently-
    // memoized cachedAjv and lets a doc handed in at runtime compile on demand.
    const document: Record<string, unknown> = {
      $id: 'runtime.loader_probe.v1',
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } },
      additionalProperties: false,
    };
    const validate = compileValidator(document);
    expect(validate({ name: 'ok' })).toBe(true);
    expect(validate({})).toBe(false);
    expect(validate({ name: 'ok', extra: 1 })).toBe(false);
  });

  test('two different runtime docs compile to independent validators (no shared permanently-memoized ajv state)', function () {
    // The old cachedAjv memoized a single ajv instance for the package
    // lifetime; once a schema id was registered it could never change. With
    // per-doc compile, two docs sharing an $id-namespace but differing in
    // shape must each enforce their own contract.
    const a = compileValidator({
      $id: 'runtime.loader_a.v1',
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'number' } },
      additionalProperties: false,
    });
    const b = compileValidator({
      $id: 'runtime.loader_b.v1',
      type: 'object',
      required: ['b'],
      properties: { b: { type: 'string' } },
      additionalProperties: false,
    });
    expect(a({ a: 1 })).toBe(true);
    expect(a({ b: 'x' })).toBe(false);
    expect(b({ b: 'x' })).toBe(true);
    expect(b({ a: 1 })).toBe(false);
  });

  test('draft-07 meta-schema + addFormats stay available to runtime compilation', function () {
    // The seeder schemas declare $schema=draft-07 and use formats (e.g.
    // date-time). Runtime compilation MUST preserve the draft-07 meta-schema
    // registration and addFormats so a draft-07 doc with a format compiles.
    const validate = compileValidator({
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: 'runtime.loader_draft7.v1',
      type: 'object',
      required: ['when'],
      properties: { when: { type: 'string', format: 'date-time' } },
    });
    expect(validate({ when: '2026-05-23T00:00:00Z' })).toBe(true);
    expect(validate({ when: 'not-a-date' })).toBe(false);
  });

  test('__setSchemaValidatorOverrideForTest seam is retained', function () {
    // The test-only override seam must survive the cachedAjv removal —
    // callers (ingress unit tests) simulate a missing validator with it.
    __setSchemaValidatorOverrideForTest('catalog.seed_package.apply.v1', null);
    expect(getSchemaValidator('catalog.seed_package.apply.v1', 1)).toBeNull();
    __setSchemaValidatorOverrideForTest('catalog.seed_package.apply.v1', undefined);
    // Cleared — the bundled validator resolves again.
    expect(getSchemaValidator('catalog.seed_package.apply.v1', 1)).not.toBeNull();
  });
});
