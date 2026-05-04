import { describe, it, expect } from 'vitest';
import { UpcasterRegistry, upcastToLatest } from './upcaster.ts';

describe('UpcasterRegistry', () => {
  it('latestVersion defaults to 1 with no upcasters registered', () => {
    const r = new UpcasterRegistry();
    expect(r.latestVersion('Page')).toBe(1);
  });

  it('register tracks latest known version', () => {
    const r = new UpcasterRegistry();
    r.register('Page', 1, (a) => a);
    expect(r.latestVersion('Page')).toBe(2);
    r.register('Page', 2, (a) => a);
    expect(r.latestVersion('Page')).toBe(3);
  });

  it('apply walks the chain in order', () => {
    const r = new UpcasterRegistry();
    r.register('Page', 1, (attrs) => ({ ...(attrs as object), v1to2: true }));
    r.register('Page', 2, (attrs) => ({ ...(attrs as object), v2to3: true }));
    const out = r.apply('Page', 1, 3, { name: 'home' }) as Record<string, unknown>;
    expect(out['name']).toBe('home');
    expect(out['v1to2']).toBe(true);
    expect(out['v2to3']).toBe(true);
  });

  it('apply is a no-op when fromVersion === toVersion', () => {
    const r = new UpcasterRegistry();
    expect(r.apply('Page', 3, 3, { name: 'home' })).toEqual({ name: 'home' });
  });

  it('apply throws on missing intermediate step', () => {
    const r = new UpcasterRegistry();
    r.register('Page', 1, (a) => a);
    // No v2→v3 registered, but caller asks to walk to v3.
    expect(() => r.apply('Page', 1, 3, {})).toThrow(/missing upcaster.*Page v2/);
  });

  it('apply rejects downgrade attempts', () => {
    const r = new UpcasterRegistry();
    expect(() => r.apply('Page', 3, 1, {})).toThrow(/forward-only/);
  });

  it('register throws on conflicting upcasters', () => {
    const r = new UpcasterRegistry();
    const a = (x: unknown): unknown => x;
    const b = (x: unknown): unknown => x;
    r.register('Page', 1, a);
    expect(() => r.register('Page', 1, b)).toThrow(/collision/);
  });

  it('register is idempotent for the same function reference', () => {
    const r = new UpcasterRegistry();
    const fn = (x: unknown): unknown => x;
    r.register('Page', 1, fn);
    r.register('Page', 1, fn);
    expect(r.latestVersion('Page')).toBe(2);
  });
});

describe('upcastToLatest', () => {
  it('returns input unchanged when already at latest', () => {
    const r = new UpcasterRegistry();
    r.register('Page', 1, (a) => a);
    const out = upcastToLatest(r, 'Page', 2, { name: 'home' });
    expect(out).toEqual({ schemaVersion: 2, attrs: { name: 'home' } });
  });

  it('walks chain to latest registered version', () => {
    const r = new UpcasterRegistry();
    r.register('Page', 1, (attrs) => ({ ...(attrs as object), upcasted: true }));
    const out = upcastToLatest(r, 'Page', 1, { name: 'home' });
    expect(out.schemaVersion).toBe(2);
    expect((out.attrs as Record<string, unknown>)['upcasted']).toBe(true);
  });
});
