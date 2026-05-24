// @spec scripts/dev orchestrator — stack table lookups.
import { describe, expect, it } from '@atlas/test';
import { findStack, resolveContainer, STACKS, stackNames } from './stacks.ts';

describe('stack table', () => {
  it('finds known stacks by name', () => {
    expect(findStack('db')?.name).toBe('db');
    expect(findStack('keycloak')?.containerName).toBe('atlas-keycloak');
  });

  it('returns undefined for an unknown stack', () => {
    expect(findStack('nope')).toBeUndefined();
  });

  it('db targets the postgres service explicitly (dodges stale control-plane build)', () => {
    expect(findStack('db')?.upServices).toEqual(['postgres']);
  });

  it('lists every stack name', () => {
    expect(stackNames()).toEqual(['db', 'keycloak', 'obs', 'smtp']);
  });

  it('every stack points at an infra/compose file', () => {
    for (const s of STACKS) {
      expect(s.composeFile).toMatch(/infra[\\/]compose[\\/]compose\..+\.yml$/);
    }
  });
});

describe('resolveContainer (cross-stack log aliases)', () => {
  it('maps aliases to live dev containers', () => {
    expect(resolveContainer('db')).toBe('atlas-platform-control-plane-db');
    expect(resolveContainer('kc')).toBe('atlas-keycloak');
    expect(resolveContainer('grafana')).toBe('atlas-platform-grafana');
  });

  it('returns undefined for an unknown alias', () => {
    expect(resolveContainer('ghost')).toBeUndefined();
  });
});
