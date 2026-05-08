import type { LogLevel } from '@atlas/platform-core';

const ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

export const LOG_LEVELS: ReadonlyArray<LogLevel> = ['debug', 'info', 'warn', 'error', 'fatal'];

export function levelOrder(level: LogLevel): number {
  return ORDER[level];
}

export function isLogLevel(value: unknown): value is LogLevel {
  return (
    value === 'debug' ||
    value === 'info' ||
    value === 'warn' ||
    value === 'error' ||
    value === 'fatal'
  );
}
