// @spec scripts/dev orchestrator — CLI arg parsing.
import { describe, expect, it } from '@atlas/test';
import { parseArgv } from './main.ts';

describe('parseArgv', () => {
  it('parses `stack <name> <verb>`', () => {
    expect(parseArgv(['stack', 'db', 'up'])).toMatchObject({ kind: 'stack', stack: 'db', verb: 'up' });
  });

  it('captures --json', () => {
    const p = parseArgv(['stack', 'db', 'status', '--json']);
    expect(p.flags.json).toBe(true);
  });

  it('captures --quiet', () => {
    expect(parseArgv(['stack', 'db', 'up', '--quiet']).flags.quiet).toBe(true);
  });

  it('rejects an unknown verb', () => {
    expect(parseArgv(['stack', 'db', 'frobnicate']).kind).toBe('error');
  });

  it('requires both stack and verb', () => {
    expect(parseArgv(['stack', 'db']).kind).toBe('error');
  });

  it('parses `logs` with services + --tail + --no-follow', () => {
    expect(parseArgv(['logs', 'db', 'keycloak', '--tail', '50', '--no-follow'])).toMatchObject({
      kind: 'logs',
      services: ['db', 'keycloak'],
      tail: 50,
      follow: false,
    });
  });

  it('supports --tail=N form', () => {
    expect(parseArgv(['logs', 'db', '--tail=10'])).toMatchObject({ kind: 'logs', tail: 10 });
  });

  it('rejects non-numeric --tail', () => {
    expect(parseArgv(['logs', 'db', '--tail', 'abc']).kind).toBe('error');
  });

  it('honors --json on a parse error even when it trails the bad arg', () => {
    const p = parseArgv(['logs', 'db', '--tail', 'abc', '--json']);
    expect(p.kind).toBe('error');
    expect(p.flags.json).toBe(true);
  });

  it('requires at least one service for logs', () => {
    expect(parseArgv(['logs']).kind).toBe('error');
  });

  it('defaults follow=true for logs', () => {
    expect(parseArgv(['logs', 'db'])).toMatchObject({ kind: 'logs', follow: true });
  });

  it('treats no args and `help` as help', () => {
    expect(parseArgv([]).kind).toBe('help');
    expect(parseArgv(['help']).kind).toBe('help');
    expect(parseArgv(['--help']).kind).toBe('help');
  });

  it('rejects an unknown command', () => {
    expect(parseArgv(['frob']).kind).toBe('error');
  });

  it('rejects an unknown flag', () => {
    expect(parseArgv(['stack', 'db', 'up', '--wat']).kind).toBe('error');
  });
});
